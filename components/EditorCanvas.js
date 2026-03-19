// file: components/EditorCanvas.js
'use client';

import { Canvas } from '@react-three/fiber';
import { Grid, Outlines, TransformControls, GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import CustomCameraControls from '@/components/CustomCameraControls';
import SketchOverlay, { hatchShapeMesh } from '@/components/sketch2d/SketchOverlay';
import { buildSketchFrame } from '@/components/sketch2d/sketchFrame';

// ✅ sections.js から “同じ形状生成” を使う
import {
  buildChannelGeometry,
  buildAngleGeometry,
  buildHBeamGeometry,
  buildPipeGeometry,
  buildPipeElbowGeometry,
  buildRoundBarGeometry,
  buildFlatBarGeometry,
  buildSquarePipeGeometry,
  buildExpandedMetalGeometry,
  buildCheckeredPlateGeometry,
} from '@/components/steel/sections';
import { getLongElbowDimsByOD } from '@/components/steel/elbowLongJIS';

const MM_BASE = 1000;

function wheelStep(e) {
  const dy = e.deltaY;
  const sign = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  return sign * 10;
}

function applyWheelMove({ e, objects, primaryId, onLiveMove, onCommitMove, currentTool }) {
  // ✅ 通常のホイールはズームに使う：オブジェクト移動は ALT 押下時のみ
  if (!e.altKey) return;

  if (currentTool !== 'select') return;
  if (!primaryId) return;

  const ae = document.activeElement;
  const tag = ae?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || ae?.isContentEditable) return;

  const obj = objects.find((o) => o.id === primaryId);
  if (!obj) return;

  // ✅ ズーム側のリスナーに影響しないように止める
  e.preventDefault();
  e.stopPropagation?.();

  const step = wheelStep(e);
  const p = obj.position ?? [0, 0, 0];
  const np = [...p];

  // SHIFT: Z, CTRL/CMD: X, それ以外: Y
  if (e.shiftKey) {
    np[2] = (p[2] ?? 0) + step;
  } else if (e.ctrlKey || e.metaKey) {
    np[0] = (p[0] ?? 0) + step;
  } else {
    np[1] = (p[1] ?? 0) + step;
  }

  onLiveMove?.(primaryId, np);
  onCommitMove?.(primaryId, np);
}


function applyScaleToObject(obj, scaleVec3) {
  const sx = scaleVec3.x,
    sy = scaleVec3.y,
    sz = scaleVec3.z;

  // box系（sizeで管理しているもの）
  if (
    obj.type === 'cube' ||
    obj.type === 'box' ||
    obj.type === 'fused' ||
    obj.type === 'steel-channel' ||
    obj.type === 'steel-angle' ||
    obj.type === 'steel-hbeam' ||
    obj.type === 'steel-flatbar' ||
    obj.type === 'steel-squarepipe'
  ) {
    const base = obj.size ?? [MM_BASE, MM_BASE, MM_BASE];
    const next = [Math.max(1, base[0] * sx), Math.max(1, base[1] * sy), Math.max(1, base[2] * sz)];
    return { size: next };
  }

  // 円柱系（radius/heightで管理）
  if (obj.type === 'cylinder' || obj.type === 'cone') {
    const r = obj.radius ?? MM_BASE / 2;
    const h = obj.height ?? MM_BASE;
    const rScale = Math.max(0.001, (Math.abs(sx) + Math.abs(sz)) / 2);
    const hScale = Math.max(0.001, Math.abs(sy));
    return {
      radius: Math.max(1, r * rScale),
      height: Math.max(1, h * hScale),
    };
  }

  // パイプ/丸鋼（DとLで再生成される想定：ここでは dims をいじる方が自然）
  if (obj.type === 'steel-pipe' || obj.type === 'steel-roundbar') {
    const baseLen = Number(obj.dims?.length ?? 6000);
    const nextLen = Math.max(1, baseLen * Math.abs(sy));
    return { dims: { ...(obj.dims ?? {}), length: nextLen } };
  }

  // エルボは長さではなく全体スケール
  if (obj.type === 'steel-elbow90' || obj.type === 'steel-elbow45') {
    const base = obj.size ?? [MM_BASE, MM_BASE, MM_BASE];
    const next = [
      Math.max(1, base[0] * Math.abs(sx)),
      Math.max(1, base[1] * Math.abs(sy)),
      Math.max(1, base[2] * Math.abs(sz)),
    ];
    return { size: next };
  }

  // 板（width/height）
  if (obj.type === 'steel-expanded' || obj.type === 'steel-checkered') {
    const baseW = Number(obj.dims?.width ?? 1200);
    const baseH = Number(obj.dims?.height ?? 600);
    const nextW = Math.max(10, baseW * Math.abs(sx));
    const nextH = Math.max(10, baseH * Math.abs(sz));
    return { dims: { ...(obj.dims ?? {}), width: nextW, height: nextH } };
  }

  return {};
}


function isOrangeLike(hex) {
  if (!hex || typeof hex !== 'string') return false;
  const h = hex.replace('#', '');
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return r >= 200 && g >= 90 && g <= 190 && b <= 120;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** ===== 作図面の可視化 ===== */
function SketchPlane({ frame, size = 400000 }) {
  const mat = useMemo(() => {
    const o = new THREE.Vector3(frame.origin[0], frame.origin[1], frame.origin[2]);
    const u = new THREE.Vector3(frame.u[0], frame.u[1], frame.u[2]);
    const v = new THREE.Vector3(frame.v[0], frame.v[1], frame.v[2]);
    const n = new THREE.Vector3(frame.normal[0], frame.normal[1], frame.normal[2]);

    const m = new THREE.Matrix4().makeBasis(u, v, n);
    m.setPosition(o);
    return m;
  }, [frame]);

  return (
    <group matrixAutoUpdate={false} matrix={mat}>
      <mesh renderOrder={60}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial transparent opacity={0.12} depthWrite={false} color="#00d5ff" />
      </mesh>

      <lineSegments renderOrder={61}>
        <edgesGeometry args={[new THREE.PlaneGeometry(size, size)]} />
        <lineBasicMaterial transparent opacity={0.6} color="#00d5ff" />
      </lineSegments>
    </group>
  );
}

function buildFusedGeometry(fused) {
  const sources = fused.sources ?? [];
  const geos = [];

  for (const s of sources) {
    const g = buildGeometryFromShape(s);

    const rp = s.localPosition ?? [0, 0, 0];
    const rr = s.localRotation ?? [0, 0, 0];

    const pv = s.pivot ?? [0, 0, 0];
    const meshOffset = [-pv[0], -pv[1], -pv[2]];

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr[0] ?? 0, rr[1] ?? 0, rr[2] ?? 0));
    const t = new THREE.Vector3(
      (rp[0] ?? 0) + (meshOffset[0] ?? 0),
      (rp[1] ?? 0) + (meshOffset[1] ?? 0),
      (rp[2] ?? 0) + (meshOffset[2] ?? 0)
    );

    m.compose(t, q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);

    geos.push(g);
  }

  if (geos.length === 0) return new THREE.BoxGeometry(MM_BASE, MM_BASE, MM_BASE);

  const merged = mergeGeometries(geos, true);
  for (const g of geos) g.dispose?.();

  merged.computeVertexNormals();
  return merged;
}

/**
 * ✅ Editor全体の形状生成をここに統一
 * - SteelAddPanel から渡される __geometry があれば最優先（確実に同じ見た目）
 * - そうでなければ type/spec/dims/steel から sections.js で再生成
 */
function buildGeometryFromShape(shape) {
  if (!shape) return new THREE.BoxGeometry(MM_BASE, MM_BASE, MM_BASE);

  // ✅ 先に「渡されたジオメトリ」を優先（clone）
  if (shape.__geometry) {
    const g = shape.__geometry;
    return g?.clone ? g.clone() : g;
  }

  if (shape.type === 'fused') return buildFusedGeometry(shape);

  // ✅ plate：__geometry が無い（複製後など）場合でも profile から再生成する
  if (shape.type === 'plate') {
    const t = Math.max(0.1, Number(shape?.dims?.t ?? shape?.t ?? shape?.thickness ?? 12) || 12);
    const ptsRaw = shape?.profile?.points ?? shape?.profile ?? [];
    const pts = (Array.isArray(ptsRaw) ? ptsRaw : []).map((p) => {
      if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0];
      if (p && typeof p === 'object') return [Number(p.x) || 0, Number(p.y) || 0];
      return [0, 0];
    });
    if (pts.length < 3) return new THREE.BoxGeometry(MM_BASE, MM_BASE, MM_BASE);

    const closed =
      !!shape?.profile?.closed ||
      (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]);

    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    if (!closed) sh.lineTo(pts[0][0], pts[0][1]);

    const geo = new THREE.ExtrudeGeometry(sh, {
      depth: t,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 16,
    });
    // 挿入時と向きを合わせる（あなたが insert 側で回してる前提）
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }

  if (shape.type === 'cube' || shape.type === 'box') {
    const s = shape.size ?? [MM_BASE, MM_BASE, MM_BASE];
    return new THREE.BoxGeometry(s[0], s[1], s[2]);
  }
  if (shape.type === 'cylinder') {
    const r = shape.radius ?? MM_BASE / 2;
    const h = shape.height ?? MM_BASE;
    return new THREE.CylinderGeometry(r, r, h, 24);
  }
  if (shape.type === 'cone') {
    const r = shape.radius ?? MM_BASE / 2;
    const h = shape.height ?? MM_BASE;
    return new THREE.ConeGeometry(r, h, 24);
  }

  // ===== ✅ steel：sections.js を使って再生成 =====
  const steel = shape.steel ?? shape.spec ?? {};
  const dims = shape.dims ?? {};

  const fallbackL = Math.max(1, num(shape.length, num(steel.length, num(shape.size?.[0], MM_BASE))));
  const L = Math.max(1, num(dims.length, fallbackL));

  if (shape.type === 'steel-channel') {
    return buildChannelGeometry({
      H: steel.H,
      B: steel.B,
      t1: steel.t1,
      t2: steel.t2,
      r1: steel.r1 ?? 0,
      r2: steel.r2 ?? 0,
      L,
    });
  }

  if (shape.type === 'steel-angle') {
    return buildAngleGeometry({
      A: steel.A,
      B: steel.B,
      t: steel.t,
      r1: steel.r1 ?? 0,
      r2: steel.r2 ?? 0,
      L,
    });
  }

  if (shape.type === 'steel-hbeam') {
    return buildHBeamGeometry({
      H: steel.H,
      B: steel.B,
      t1: steel.t1,
      t2: steel.t2,
      r: steel.r ?? 0,
      L,
    });
  }

  if (shape.type === 'steel-pipe') {
    return buildPipeGeometry({
      D: steel.D,
      t: steel.t,
      L,
    });
  }

  if (shape.type === 'steel-elbow90' || shape.type === 'steel-elbow45') {
    const dimsElbow = getLongElbowDimsByOD(steel.D);
    const angleDeg = shape.type === 'steel-elbow45' ? 45 : 90;
    const R = dimsElbow ? (angleDeg === 90 ? dimsElbow.F : dimsElbow.H) : 0;

    return buildPipeElbowGeometry({
      D: steel.D,
      t: steel.t,
      angleDeg,
      R,
    });
  }

  if (shape.type === 'steel-roundbar') {
    return buildRoundBarGeometry({
      D: steel.D,
      L,
    });
  }

  if (shape.type === 'steel-flatbar') {
    return buildFlatBarGeometry({
      H: steel.H,
      t: steel.t,
      L,
    });
  }

  if (shape.type === 'steel-squarepipe') {
    return buildSquarePipeGeometry({
      H: steel.H,
      B: steel.B,
      t: steel.t,
      L,
    });
  }

  if (shape.type === 'steel-expanded') {
    const width = Math.max(10, num(dims.width, 1200));
    const height = Math.max(10, num(dims.height, 600));

    return buildExpandedMetalGeometry({
      SW: steel.SW ?? steel.sw ?? undefined,
      LW: steel.LW ?? steel.lw ?? undefined,
      T: steel.T ?? steel.t ?? undefined,
      W: steel.W ?? steel.w ?? undefined,
      width,
      height,
    });
  }

  if (shape.type === 'steel-checkered') {
    const width = Math.max(10, num(dims.width, 1200));
    const height = Math.max(10, num(dims.height, 600));
    return buildCheckeredPlateGeometry({
      t: steel.t ?? 3.2,
      width,
      height,
    });
  }

  // ===== sketch-extrude =====
  if (shape.type === 'sketch-extrude') {
    const pts = shape.profile?.points ?? null;
    const len = Math.max(0.001, Number(shape.length) || 1);
    const fr = shape.frame;
    if (!fr || !pts || pts.length < 3) return new THREE.BoxGeometry(MM_BASE, MM_BASE, MM_BASE);

    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    sh.lineTo(pts[0][0], pts[0][1]);

    const geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, steps: 1, curveSegments: 8 });
    geo.translate(0, 0, -len / 2);

    const o = new THREE.Vector3(fr.origin[0], fr.origin[1], fr.origin[2]);
    const u = new THREE.Vector3(fr.u[0], fr.u[1], fr.u[2]);
    const v = new THREE.Vector3(fr.v[0], fr.v[1], fr.v[2]);
    const n = new THREE.Vector3(fr.normal[0], fr.normal[1], fr.normal[2]);

    const m = new THREE.Matrix4().makeBasis(u, v, n);
    geo.applyMatrix4(m);
    geo.translate(o.x + n.x * (len / 2), o.y + n.y * (len / 2), o.z + n.z * (len / 2));

    geo.computeVertexNormals();
    return geo;
}

  return new THREE.BoxGeometry(MM_BASE, MM_BASE, MM_BASE);
}

function uniqueVec3(list, eps = 1e-4) {
  const map = new Map();
  for (const v of list) {
    const k = `${Math.round(v.x / eps)}_${Math.round(v.y / eps)}_${Math.round(v.z / eps)}`;
    if (!map.has(k)) map.set(k, v);
  }
  return Array.from(map.values());
}

function computeSnapPoints(obj) {
  const geo = buildGeometryFromShape(obj);

  const posAttr = geo.getAttribute('position');
  const verts = [];
  for (let i = 0; i < posAttr.count; i++) {
    verts.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
  }
  const vertices = uniqueVec3(verts);

  const edges = new THREE.EdgesGeometry(geo);
  const ePos = edges.getAttribute('position');
  const mids = [];
  for (let i = 0; i < ePos.count; i += 2) {
    const a = new THREE.Vector3(ePos.getX(i), ePos.getY(i), ePos.getZ(i));
    const b = new THREE.Vector3(ePos.getX(i + 1), ePos.getY(i + 1), ePos.getZ(i + 1));
    mids.push(a.add(b).multiplyScalar(0.5));
  }
  const midpoints = uniqueVec3(mids);

  geo.dispose?.();
  edges.dispose?.();

  return { vertices, midpoints };
}

function nearestPoint(target, points) {
  let best = null;
  let bestD = Infinity;
  for (const p of points) {
    const d = p.distanceToSquared(target);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function SnapDot({ position, kind, onSetPivotHere, onLeftClick, selected }) {
  const r = kind === 'vtx' ? 0.5 : 1;
  const hitR = 10;

  const color = selected ? '#ff2d2d' : kind === 'vtx' ? '#ffd400' : '#2dd4ff';
  const edge = selected ? '#7a0000' : kind === 'vtx' ? '#7a5a00' : '#075985';

  function setCursor(v) {
    document.body.style.cursor = v ? 'pointer' : '';
  }

  const triggerPivot = (e) => {
    e.stopPropagation?.();
    e.preventDefault?.();
    e.nativeEvent?.preventDefault?.();
    onSetPivotHere?.();
  };

  const triggerLeft = (e) => {
    e.stopPropagation?.();
    e.preventDefault?.();
    e.nativeEvent?.preventDefault?.();
    onLeftClick?.();
  };

  return (
    <group position={position}>
      <mesh renderOrder={50}>
        <sphereGeometry args={[r, 16, 16]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>

      <mesh renderOrder={49}>
        <sphereGeometry args={[r * 1.25, 10, 10]} />
        <meshBasicMaterial color={edge} wireframe depthTest={false} />
      </mesh>

      <mesh
        onPointerOver={() => setCursor(true)}
        onPointerOut={() => setCursor(false)}
        onPointerDown={(e) => {
          const btn = e.button ?? e.nativeEvent?.button;
          if (btn === 0) triggerLeft(e);
        }}
        onContextMenu={(e) => {
          triggerPivot(e);
        }}
      >
        <sphereGeometry args={[hitR, 10, 10]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

// 原点は「3軸だけ」
function PivotMiniAxes() {
  return (
    <group>
      <axesHelper args={[0.35 * MM_BASE * 0.001]} />
    </group>
  );
}

/**
 * ✅ blockPointer:
 * - true の時は、立体側の pointerdown/over/out を奪わない
 */
function FusedBody({
  obj,
  selected,
  hovered,
  isPrimary,
  onSelect,
  onHover,
  selectable,
  fusedGeometry,
  showShadows,
  transparentMode = false,
  currentTool,
  onSketchModeChange,
  onExtrudeModeChange,
  extrudeMode,
  blockPointer = false,
}) {
  const pivot = obj.pivot ?? [0, 0, 0];
  const fusedMeshOffset = [-pivot[0], -pivot[1], -pivot[2]];

  const outlineColorSelected = isPrimary ? '#ff8a00' : '#ffb020';
  const outlineColorHover = isOrangeLike(obj.color ?? '#bfbfbf') ? '#2f6bff' : '#ffb020';
  const showOutline = selected || hovered;
  const outlineColor = selected ? outlineColorSelected : outlineColorHover;

  const handlePointerDown = (e) => {
    if (blockPointer) return;
    e.stopPropagation?.();

    const btn = e.button ?? e.nativeEvent?.button;
    if (btn === 2) return;

    const extrudeAlreadyPicked = currentTool === 'extrude' && !!extrudeMode?.frame;

    if ((currentTool === 'sketch2d' || currentTool === 'extrude') && !extrudeAlreadyPicked && e?.face && e?.point) {
      const n = e.face.normal?.clone?.() ?? null;
      if (n) {
        const m3 = new THREE.Matrix3().getNormalMatrix(e.object.matrixWorld);
        n.applyMatrix3(m3).normalize();

        const frame = buildSketchFrame(e.point.clone(), n);

        onSketchModeChange?.({ type: currentTool, step: 'drawing', objId: obj.id, frame });

        if (currentTool === 'extrude') {
          onExtrudeModeChange?.({ step: 'pickRegion', objId: obj.id, frame });
        }
        return;
      }
    }

    if (!selectable) return;
    onSelect?.(obj.id, e);
  };

  const handleOver = (e) => {
    if (blockPointer) return;
    e.stopPropagation?.();
    onHover?.(obj.id);
  };
  const handleOut = (e) => {
    if (blockPointer) return;
    e.stopPropagation?.();
    onHover?.(null);
  };

  const sources = obj.sources ?? [];
  const fallbackColor = obj.color ?? '#bfbfbf';

  return (
    <group position={fusedMeshOffset}>
      {sources.map((s, i) => {
        const g = buildGeometryFromShape(s);
        const rp = s.localPosition ?? [0, 0, 0];
        const rr = s.localRotation ?? [0, 0, 0];

        const pv = s.pivot ?? [0, 0, 0];
        const meshOffset = [-pv[0], -pv[1], -pv[2]];

        const col = s.color ?? fallbackColor;

        return (
          <mesh
            key={`${obj.id}_src_${i}`}
            geometry={g}
            position={[
              (rp[0] ?? 0) + (meshOffset[0] ?? 0),
              (rp[1] ?? 0) + (meshOffset[1] ?? 0),
              (rp[2] ?? 0) + (meshOffset[2] ?? 0),
            ]}
            rotation={[rr[0] ?? 0, rr[1] ?? 0, rr[2] ?? 0]}
            castShadow={!!showShadows}
            receiveShadow={!!showShadows}
            raycast={() => null}
          >
            <meshStandardMaterial
              color={col}
              transparent={transparentMode}
              opacity={transparentMode ? 0.35 : 1}
              depthWrite={!transparentMode}
            />
          </mesh>
        );
      })}

      <mesh
        geometry={fusedGeometry}
        onPointerDown={handlePointerDown}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
        castShadow={false}
        receiveShadow={false}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        {showOutline ? <Outlines thickness={3} color={outlineColor} /> : null}
      </mesh>
    </group>
  );
}

function MeshBody({
  obj,
  selected,
  hovered,
  isPrimary,
  onSelect,
  onHover,
  selectable,
  showShadows,
  transparentMode = false,
  currentTool,
  onSketchModeChange,
  onExtrudeModeChange,
  extrudeMode,
  blockPointer = false,
}) {
  const color = obj.color ?? '#bfbfbf';

  const outlineColorSelected = isPrimary ? '#ff8a00' : '#ffb020';
  const outlineColorHover = isOrangeLike(color) ? '#2f6bff' : '#ffb020';
  const showOutline = selected || hovered;
  const outlineColor = selected ? outlineColorSelected : outlineColorHover;

  const pivot = obj.pivot ?? [0, 0, 0];
  const meshOffset = [-pivot[0], -pivot[1], -pivot[2]];

  const Mat = (
    <meshStandardMaterial
      key={`${color}_${transparentMode ? 't' : 'o'}`}
      color={color}
      transparent={transparentMode}
      opacity={transparentMode ? 0.35 : 1}
      depthWrite={!transparentMode}
    />
  );

  const handlePointerDown = (e) => {
    if (blockPointer) return;
    e.stopPropagation?.();

    const btn = e.button ?? e.nativeEvent?.button;
    if (btn === 2) return;

    const extrudeAlreadyPicked = currentTool === 'extrude' && !!extrudeMode?.frame;

    if ((currentTool === 'sketch2d' || currentTool === 'extrude') && !extrudeAlreadyPicked && e?.face && e?.point) {
      const n = e.face.normal?.clone?.() ?? null;
      if (n) {
        const m3 = new THREE.Matrix3().getNormalMatrix(e.object.matrixWorld);
        n.applyMatrix3(m3).normalize();

        const frame = buildSketchFrame(e.point.clone(), n);

        onSketchModeChange?.({ type: currentTool, step: 'drawing', objId: obj.id, frame });

        if (currentTool === 'extrude') {
          onExtrudeModeChange?.({ step: 'pickRegion', objId: obj.id, frame });
        }
        return;
      }
    }

    if (!selectable) return;
    onSelect?.(obj.id, e);
  };

  const handleOver = (e) => {
    if (blockPointer) return;
    e.stopPropagation?.();
    onHover?.(obj.id);
  };
  const handleOut = (e) => {
    if (blockPointer) return;
    onHover?.(null);
  };

  const common = {
    position: meshOffset,
    castShadow: !!showShadows,
    receiveShadow: !!showShadows,
    onPointerDown: handlePointerDown,
    onPointerOver: handleOver,
    onPointerOut: handleOut,
  };

  // ✅ geometryで描くタイプ（steel系/スケッチ）
  if (
    obj.type === 'steel-channel' ||
    obj.type === 'steel-angle' ||
    obj.type === 'steel-hbeam' ||
    obj.type === 'steel-pipe' ||
    obj.type === 'steel-elbow90' ||
    obj.type === 'steel-elbow45' ||
    obj.type === 'steel-roundbar' ||
    obj.type === 'steel-flatbar' ||
    obj.type === 'steel-squarepipe' ||
    obj.type === 'steel-expanded' ||
    obj.type === 'steel-checkered' ||
    obj.type === 'sketch-extrude' ||
    obj.type === 'plate'
  ) {
    const geo = buildGeometryFromShape(obj);
    return (
      <mesh {...common} geometry={geo}>
        {Mat}
        {showOutline ? <Outlines thickness={3} color={outlineColor} /> : null}
      </mesh>
    );
  }

  if (obj.type === 'cube' || obj.type === 'box') {
    const s = obj.size ?? [MM_BASE, MM_BASE, MM_BASE];
    return (
      <mesh {...common}>
        <boxGeometry args={s} />
        {Mat}
        {showOutline ? <Outlines thickness={3} color={outlineColor} /> : null}
      </mesh>
    );
  }

  if (obj.type === 'cylinder') {
    const r = obj.radius ?? MM_BASE / 2;
    const h = obj.height ?? MM_BASE;
    return (
      <mesh {...common}>
        <cylinderGeometry args={[r, r, h, 24]} />
        {Mat}
        {showOutline ? <Outlines thickness={3} color={outlineColor} /> : null}
      </mesh>
    );
  }

  if (obj.type === 'cone') {
    const r = obj.radius ?? MM_BASE / 2;
    const h = obj.height ?? MM_BASE;
    return (
      <mesh {...common}>
        <coneGeometry args={[r, h, 24]} />
        {Mat}
        {showOutline ? <Outlines thickness={3} color={outlineColor} /> : null}
      </mesh>
    );
  }

  return null;
}

function centroidOfSelected(objects, selectedIds) {
  const pts = objects.filter((o) => selectedIds.includes(o.id)).map((o) => o.position ?? [0, 0, 0]);
  if (pts.length === 0) return [0, 0, 0];

  let sx = 0,
    sy = 0,
    sz = 0;
  for (const p of pts) {
    sx += p[0];
    sy += p[1];
    sz += p[2];
  }
  return [sx / pts.length, sy / pts.length, sz / pts.length];
}

export default function EditorCanvas({
  objects = [],
  selectedIds = [],
  primaryId = null,
  hoveredId = null,
  onSelect,
  onHover,

  currentTool = 'select',
  selectMode = 'body',
  zoomSensitivity = 1.0,

  onLiveMove,
  onCommitMove,

  onLiveScale,
  onCommitScale,

  onSetPivotLocal,

  onLivePanDelta,
  onCommitPanDelta,

  showShadows = true,
  showGrid = true,
  transparentMode = false,

  sketchMode,
  onSketchModeChange,
  sketchEntities,
  onSketchEntitiesChange,

  extrudeMode,
  onExtrudeModeChange,

  // ✅ 追加：ページから渡される「頂点移動 1点目」
  snapMovePick = null,
  onSnapMovePickChange,
}) {
  const isDup = currentTool === 'dup-translate' || currentTool === 'dup-rotate' || currentTool === 'dup-mirror';
  const isVertexMove = currentTool === 'vertex-move';
  const isSketch = currentTool === 'sketch2d' || currentTool === 'extrude';

  const isTouchDevice = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia?.('(pointer: coarse)')?.matches
    );
  }, []);

  const mobileViewMode = isTouchDevice;

  const selectable = mobileViewMode
    ? false
    : currentTool === 'select' ||
      currentTool === 'pan' ||
      currentTool === 'rotate' ||
      isDup ||
      isVertexMove ||
      isSketch;

  const drawable = useMemo(() => objects.filter((o) => o.type !== 'group'), [objects]);

  // ✅ wheel のクロージャ固定を防ぐ：常に最新 drawable を参照
  const drawableRef = useRef(drawable);
  useEffect(() => {
    drawableRef.current = drawable;
  }, [drawable]);

  const singleSelectionForMove = selectedIds.length === 1 && !!primaryId;
  const primaryObj = useMemo(() => drawable.find((o) => o.id === primaryId) ?? null, [drawable, primaryId]);

  const groupRef = useRef(null);
  const tcMoveRef = useRef(null);

  const pivotHandleRef = useRef(null);
  const tcPivotRef = useRef(null);

  const panRef = useRef(null);
  const tcPanRef = useRef(null);
  const panStartPosRef = useRef(new THREE.Vector3(0, 0, 0));

  const [isTransforming, setIsTransforming] = useState(false);
  const [bodyMode, setBodyMode] = useState('translate');

useEffect(() => {
  const onKey = (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable))
      return;

    const k = String(e.key || '').toLowerCase();

    if (k === 'g') setBodyMode('translate');
    if (k === 's') setBodyMode('scale');

    // ✅ 1点目選択を Escape でキャンセル（確実に拾う）
    if (k === 'escape') {
      e.preventDefault?.();
      onSnapMovePickChange?.(null);
    }
  };

  // ✅ capture で取りこぼし防止
  window.addEventListener('keydown', onKey, { capture: true });
  return () => window.removeEventListener('keydown', onKey, { capture: true });
}, [onSnapMovePickChange]);


  useEffect(() => {
    if (!isVertexMove) onSnapMovePickChange?.(null);
  }, [isVertexMove, onSnapMovePickChange]);

  const gizmoControlsRef = useRef(null);

  const fusedGeometryMap = useMemo(() => {
    const map = new Map();
    for (const o of drawable) {
      if (o.type === 'fused') map.set(o.id, buildFusedGeometry(o));
    }
    return map;
  }, [drawable]);

  useEffect(() => {
    return () => {
      for (const g of fusedGeometryMap.values()) g.dispose?.();
    };
  }, [fusedGeometryMap]);

  const snap = useMemo(() => {
    if (!primaryObj) return { vertices: [], midpoints: [] };
    return computeSnapPoints(primaryObj);
  }, [primaryObj]);

  const pivot = primaryObj?.pivot ?? [0, 0, 0];
  const pivotVec = useMemo(() => new THREE.Vector3(pivot[0], pivot[1], pivot[2]), [pivot]);

  const verticesGroup = useMemo(() => snap.vertices.map((v) => v.clone().sub(pivotVec)), [snap.vertices, pivotVec]);
  const midpointsGroup = useMemo(() => snap.midpoints.map((v) => v.clone().sub(pivotVec)), [snap.midpoints, pivotVec]);
  const snapPointsGroup = useMemo(() => [...verticesGroup, ...midpointsGroup], [verticesGroup, midpointsGroup]);

  const lastScalePatchRef = useRef(null);

  const isSketchDrawing = currentTool === 'sketch2d' && sketchMode?.step === 'drawing';

  // ====== transform (body) ======
  useEffect(() => {
    const tc = tcMoveRef.current;
    if (!tc) return;

    const onDraggingChanged = (e) => {
      const dragging = !!e.value;
      setIsTransforming(dragging);

      if (!dragging && groupRef.current && primaryObj && primaryId) {
        if (bodyMode === 'translate') {
          const p = groupRef.current.position;
          onCommitMove?.(primaryId, [p.x, p.y, p.z]);
          return;
        }

        if (bodyMode === 'scale') {
          const patch = lastScalePatchRef.current;
          lastScalePatchRef.current = null;
          if (patch && Object.keys(patch).length > 0) {
            onCommitScale?.(primaryId, patch);
          }
        }
      }
    };

    const onObjChange = () => {
      if (!groupRef.current || !primaryId) return;

      if (bodyMode === 'translate') {
        const p = groupRef.current.position;
        onLiveMove?.(primaryId, [p.x, p.y, p.z]);
        return;
      }

      if (bodyMode === 'scale' && primaryObj) {
        const sc = groupRef.current.scale.clone();
        const patch = applyScaleToObject(primaryObj, sc);
        groupRef.current.scale.set(1, 1, 1);
        lastScalePatchRef.current = patch;

        if (patch && Object.keys(patch).length > 0) {
          onLiveScale?.(primaryId, patch);
        }
      }
    };

    tc.addEventListener('dragging-changed', onDraggingChanged);
    tc.addEventListener('objectChange', onObjChange);
    return () => {
      tc.removeEventListener('dragging-changed', onDraggingChanged);
      tc.removeEventListener('objectChange', onObjChange);
    };
  }, [onLiveMove, onCommitMove, onLiveScale, onCommitScale, primaryId, primaryObj, bodyMode]);

  // ====== pivot move (vertex mode) ======
  useEffect(() => {
    const tc = tcPivotRef.current;
    if (!tc) return;

    const onDraggingChanged = (e) => {
      const dragging = !!e.value;
      setIsTransforming(dragging);

      if (!dragging && pivotHandleRef.current && primaryObj) {
        const h = pivotHandleRef.current.position.clone();
        const near = nearestPoint(h, snapPointsGroup);
        if (!near) return;

        const newPivotLocal = near.clone().add(pivotVec);
        onSetPivotLocal?.([newPivotLocal.x, newPivotLocal.y, newPivotLocal.z]);
        pivotHandleRef.current.position.set(0, 0, 0);
      }
    };

    const onObjChange = () => {
      if (!pivotHandleRef.current) return;
      const h = pivotHandleRef.current.position.clone();
      const near = nearestPoint(h, snapPointsGroup);
      if (near) pivotHandleRef.current.position.copy(near);
    };

    tc.addEventListener('dragging-changed', onDraggingChanged);
    tc.addEventListener('objectChange', onObjChange);
    return () => {
      tc.removeEventListener('dragging-changed', onDraggingChanged);
      tc.removeEventListener('objectChange', onObjChange);
    };
  }, [snapPointsGroup, pivotVec, onSetPivotLocal, primaryObj]);

  function setPivotAtGroupPoint(groupPoint) {
    if (!primaryObj) return;
    const newPivotLocal = groupPoint.clone().add(pivotVec);
    onSetPivotLocal?.([newPivotLocal.x, newPivotLocal.y, newPivotLocal.z]);
  }

  // ✅ 追加：グループ座標の点 → ワールド座標
  function worldPointOfGroupPoint(obj, groupPoint) {
    const p = obj.position ?? [0, 0, 0];
    const r = obj.rotation ?? [0, 0, 0];

    const posV = new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0));

    return groupPoint.clone().applyQuaternion(q).add(posV);
  }

  // ✅ 追加：頂点移動（1点目→2点目へスナップ移動）
 function handleSnapMoveClick(objId, kind, groupPoint) {
  if (!isVertexMove) return;
  if (!primaryId) return;

  const moveObj = drawable.find((o) => o.id === primaryId);
  if (!moveObj) return;

  // ✅ 1点目：動かす対象（primary）の点だけ許可
  if (!snapMovePick) {
    if (objId !== primaryId) return;
    onSnapMovePickChange?.({ objId: primaryId, kind, groupPoint: groupPoint.clone() });
    return;
  }

  // ✅ 2点目：ターゲットは「どのオブジェクトでもOK」
  const pickObj = drawable.find((o) => o.id === snapMovePick.objId);
  const targetObj = drawable.find((o) => o.id === objId);
  if (!pickObj || !targetObj) return;

  const aW = worldPointOfGroupPoint(pickObj, snapMovePick.groupPoint);
  const bW = worldPointOfGroupPoint(targetObj, groupPoint);
  const delta = bW.clone().sub(aW);

  const p = moveObj.position ?? [0, 0, 0];
  const np = [(p[0] ?? 0) + delta.x, (p[1] ?? 0) + delta.y, (p[2] ?? 0) + delta.z];

  onLiveMove?.(primaryId, np);
  onCommitMove?.(primaryId, np);
  onSnapMovePickChange?.(null);
}

function isPickedPoint(objId, kind, p) {
  if (!snapMovePick) return false;
  if (snapMovePick.objId !== objId) return false;
  if (snapMovePick.kind !== kind) return false;
  const gp = snapMovePick.groupPoint;
  if (!gp || !gp.distanceToSquared) return false;
  return gp.distanceToSquared(p) < 1e-9;
}


  // ====== pan gizmo ======
  useEffect(() => {
    const tc = tcPanRef.current;
    if (!tc) return;

    const onDraggingChanged = (e) => {
      const dragging = !!e.value;
      setIsTransforming(dragging);

      if (!dragging && panRef.current) {
        const p = panRef.current.position;
        const d = new THREE.Vector3().subVectors(p, panStartPosRef.current);
        onCommitPanDelta?.({ x: d.x, y: d.y, z: d.z });
        panRef.current.position.copy(panStartPosRef.current);
      }
    };

    const onObjChange = () => {
      if (!panRef.current) return;
      const p = panRef.current.position;
      const d = new THREE.Vector3().subVectors(p, panStartPosRef.current);
      onLivePanDelta?.({ x: d.x, y: d.y, z: d.z });
    };

    tc.addEventListener('dragging-changed', onDraggingChanged);
    tc.addEventListener('objectChange', onObjChange);
    return () => {
      tc.removeEventListener('dragging-changed', onDraggingChanged);
      tc.removeEventListener('objectChange', onObjChange);
    };
  }, [onLivePanDelta, onCommitPanDelta]);

  const panCenter = useMemo(() => centroidOfSelected(drawable, selectedIds), [drawable, selectedIds]);

  useEffect(() => {
    if (currentTool !== 'pan') return;
    panStartPosRef.current = new THREE.Vector3(panCenter[0], panCenter[1], panCenter[2]);
    if (panRef.current) panRef.current.position.set(panCenter[0], panCenter[1], panCenter[2]);
  }, [currentTool, panCenter[0], panCenter[1], panCenter[2], selectedIds.join('|')]);

  const showPanGizmo = currentTool === 'pan' && selectedIds.length > 0;

  // ✅ スケッチ用 3Dスナップ候補（面上の頂点/中点だけ）
  const sketchSnapWorldCandidates = useMemo(() => {
    if (!(currentTool === 'sketch2d' && sketchMode?.step === 'drawing' && sketchMode?.frame && sketchMode?.objId)) return [];

    const obj = drawable.find((o) => o.id === sketchMode.objId);
    if (!obj) return [];

    const { vertices, midpoints } = computeSnapPoints(obj);

    const pv = obj.pivot ?? [0, 0, 0];
    const pivotV = new THREE.Vector3(pv[0] ?? 0, pv[1] ?? 0, pv[2] ?? 0);

    const p = obj.position ?? [0, 0, 0];
    const posV = new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);

    const r = obj.rotation ?? [0, 0, 0];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0));

    const fr = sketchMode.frame;
    const oV = new THREE.Vector3(fr.origin[0], fr.origin[1], fr.origin[2]);
    const nV = new THREE.Vector3(fr.normal[0], fr.normal[1], fr.normal[2]).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(nV, oV);

    const EPS_PLANE = 0.25;

    const out = [];

    for (const v of vertices) {
      const gp = v.clone().sub(pivotV);
      const wp = gp.applyQuaternion(q).add(posV);
      const d = Math.abs(plane.distanceToPoint(wp));
      if (d <= EPS_PLANE) out.push({ kind: 'vtx', p: wp });
    }
    for (const m of midpoints) {
      const gp = m.clone().sub(pivotV);
      const wp = gp.applyQuaternion(q).add(posV);
      const d = Math.abs(plane.distanceToPoint(wp));
      if (d <= EPS_PLANE) out.push({ kind: 'mid', p: wp });
    }

    const MAX = 1200;
    if (out.length > MAX) {
      const step = Math.max(1, Math.floor(out.length / MAX));
      return out.filter((_, i) => i % step === 0);
    }

    return out;
  }, [currentTool, sketchMode?.step, sketchMode?.objId, sketchMode?.frame, drawable]);

  return (
    <Canvas
      camera={{ position: [6000, 4000, 6000], fov: 50, near: 1, far: 500000 }}
      shadows={!!showShadows}
      onCreated={({ gl }) => {
        gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // ✅ wheel move：drawable は ref で常に最新
        const onWheel = (e) =>
          applyWheelMove({
            e,
            objects: drawableRef.current,
            primaryId,
            onLiveMove,
            onCommitMove,
            currentTool,
          });

        gl.domElement.addEventListener('wheel', onWheel, { passive: false });
        return () => gl.domElement.removeEventListener('wheel', onWheel);
      }}
           onPointerMissed={() => {
        if (mobileViewMode) return;
        if (selectable) onSelect?.(null, null);
      }}

    >
      <ambientLight intensity={0.65} />
      <directionalLight position={[8000, 10000, 6000]} intensity={1.0} castShadow={!!showShadows} />

      {showGrid ? <Grid infiniteGrid cellSize={100} sectionSize={1000} fadeDistance={70000} /> : null}

      {showShadows ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[400000, 400000]} />
          <shadowMaterial opacity={0.18} />
        </mesh>
      ) : null}

      {showPanGizmo ? (
        <TransformControls ref={tcPanRef} mode="translate" size={1.0}>
          <group ref={panRef} position={panCenter}>
            <axesHelper args={[600]} />
          </group>
        </TransformControls>
      ) : null}

      {drawable.map((o) => {
        const selected = selectedIds.includes(o.id);
        const isPrimary = o.id === primaryId;
        const hovered = o.id === hoveredId && !selected;

        const groupPos = o.position ?? [0, 0, 0];
        const rot = o.rotation ?? [0, 0, 0];

        const fusedGeo = o.type === 'fused' ? fusedGeometryMap.get(o.id) : null;

      if (!mobileViewMode && singleSelectionForMove && isPrimary && currentTool === 'select' && selectMode === 'body') {
          return (
            <TransformControls key={o.id} ref={tcMoveRef} mode={bodyMode} size={0.9}>
              <group ref={groupRef} position={groupPos} rotation={rot}>
                <PivotMiniAxes />
                {o.type === 'fused' ? (
                  <FusedBody
                    obj={o}
                    selected={selected}
                    hovered={hovered}
                    isPrimary={isPrimary}
                    onSelect={onSelect}
                    onHover={onHover}
                    selectable={selectable}
                    fusedGeometry={fusedGeo}
                    showShadows={showShadows}
                    transparentMode={transparentMode}
                    currentTool={currentTool}
                    onSketchModeChange={onSketchModeChange}
                    onExtrudeModeChange={onExtrudeModeChange}
                    extrudeMode={extrudeMode}
                    blockPointer={isSketchDrawing || (isVertexMove && selectMode === 'vertex')}
                  />
                ) : (
                  <MeshBody
                    obj={o}
                    selected={selected}
                    hovered={hovered}
                    isPrimary={isPrimary}
                    onSelect={onSelect}
                    onHover={onHover}
                    selectable={selectable}
                    showShadows={showShadows}
                    transparentMode={transparentMode}
                    currentTool={currentTool}
                    onSketchModeChange={onSketchModeChange}
                    onExtrudeModeChange={onExtrudeModeChange}
                    extrudeMode={extrudeMode}
                    blockPointer={isSketchDrawing || (isVertexMove && selectMode === 'vertex')}
                  />
                )}
              </group>
            </TransformControls>
          );
        }

        // ✅ ここが重要：vertex-move でも頂点モード表示する
        if (!mobileViewMode && (currentTool === 'select' || isVertexMove) && selectMode === 'vertex') {
  // ✅ 各オブジェクトのスナップ点を計算して表示（vertex-move のターゲットに使う）
  const sp = computeSnapPoints(o);

  const pv = o.pivot ?? [0, 0, 0];
  const pivotV = new THREE.Vector3(pv[0] ?? 0, pv[1] ?? 0, pv[2] ?? 0);

  const vtxG = sp.vertices.map((v) => v.clone().sub(pivotV));
  const midG = sp.midpoints.map((v) => v.clone().sub(pivotV));

  return (
    <group key={o.id} ref={isPrimary ? groupRef : undefined} position={groupPos} rotation={rot}>
      <PivotMiniAxes />

      {o.type === 'fused' ? (
        <FusedBody
          obj={o}
          selected={selected}
          hovered={hovered}
          isPrimary={isPrimary}
          onSelect={onSelect}
          onHover={onHover}
          selectable={selectable}
          fusedGeometry={fusedGeo}
                    showShadows={showShadows}
                    transparentMode={transparentMode}
                    currentTool={currentTool}
          onSketchModeChange={onSketchModeChange}
          onExtrudeModeChange={onExtrudeModeChange}
          extrudeMode={extrudeMode}
          blockPointer={isSketchDrawing || (isVertexMove && selectMode === 'vertex')}
        />
      ) : (
        <MeshBody
          obj={o}
          selected={selected}
          hovered={hovered}
          isPrimary={isPrimary}
          onSelect={onSelect}
          onHover={onHover}
          selectable={selectable}
                    showShadows={showShadows}
                    transparentMode={transparentMode}
                    currentTool={currentTool}
          onSketchModeChange={onSketchModeChange}
          onExtrudeModeChange={onExtrudeModeChange}
          extrudeMode={extrudeMode}
          blockPointer={isSketchDrawing || (isVertexMove && selectMode === 'vertex')}
        />
      )}

      {vtxG.map((p, idx) => (
        <SnapDot
          key={`${o.id}_v_${idx}`}
          position={[p.x, p.y, p.z]}
          kind="vtx"
          onSetPivotHere={isPrimary ? () => setPivotAtGroupPoint(p) : undefined}
          onLeftClick={() => handleSnapMoveClick(o.id, 'vtx', p)}
          selected={isPickedPoint(o.id, 'vtx', p)}
        />
      ))}

      {midG.map((p, idx) => (
        <SnapDot
          key={`${o.id}_m_${idx}`}
          position={[p.x, p.y, p.z]}
          kind="mid"
          onSetPivotHere={isPrimary ? () => setPivotAtGroupPoint(p) : undefined}
          onLeftClick={() => handleSnapMoveClick(o.id, 'mid', p)}
          selected={isPickedPoint(o.id, 'mid', p)}
        />
      ))}

      {/* ✅ pivot操作ハンドルは primary だけ */}
      {isPrimary ? (
        <TransformControls ref={tcPivotRef} mode="translate" size={0.8}>
          <group ref={pivotHandleRef} position={[0, 0, 0]}>
            <axesHelper args={[600]} />
            <mesh>
              <boxGeometry args={[220, 220, 220]} />
              <meshBasicMaterial transparent opacity={0} depthTest={false} />
            </mesh>
          </group>
        </TransformControls>
      ) : null}
    </group>
  );
}

        return (
          <group key={o.id} position={groupPos} rotation={rot}>
            <PivotMiniAxes />

            {o.type === 'fused' ? (
              <FusedBody
                obj={o}
                selected={selected}
                hovered={hovered}
                isPrimary={isPrimary}
                onSelect={onSelect}
                onHover={onHover}
                selectable={selectable}
                fusedGeometry={fusedGeo}
                    showShadows={showShadows}
                    transparentMode={transparentMode}
                    currentTool={currentTool}
                onSketchModeChange={onSketchModeChange}
                onExtrudeModeChange={onExtrudeModeChange}
                extrudeMode={extrudeMode}
                blockPointer={isSketchDrawing || (isVertexMove && selectMode === 'vertex')}
              />
            ) : (
              <MeshBody
                obj={o}
                selected={selected}
                hovered={hovered}
                isPrimary={isPrimary}
                onSelect={onSelect}
                onHover={onHover}
                selectable={selectable}
                    showShadows={showShadows}
                    transparentMode={transparentMode}
                    currentTool={currentTool}
                onSketchModeChange={onSketchModeChange}
                onExtrudeModeChange={onExtrudeModeChange}
                extrudeMode={extrudeMode}
                blockPointer={isSketchDrawing || (isVertexMove && selectMode === 'vertex')}
              />
            )}
          </group>
        );
      })}

      {currentTool === 'sketch2d' && sketchMode?.frame ? <SketchPlane frame={sketchMode.frame} /> : null}
      {currentTool === 'extrude' && extrudeMode?.frame ? <SketchPlane frame={extrudeMode.frame} /> : null}

      {currentTool === 'sketch2d' && sketchMode?.step === 'drawing' && sketchMode?.frame ? (
        <SketchOverlay
          active={true}
          mode="draw"
          frame={sketchMode.frame}
          tool={sketchMode.tool ?? 'line'}
          entities={sketchEntities ?? []}
          lineConstraint={{
            lengthMm: sketchMode?.lineLen ?? '',
            angleDeg: sketchMode?.lineAng ?? '',
          }}
          snapWorldCandidates={sketchSnapWorldCandidates}
          onAddEntity={(ent) => {
            const next = [...(sketchEntities ?? []), ent];
            onSketchEntitiesChange?.(next);
          }}
          onSetCursorHint={(c) => {
            document.body.style.cursor = c || '';
          }}
        />
      ) : null}

      {currentTool === 'extrude' && extrudeMode?.step === 'pickRegion' && extrudeMode?.frame ? (
        <SketchOverlay
          active={true}
          mode="pick-loop"
          frame={extrudeMode.frame}
          tool={'line'}
          entities={sketchEntities ?? []}
          loops2D={extrudeMode.loops ?? []}
          onPickLoop={(loop) => {
            onExtrudeModeChange?.({
              step: 'pickRegion',
              selectedLoopId: loop?.id ?? null,
              selectedLoop: loop ?? null,
            });
          }}
          onSetCursorHint={(c) => {
            document.body.style.cursor = c || '';
          }}
        />
      ) : null}

      {currentTool === 'extrude' && extrudeMode?.step === 'pickRegion' && extrudeMode?.frame && extrudeMode?.selectedLoop ? (
        <mesh geometry={hatchShapeMesh(extrudeMode.frame, extrudeMode.selectedLoop.points)} renderOrder={80}>
          <meshBasicMaterial transparent opacity={0.25} depthWrite={false} color="#ff8a00" />
        </mesh>
      ) : null}

      <CustomCameraControls enabled={!isTransforming} zoomSensitivity={zoomSensitivity} />

      <OrbitControls ref={gizmoControlsRef} enabled={false} enableRotate={false} enablePan={false} enableZoom={false} />

      <GizmoHelper alignment="top-right" margin={[90, 90]} controls={gizmoControlsRef}>
        <GizmoViewport axisHeadScale={0.9} labelColor="black" />
      </GizmoHelper>
    </Canvas>
  );
}
