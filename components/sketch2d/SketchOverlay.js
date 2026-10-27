// file: components/sketch2d/SketchOverlay.js
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { sketch2DToWorld, worldToSketch2D } from './sketchFrame';

function lineGeom(a, b) {
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]);
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}

function circlePoints(center, r, frame, seg = 64) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const x = center.x + Math.cos(t) * r;
    const y = center.y + Math.sin(t) * r;
    pts.push(sketch2DToWorld(frame, x, y));
  }
  return pts;
}

function isTypingLike(s) {
  if (s == null) return true;
  const v = String(s);
  return v === '' || v === '-' || v === '+' || v === '.' || v === '-.' || v === '+.';
}

function toNumOrNull(s) {
  if (isTypingLike(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normDeg(d) {
  let x = d;
  while (x <= -180) x += 360;
  while (x > 180) x -= 360;
  return x;
}

function snapAngleLabel(angleDeg, snapTolDeg = 4) {
  const a = normDeg(angleDeg);
  const cands = [
    { deg: 0, label: '水平', tag: '0°' },
    { deg: 90, label: '垂直', tag: '90°' },
    { deg: 180, label: '水平', tag: '180°' },
    { deg: -90, label: '垂直', tag: '-90°' },
  ];

  let best = null;
  let bestDiff = Infinity;
  for (const c of cands) {
    const diff = Math.abs(normDeg(a - c.deg));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  if (best && bestDiff <= snapTolDeg) return best;
  return null;
}

function computeLineEnd(a2, rawB2, opt) {
  const lenMm = opt?.lengthMm ?? null;
  const angDeg = opt?.angleDeg ?? null;

  const dx = rawB2.x - a2.x;
  const dy = rawB2.y - a2.y;

  let rawDist = Math.sqrt(dx * dx + dy * dy);
  if (rawDist < 1e-9) rawDist = 0;

  let rawAng = rawDist > 0 ? (Math.atan2(dy, dx) * 180) / Math.PI : 0;

  let useAng = angDeg != null ? angDeg : rawAng;

  let snapInfo = null;
  if (angDeg == null) {
    const maybe = snapAngleLabel(rawAng, opt?.snapTolDeg ?? 4);
    if (maybe) {
      useAng = maybe.deg;
      snapInfo = maybe;
    }
  }

  const rad = (useAng * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: Math.sin(rad) };

  const useLen = lenMm != null ? Math.max(0.0001, lenMm) : Math.max(0.0001, rawDist);

  const b2 = { x: a2.x + dir.x * useLen, y: a2.y + dir.y * useLen };

  return {
    b2,
    dist: useLen,
    angleDeg: normDeg(useAng),
    snapInfo,
  };
}

// ===== screen snap helpers =====
function worldToScreen(p, camera, size) {
  const v = p.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * size.width,
    y: (-v.y * 0.5 + 0.5) * size.height,
    z: v.z,
  };
}

function nearestByScreen(pointerWorld, candidates, camera, size, thresholdPx = 12) {
  if (!pointerWorld || !candidates || candidates.length === 0) return null;

  const ps = worldToScreen(pointerWorld, camera, size);
  let best = null;
  let bestD = Infinity;

  for (const c of candidates) {
    const cs = worldToScreen(c.p, camera, size);
    const dx = cs.x - ps.x;
    const dy = cs.y - ps.y;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }

  if (!best || bestD > thresholdPx) return null;
  return { point: best.p, kind: best.kind, distPx: bestD };
}

function buildSketchSnapCandidatesWorld(frame, entities) {
  const out = [];
  for (const ent of entities ?? []) {
    if (ent.type === 'line') {
      const a2 = { x: ent.a[0], y: ent.a[1] };
      const b2 = { x: ent.b[0], y: ent.b[1] };
      out.push({ kind: 'sketch-end', p: sketch2DToWorld(frame, a2.x, a2.y) });
      out.push({ kind: 'sketch-end', p: sketch2DToWorld(frame, b2.x, b2.y) });

      const mx = (a2.x + b2.x) / 2;
      const my = (a2.y + b2.y) / 2;
      out.push({ kind: 'sketch-mid', p: sketch2DToWorld(frame, mx, my) });
    }

    if (ent.type === 'circle') {
      const cx = ent.c[0];
      const cy = ent.c[1];
      const r = ent.r;

      out.push({ kind: 'circle-center', p: sketch2DToWorld(frame, cx, cy) });
      out.push({ kind: 'circle-radius', p: sketch2DToWorld(frame, cx + r, cy) });
    }
  }

  const eps = 0.1; // mm
  const map = new Map();
  for (const c of out) {
    const k = `${Math.round(c.p.x / eps)}_${Math.round(c.p.y / eps)}_${Math.round(c.p.z / eps)}_${c.kind}`;
    if (!map.has(k)) map.set(k, c);
  }
  return Array.from(map.values());
}

// ===== ✅ loop picking (2D point-in-polygon) =====
function polyAreaAbs(pts) {
  let a2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a2) * 0.5;
}

function pointInPoly(p, poly) {
  // ray casting
  const x = p[0], y = p[1];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pickLoopByPoint2D(loops, p2) {
  if (!loops || loops.length === 0) return null;
  const candidates = [];
  for (const l of loops) {
    const pts = l.points;
    if (!pts || pts.length < 3) continue;
    if (pointInPoly([p2.x, p2.y], pts)) {
      candidates.push({ loop: l, area: polyAreaAbs(pts) });
    }
  }
  if (candidates.length === 0) return null;
  // ✅ 内側優先（面積が小さい方）
  candidates.sort((a, b) => a.area - b.area);
  return candidates[0].loop;
}

export default function SketchOverlay({
  active,
  frame,
  tool = 'line',
  entities = [],
  onAddEntity,
  onSetCursorHint,
  lineConstraint,
  snapWorldCandidates = [],

  // ✅ 追加：extrude ループ選択モード
  mode = 'draw', // 'draw' | 'pick-loop'
  loops2D = [],
  onPickLoop,
}) {
  const planeRef = useRef(null);
  const { camera, size } = useThree();

  const [temp, setTemp] = useState(null);
  const [hover2D, setHover2D] = useState(null);
  const [snapHover, setSnapHover] = useState(null);

  const frameKey = `${frame?.origin?.join?.(',')}|${frame?.normal?.join?.(',')}|${tool}|${mode}`;
  const [prevFrameKey, setPrevFrameKey] = useState(frameKey);
  if (prevFrameKey !== frameKey) {
    setPrevFrameKey(frameKey);
    setTemp(null);
    setHover2D(null);
    setSnapHover(null);
  }

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key?.toLowerCase?.();
      if (k === 'escape') {
        setTemp(null);
        setHover2D(null);
        setSnapHover(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const basis = useMemo(() => {
    if (!frame) return null;
    const o = new THREE.Vector3(frame.origin[0], frame.origin[1], frame.origin[2]);
    const u = new THREE.Vector3(frame.u[0], frame.u[1], frame.u[2]);
    const v = new THREE.Vector3(frame.v[0], frame.v[1], frame.v[2]);
    const n = new THREE.Vector3(frame.normal[0], frame.normal[1], frame.normal[2]);

    const m = new THREE.Matrix4().makeBasis(u, v, n);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);

    return { o, u, v, n, q };
  }, [frame]);

  const constraintParsed = useMemo(() => {
    const lengthMm = toNumOrNull(lineConstraint?.lengthMm);
    const angleDeg = toNumOrNull(lineConstraint?.angleDeg);
    return { lengthMm, angleDeg };
  }, [lineConstraint?.lengthMm, lineConstraint?.angleDeg]);

  const sketchSnapCandidates = useMemo(() => {
    if (!frame) return [];
    return buildSketchSnapCandidatesWorld(frame, entities);
  }, [frame, entities]);

  const allSnapCandidates = useMemo(() => {
    const out = [];
    for (const c of snapWorldCandidates ?? []) {
      if (!c?.p) continue;
      out.push({ kind: c.kind ?? 'solid', p: c.p.clone?.() ? c.p.clone() : c.p });
    }
    for (const c of sketchSnapCandidates ?? []) out.push(c);
    return out;
  }, [snapWorldCandidates, sketchSnapCandidates]);

  const displayCandidates = useMemo(() => {
    const MAX = 900;
    if (allSnapCandidates.length <= MAX) return allSnapCandidates;
    const step = Math.max(1, Math.floor(allSnapCandidates.length / MAX));
    return allSnapCandidates.filter((_, i) => i % step === 0);
  }, [allSnapCandidates]);

  const preview = useMemo(() => {
    if (!temp || temp.kind !== 'line' || !hover2D) return null;

    const a2 = { x: temp.a[0], y: temp.a[1] };
    const rawB2 = { x: hover2D.x, y: hover2D.y };

    return computeLineEnd(a2, rawB2, {
      lengthMm: constraintParsed.lengthMm,
      angleDeg: constraintParsed.angleDeg,
      snapTolDeg: 4,
    });
  }, [temp, hover2D, constraintParsed.lengthMm, constraintParsed.angleDeg]);

  const previewWorld = useMemo(() => {
    if (!preview || !temp || temp.kind !== 'line') return null;
    const a = sketch2DToWorld(frame, temp.a[0], temp.a[1]);
    const b = sketch2DToWorld(frame, preview.b2.x, preview.b2.y);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    return { a, b, mid };
  }, [preview, temp, frame]);

  if (!frame || !basis) return null;

  function resolvePointerWorld(worldPointRaw) {
    if (!worldPointRaw) return { world: null, snapped: null };

    const solidOnly = (snapWorldCandidates ?? []).filter((c) => c?.p);
    const solidHit = nearestByScreen(
      worldPointRaw,
      solidOnly.map((c) => ({ kind: c.kind, p: c.p })),
      camera,
      size,
      14
    );
    if (solidHit) return { world: solidHit.point, snapped: solidHit };

    const sketchHit = nearestByScreen(worldPointRaw, sketchSnapCandidates, camera, size, 14);
    if (sketchHit) return { world: sketchHit.point, snapped: sketchHit };

    return { world: worldPointRaw, snapped: null };
  }

  const handlePoint = (worldPointRaw) => {
    const { world: worldPoint, snapped } = resolvePointerWorld(worldPointRaw);
    if (!worldPoint) return;

    const p2 = worldToSketch2D(frame, worldPoint);

    // ✅ extrude: ループ選択
    if (mode === 'pick-loop') {
      const hit = pickLoopByPoint2D(loops2D, p2);
      if (hit) onPickLoop?.(hit);
      return;
    }

    // draw mode
    if (tool === 'line') {
      if (!temp) {
        setTemp({ kind: 'line', a: [p2.x, p2.y] });
        return;
      }
      if (temp.kind === 'line') {
        const a2 = { x: temp.a[0], y: temp.a[1] };
        const rawB2 = { x: p2.x, y: p2.y };

        const { b2 } = computeLineEnd(a2, rawB2, {
          lengthMm: constraintParsed.lengthMm,
          angleDeg: constraintParsed.angleDeg,
          snapTolDeg: 4,
        });

        const ent = {
          id: `sk_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
          type: 'line',
          a: [a2.x, a2.y],
          b: [b2.x, b2.y],
          snap: snapped ? { kind: snapped.kind } : null,
        };
        onAddEntity?.(ent);
        setTemp(null);
        setHover2D(null);
        setSnapHover(null);
        return;
      }
    }

    if (tool === 'circle') {
      if (!temp) {
        setTemp({ kind: 'circle', c: [p2.x, p2.y] });
        return;
      }
      if (temp.kind === 'circle') {
        const dx = p2.x - temp.c[0];
        const dy = p2.y - temp.c[1];
        const r = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy));
        const ent = {
          id: `sk_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
          type: 'circle',
          c: [temp.c[0], temp.c[1]],
          r,
          snap: snapped ? { kind: snapped.kind } : null,
        };
        onAddEntity?.(ent);
        setTemp(null);
        setHover2D(null);
        setSnapHover(null);
        return;
      }
    }
  };

  function markerRadius(kind) {
    if (kind === 'vtx') return 5;
    if (kind === 'mid') return 6;
    if (kind === 'circle-center') return 7;
    if (kind === 'circle-radius') return 7;
    if (kind === 'sketch-end') return 6;
    if (kind === 'sketch-mid') return 6;
    return 6;
  }

  return (
    <group>
      {active ? (
        <mesh
          ref={planeRef}
          position={basis.o}
          quaternion={basis.q}
          onPointerOver={() => onSetCursorHint?.(mode === 'pick-loop' ? 'pointer' : 'crosshair')}
          onPointerOut={() => onSetCursorHint?.('')}
          onPointerMove={(e) => {
            const p = e.point?.clone?.();
            if (!p) return;

            const { world, snapped } = resolvePointerWorld(p);
            setSnapHover(snapped ? { point: world.clone(), kind: snapped.kind } : null);

            const p2 = worldToSketch2D(frame, world);
            setHover2D({ x: p2.x, y: p2.y });
          }}
          onPointerDown={(e) => {
            const btn = e.button ?? e.nativeEvent?.button;
            if (btn !== 0) return;

            e.stopPropagation?.();
            e.preventDefault?.();
            const p = e.point?.clone?.();
            if (!p) return;

            handlePoint(p);
          }}
        >
          <planeGeometry args={[400000, 400000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}

      {displayCandidates.map((c, i) => (
        <mesh key={`snap_${c.kind}_${i}`} position={c.p} renderOrder={40} raycast={() => null}>
          <sphereGeometry args={[Math.max(2, markerRadius(c.kind) * 0.35), 10, 10]} />
          <meshBasicMaterial transparent opacity={0.25} depthTest={false} color="#111111" />
        </mesh>
      ))}

      {snapHover?.point ? (
        <mesh position={snapHover.point} renderOrder={41} raycast={() => null}>
          <sphereGeometry args={[10, 14, 14]} />
          <meshBasicMaterial transparent opacity={0.7} depthTest={false} color="#ff2d2d" />
        </mesh>
      ) : null}

      {entities.map((ent) => {
        if (ent.type === 'line') {
          const a = sketch2DToWorld(frame, ent.a[0], ent.a[1]);
          const b = sketch2DToWorld(frame, ent.b[0], ent.b[1]);
          const g = lineGeom(a, b);
          return (
            <line key={ent.id} geometry={g} raycast={() => null}>
              <lineBasicMaterial color="#111111" />
            </line>
          );
        }
        if (ent.type === 'circle') {
          const pts = circlePoints({ x: ent.c[0], y: ent.c[1] }, ent.r, frame, 80);
          const g = new THREE.BufferGeometry().setFromPoints(pts);
          return (
            <line key={ent.id} geometry={g} raycast={() => null}>
              <lineBasicMaterial color="#111111" />
            </line>
          );
        }
        return null;
      })}

      {active && mode === 'draw' && temp && temp.kind === 'line' && previewWorld ? (
        <group>
          <mesh position={previewWorld.a} raycast={() => null}>
            <sphereGeometry args={[8, 12, 12]} />
            <meshBasicMaterial color="#ff2d2d" />
          </mesh>

          <line geometry={lineGeom(previewWorld.a, previewWorld.b)} raycast={() => null}>
            <lineBasicMaterial color="#00aa55" />
          </line>

          <Html position={previewWorld.mid} center style={{ pointerEvents: 'none' }}>
            <div
              style={{
                background: 'rgba(255,255,255,0.92)',
                border: '1px solid rgba(0,0,0,0.25)',
                borderRadius: 6,
                padding: '4px 6px',
                fontSize: 11,
                color: '#111',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}
            >
              {preview.snapInfo ? (
                <span style={{ marginRight: 6, fontWeight: 700 }}>
                  {preview.snapInfo.label}（{preview.snapInfo.tag}）
                </span>
              ) : null}
              <span style={{ marginRight: 8 }}>L: {Math.round(preview.dist)}mm</span>
              <span>θ: {Math.round(preview.angleDeg)}°</span>
            </div>
          </Html>
        </group>
      ) : null}
    </group>
  );
}

/**
 * ✅ 閉ループ検出（線分のみ）
 */
export function detectClosedLoops(entities, tol = 0.1) {
  const lines = (entities ?? []).filter((e) => e?.type === 'line' && e?.a && e?.b);
  if (lines.length < 3) return [];

  const nodes = [];
  const nodeIdByKey = new Map();
  const keyOf = (p) => `${Math.round(p[0] / tol)}_${Math.round(p[1] / tol)}`;

  function getNodeId(p) {
    const k = keyOf(p);
    if (nodeIdByKey.has(k)) return nodeIdByKey.get(k);
    const id = nodes.length;
    nodes.push({ id, p: [p[0], p[1]] });
    nodeIdByKey.set(k, id);
    return id;
  }

  const edges = [];
  const adj = new Map();
  const addAdj = (n, ei) => {
    if (!adj.has(n)) adj.set(n, []);
    adj.get(n).push(ei);
  };

  for (const ln of lines) {
    const na = getNodeId(ln.a);
    const nb = getNodeId(ln.b);
    if (na === nb) continue;
    const ei = edges.length;
    edges.push({ id: ln.id, a: na, b: nb });
    addAdj(na, ei);
    addAdj(nb, ei);
  }
  if (edges.length < 3) return [];

  const vec = (fromNode, toNode) => {
    const A = nodes[fromNode].p;
    const B = nodes[toNode].p;
    return [B[0] - A[0], B[1] - A[1]];
  };
  const norm = (v) => {
    const d = Math.hypot(v[0], v[1]);
    return d < 1e-9 ? [0, 0] : [v[0] / d, v[1] / d];
  };
  const angleBetween = (u, v) => {
    const uu = norm(u);
    const vv = norm(v);
    const dot = Math.max(-1, Math.min(1, uu[0] * vv[0] + uu[1] * vv[1]));
    return Math.acos(dot);
  };

  const usedEdge = new Set();
  const loops = [];

  function pickNextEdge(currNode, prevNode, prevEi) {
    const list = adj.get(currNode) ?? [];
    const candidates = list.filter((ei) => ei !== prevEi && !usedEdge.has(ei));
    if (candidates.length === 0) return null;

    if (prevNode != null) {
      const prevDir = vec(prevNode, currNode);
      let best = null;
      let bestAng = Infinity;
      for (const ei of candidates) {
        const e = edges[ei];
        const nextNode = e.a === currNode ? e.b : e.a;
        const dir = vec(currNode, nextNode);
        const ang = angleBetween(prevDir, dir);
        if (ang < bestAng) {
          bestAng = ang;
          best = ei;
        }
      }
      return best;
    }

    return candidates[0];
  }

  for (let startEi = 0; startEi < edges.length; startEi++) {
    if (usedEdge.has(startEi)) continue;

    const startE = edges[startEi];
    const tries = [
      { startNode: startE.a, nextNode: startE.b },
      { startNode: startE.b, nextNode: startE.a },
    ];

    let found = null;

    for (const tr of tries) {
      const pathNodes = [tr.startNode, tr.nextNode];
      const pathEdges = [startEi];

      let prevNode = tr.startNode;
      let currNode = tr.nextNode;
      let prevEi = startEi;

      const localUsed = new Set([startEi]);

      let safety = 0;
      while (safety++ < 5000) {
        if (currNode === tr.startNode) {
          if (pathNodes.length >= 4) {
            found = { nodes: pathNodes.slice(0, -1), edgeIdx: pathEdges.slice() };
          }
          break;
        }

        const nextEi = pickNextEdge(currNode, prevNode, prevEi);
        if (nextEi == null) break;

        if (localUsed.has(nextEi)) break;
        localUsed.add(nextEi);

        const e = edges[nextEi];
        const nextNode = e.a === currNode ? e.b : e.a;

        pathEdges.push(nextEi);
        pathNodes.push(nextNode);

        prevNode = currNode;
        currNode = nextNode;
        prevEi = nextEi;

        if (pathNodes.length > edges.length + 5) break;
      }

      if (found) {
        for (const ei of found.edgeIdx) usedEdge.add(ei);

        const pts = found.nodes.map((nid) => nodes[nid].p);

        let area2 = 0;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          area2 += a[0] * b[1] - b[0] * a[1];
        }
        if (Math.abs(area2) >= 1e-3) {
          loops.push({
            id: `loop_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            points: pts,
            sourceLineIds: found.edgeIdx.map((ei) => edges[ei].id),
          });
        }
        break;
      }
    }
  }

  return loops;
}

export function hatchShapeMesh(frame, loopPoints2D) {
  const shape = new THREE.Shape();
  const pts = loopPoints2D;
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.lineTo(pts[0][0], pts[0][1]);

  const geo2 = new THREE.ShapeGeometry(shape);

  const pos = geo2.getAttribute('position');
  const wpts = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const p = sketch2DToWorld(frame, x, y);
    wpts.push(p);
  }

  const wgeo = new THREE.BufferGeometry();
  const arr = new Float32Array(wpts.length * 3);
  for (let i = 0; i < wpts.length; i++) {
    arr[i * 3 + 0] = wpts[i].x;
    arr[i * 3 + 1] = wpts[i].y;
    arr[i * 3 + 2] = wpts[i].z;
  }
  wgeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  wgeo.setIndex(geo2.getIndex());
  wgeo.computeVertexNormals();
  geo2.dispose?.();

  return wgeo;
}
