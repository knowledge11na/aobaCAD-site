// file: components/EditorCanvas.js
'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { Grid, Outlines, TransformControls, GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
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
const ZERO_VEC3 = Object.freeze([0, 0, 0]);
const UNIT_SCALE = Object.freeze([1, 1, 1]);

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
 * - 長さのある鋼材は spec/dims から再生成し、外形角をローカル原点にそろえる
 * - その他は SteelAddPanel から渡される __geometry があれば優先する
 */
const LINEAR_STEEL_TYPES = new Set([
  'steel-channel',
  'steel-angle',
  'steel-hbeam',
  'steel-pipe',
  'steel-roundbar',
  'steel-flatbar',
  'steel-squarepipe',
]);

// CSG結果には細長い三角形があり、その法線は不安定。面積で重み付けして、
// 大きな面の陰影が細長い三角形に引きずられて黒ずむのを防ぐ
function buildAreaWeightedCreasedGeometry(positions, creaseAngle) {
  const triCount = positions.length / 9;
  const faceNormals = new Array(triCount);
  const areas = new Array(triCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const key = (i) =>
    `${Math.round(positions[i] * 100)}_${Math.round(positions[i + 1] * 100)}_${Math.round(positions[i + 2] * 100)}`;
  const byVertex = new Map();

  for (let t = 0; t < triCount; t++) {
    a.fromArray(positions, t * 9);
    b.fromArray(positions, t * 9 + 3);
    c.fromArray(positions, t * 9 + 6);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const len = n.length();
    areas[t] = len / 2;
    faceNormals[t] = len > 0 ? n.divideScalar(len) : n;
    for (let k = 0; k < 3; k++) {
      const vk = key(t * 9 + k * 3);
      const list = byVertex.get(vk);
      if (list) list.push(t);
      else byVertex.set(vk, [t]);
    }
  }

  const cosCrease = Math.cos(creaseAngle);
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < triCount; t++) {
    // 細長い三角形自身の法線は、面積の大きい周囲の三角形に合わせる
    for (let k = 0; k < 3; k++) {
      const neighbors = byVertex.get(key(t * 9 + k * 3));
      let ref = faceNormals[t];
      let refArea = areas[t];
      for (const o of neighbors) {
        if (areas[o] > refArea && faceNormals[o].dot(faceNormals[t]) > cosCrease) {
          ref = faceNormals[o];
          refArea = areas[o];
        }
      }
      const sum = new THREE.Vector3();
      for (const o of neighbors) {
        if (faceNormals[o].dot(ref) > cosCrease) sum.addScaledVector(faceNormals[o], areas[o]);
      }
      if (sum.lengthSq() === 0) sum.copy(faceNormals[t]);
      sum.normalize();
      sum.toArray(normals, t * 9 + k * 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

function buildGeometryFromShape(shape) {
  if (!shape) return new THREE.BoxGeometry(MM_BASE, MM_BASE, MM_BASE);

  if (shape.meshData) {
    const positions = shape.meshData.positions;
    if (!Array.isArray(positions) || positions.length % 3 !== 0) {
      throw new Error(`Invalid stored mesh geometry for shape "${shape.name ?? shape.type}"`);
    }
    const raw = new THREE.BufferGeometry();
    // CSG由来の面積ゼロの三角形は法線が不定になり黒ずみの原因になるため除く
    const cleaned = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 9) {
      a.fromArray(positions, i);
      b.fromArray(positions, i + 3);
      c.fromArray(positions, i + 6);
      const area2 = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq();
      if (area2 > 1e-8) cleaned.push(...positions.slice(i, i + 9));
    }
    raw.setAttribute('position', new THREE.Float32BufferAttribute(cleaned, 3));
    // 円形の穴などが面ごとに明暗の縞にならないよう、緩い角は滑らかな法線にする
    const geometry = buildAreaWeightedCreasedGeometry(cleaned, Math.PI / 6);
    raw.dispose();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  // ✅ 先に「渡されたジオメトリ」を優先（clone）
  if (shape.__geometry && !LINEAR_STEEL_TYPES.has(shape.type)) {
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
  const anchorSteelGeometry = (geometry) => {
    geometry.computeBoundingBox();
    const min = geometry.boundingBox.min;
    geometry.translate(-min.x, -min.y, -min.z);
    geometry.computeBoundingBox();
    return geometry;
  };

  if (shape.type === 'steel-channel') {
    return anchorSteelGeometry(buildChannelGeometry({
      H: steel.H,
      B: steel.B,
      t1: steel.t1,
      t2: steel.t2,
      r1: steel.r1 ?? 0,
      r2: steel.r2 ?? 0,
      L,
    }));
  }

  if (shape.type === 'steel-angle') {
    return anchorSteelGeometry(buildAngleGeometry({
      A: steel.A,
      B: steel.B,
      t: steel.t,
      r1: steel.r1 ?? 0,
      r2: steel.r2 ?? 0,
      L,
    }));
  }

  if (shape.type === 'steel-hbeam') {
    return anchorSteelGeometry(buildHBeamGeometry({
      H: steel.H,
      B: steel.B,
      t1: steel.t1,
      t2: steel.t2,
      r: steel.r ?? 0,
      L,
    }));
  }

  if (shape.type === 'steel-pipe') {
    return anchorSteelGeometry(buildPipeGeometry({
      D: steel.D,
      t: steel.t,
      L,
    }));
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
    return anchorSteelGeometry(buildRoundBarGeometry({
      D: steel.D,
      L,
    }));
  }

  if (shape.type === 'steel-flatbar') {
    return anchorSteelGeometry(buildFlatBarGeometry({
      H: steel.H,
      t: steel.t,
      L,
    }));
  }

  if (shape.type === 'steel-squarepipe') {
    return anchorSteelGeometry(buildSquarePipeGeometry({
      H: steel.H,
      B: steel.B,
      t: steel.t,
      L,
    }));
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

function calculateGeometryVolumeMm3(geometry) {
  const position = geometry.getAttribute('position');
  if (!position) {
    throw new Error('Cannot calculate volume: geometry has no vertices');
  }

  const index = geometry.getIndex();
  const vertexCount = index ? index.count : position.count;
  if (vertexCount % 3 !== 0) {
    throw new Error('Cannot calculate volume: invalid triangle data');
  }

  let volumeMm3 = 0;
  for (let i = 0; i < vertexCount; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    const ax = position.getX(ia);
    const ay = position.getY(ia);
    const az = position.getZ(ia);
    const bx = position.getX(ib);
    const by = position.getY(ib);
    const bz = position.getZ(ib);
    const cx = position.getX(ic);
    const cy = position.getY(ic);
    const cz = position.getZ(ic);

    volumeMm3 += (
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx)
    ) / 6;
  }
  return Math.abs(volumeMm3);
}

export function getShapeWeightKg(shape) {
  const geometry = buildGeometryFromShape(shape);
  try {
    return (calculateGeometryVolumeMm3(geometry) * 7.85) / 1_000_000;
  } finally {
    geometry.dispose?.();
  }
}

function createGeometryInObjectSpace(shape) {
    let geometry = buildGeometryFromShape(shape);
    const pivot = shape.pivot ?? [0, 0, 0];
    const scale = shape.mirrorScale ?? UNIT_SCALE;
    const localMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(-pivot[0] * scale[0], -pivot[1] * scale[1], -pivot[2] * scale[2]),
      new THREE.Quaternion(),
      new THREE.Vector3(scale[0], scale[1], scale[2]),
    );
    geometry.applyMatrix4(localMatrix);
    if (localMatrix.determinant() < 0) {
      const expandedGeometry = geometry.index ? geometry.toNonIndexed() : geometry;
      if (expandedGeometry !== geometry) geometry.dispose();
      geometry = expandedGeometry;
      const position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i += 3) {
        for (let axis = 0; axis < 3; axis++) {
          const second = position.getComponent(i + 1, axis);
          position.setComponent(i + 1, axis, position.getComponent(i + 2, axis));
          position.setComponent(i + 2, axis, second);
        }
      }
      geometry.clearGroups();
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();
    return geometry;
}

function getPoseMatrix(shape) {
  const position = shape.position ?? ZERO_VEC3;
  const rotation = shape.rotation ?? ZERO_VEC3;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ'),
    ),
    new THREE.Vector3(1, 1, 1),
  );
}

const WELD_EPS = 1e-6;

function getWorldTriangles(shape) {
  const geometry = createGeometryInObjectSpace(shape);
  try {
    const matrix = getPoseMatrix(shape);
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const triangles = [];
    for (let i = 0; i < count; i += 3) {
      const tri = [0, 1, 2].map((k) =>
        new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(matrix),
      );
      const box = new THREE.Box3().setFromPoints(tri).expandByScalar(0.01);
      const normal = new THREE.Vector3()
        .crossVectors(new THREE.Vector3().subVectors(tri[1], tri[0]), new THREE.Vector3().subVectors(tri[2], tri[0]))
        .normalize();
      triangles.push({ tri, box, normal });
    }

    // 内側のR面(凹んだ滑らかな曲面)は溶接できないので印を付ける
    const vkey = (v) => `${Math.round(v.x * 100)}_${Math.round(v.y * 100)}_${Math.round(v.z * 100)}`;
    const edgeMap = new Map();
    triangles.forEach((t, ti) => {
      for (let k = 0; k < 3; k++) {
        const ka = vkey(t.tri[k]);
        const kb = vkey(t.tri[(k + 1) % 3]);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const list = edgeMap.get(key);
        if (list) list.push(ti);
        else edgeMap.set(key, [ti]);
      }
    });
    const centroid = (t) => t.tri[0].clone().add(t.tri[1]).add(t.tri[2]).multiplyScalar(1 / 3);
    for (const list of edgeMap.values()) {
      if (list.length !== 2) continue;
      const t1 = triangles[list[0]];
      const t2 = triangles[list[1]];
      const dot = t1.normal.dot(t2.normal);
      if (dot > 1 - 1e-4 || dot < Math.cos(Math.PI / 3)) continue;
      const c1 = centroid(t1);
      const c2 = centroid(t2);
      const concave = c2.sub(c1).dot(t1.normal) > 0;
      if (concave) {
        t1.smoothCount = (t1.smoothCount ?? 0) + 1;
        t2.smoothCount = (t2.smoothCount ?? 0) + 1;
      }
    }
    // 曲面の途中の面は両側に滑らかな凹み接続を持つ。平らな壁(片側のみ)は含めない
    for (const t of triangles) if ((t.smoothCount ?? 0) >= 2) t.innerR = true;
    return { triangles, box: new THREE.Box3().setFromPoints(triangles.flatMap((t) => t.tri)) };
  } finally {
    geometry.dispose();
  }
}

function edgeTriangleHit(a, b, tri) {
  const [p0, p1, p2] = tri;
  const dir = new THREE.Vector3().subVectors(b, a);
  const e1 = new THREE.Vector3().subVectors(p1, p0);
  const e2 = new THREE.Vector3().subVectors(p2, p0);
  const h = new THREE.Vector3().crossVectors(dir, e2);
  const det = e1.dot(h);
  if (Math.abs(det) < WELD_EPS) return null;
  const f = 1 / det;
  const s = new THREE.Vector3().subVectors(a, p0);
  const u = f * s.dot(h);
  if (u < -WELD_EPS || u > 1 + WELD_EPS) return null;
  const q = new THREE.Vector3().crossVectors(s, e1);
  const v = f * dir.dot(q);
  if (v < -WELD_EPS || u + v > 1 + WELD_EPS) return null;
  const t = f * e2.dot(q);
  if (t < -WELD_EPS || t > 1 + WELD_EPS) return null;
  return a.clone().addScaledVector(dir, t);
}

function triangleIntersectionSegment(t1, t2) {
  const hits = [];
  for (let k = 0; k < 3; k++) {
    const h1 = edgeTriangleHit(t1[k], t1[(k + 1) % 3], t2);
    if (h1) hits.push(h1);
    const h2 = edgeTriangleHit(t2[k], t2[(k + 1) % 3], t1);
    if (h2) hits.push(h2);
  }
  if (hits.length < 2) return null;
  let best = null;
  let bestLen = 0;
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const len = hits[i].distanceToSquared(hits[j]);
      if (len > bestLen) {
        bestLen = len;
        best = [hits[i], hits[j]];
      }
    }
  }
  return bestLen > 1e-6 ? best : null;
}

// 同一直線上で重なる/連続する線分を結合し、重複分の長さを二重計上しない
function mergeCollinearSegments(segments) {
  const groups = new Map();
  for (const [a, b] of segments) {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const d = new THREE.Vector3().subVectors(B, A);
    if (d.lengthSq() < 1e-12) continue;
    d.normalize();
    const flip = d.x < -1e-6 || (Math.abs(d.x) <= 1e-6 && (d.y < -1e-6 || (Math.abs(d.y) <= 1e-6 && d.z < 0)));
    if (flip) d.negate();
    const p0 = A.clone().addScaledVector(d, -A.dot(d));
    const key = [d.x * 1e3, d.y * 1e3, d.z * 1e3, p0.x * 20, p0.y * 20, p0.z * 20]
      .map((v) => Math.round(v) + 0)
      .join('_');
    let g = groups.get(key);
    if (!g) {
      g = { d, p0, ranges: [] };
      groups.set(key, g);
    }
    const t1 = A.dot(d);
    const t2 = B.dot(d);
    g.ranges.push([Math.min(t1, t2), Math.max(t1, t2)]);
  }

  const merged = [];
  let totalLengthMm = 0;
  for (const { d, p0, ranges } of groups.values()) {
    ranges.sort((x, y) => x[0] - y[0]);
    let [s, e] = ranges[0];
    const flush = () => {
      if (e - s < 1e-6) return;
      merged.push([p0.clone().addScaledVector(d, s).toArray(), p0.clone().addScaledVector(d, e).toArray()]);
      totalLengthMm += e - s;
    };
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] <= e + 1e-3) e = Math.max(e, ranges[i][1]);
      else {
        flush();
        [s, e] = ranges[i];
      }
    }
    flush();
  }
  return { segments: merged, totalLengthMm };
}

const COPLANAR_DIST_MM = 0.5;
const NEAR_PARALLEL_COS = Math.cos((35 * Math.PI) / 180);

// 凸多角形(CCW)を三角形(CCW)でクリップする(2D, Sutherland-Hodgman)
function clipPolygonByTriangle(poly, tri2d) {
  let out = poly;
  for (let k = 0; k < 3 && out.length; k++) {
    const p = tri2d[k];
    const q = tri2d[(k + 1) % 3];
    const side = (pt) => (q[0] - p[0]) * (pt[1] - p[1]) - (q[1] - p[1]) * (pt[0] - p[0]);
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const sc = side(cur);
      const sp = side(prev);
      if (sc >= 0) {
        if (sp < 0) {
          const t = sp / (sp - sc);
          out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
        }
        out.push(cur);
      } else if (sp >= 0) {
        const t = sp / (sp - sc);
        out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
    }
  }
  return out;
}

// 同一平面で向かい合う2三角形の接触領域(多角形)の辺を、向き付きで返す
function coplanarContactEdges(ta, tb) {
  const n = ta.normal;
  const u = new THREE.Vector3().subVectors(ta.tri[1], ta.tri[0]).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const origin = ta.tri[0];
  const to2d = (p) => {
    const d = new THREE.Vector3().subVectors(p, origin);
    return [d.dot(u), d.dot(v)];
  };
  const a2 = ta.tri.map(to2d);
  let b2 = tb.tri.map(to2d);
  const area = (b2[1][0] - b2[0][0]) * (b2[2][1] - b2[0][1]) - (b2[1][1] - b2[0][1]) * (b2[2][0] - b2[0][0]);
  if (area < 0) b2 = [b2[0], b2[2], b2[1]];
  const poly = clipPolygonByTriangle(a2, b2);
  if (poly.length < 3) return [];
  let polyArea = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    polyArea += p[0] * q[1] - q[0] * p[1];
  }
  if (Math.abs(polyArea) / 2 < 1e-3) return [];
  const to3d = (p) => origin.clone().addScaledVector(u, p[0]).addScaledVector(v, p[1]);
  const edges = [];
  for (let i = 0; i < poly.length; i++) {
    edges.push([to3d(poly[i]), to3d(poly[(i + 1) % poly.length])]);
  }
  return edges;
}

// 向き付き辺を同一直線上でまとめ、隣接多角形の内部辺(逆向き)を相殺して外形だけ残す
function netOutlineSegments(edges) {
  const groups = [];
  for (const [A, B] of edges) {
    const d = new THREE.Vector3().subVectors(B, A);
    if (d.lengthSq() < 1e-10) continue;
    d.normalize();
    // 方向と位置が許容内で一致する直線を同一とみなす(丸め境界による取りこぼし防止)
    let g = groups.find((x) => {
      if (Math.abs(x.d.dot(d)) < 1 - 1e-6) return false;
      const rel = new THREE.Vector3().subVectors(A, x.o);
      return rel.addScaledVector(x.d, -rel.dot(x.d)).lengthSq() < 0.05 * 0.05;
    });
    if (!g) {
      g = { d: d.clone(), o: A.clone(), events: [] };
      groups.push(g);
    }
    const ta = new THREE.Vector3().subVectors(A, g.o).dot(g.d);
    const tb = new THREE.Vector3().subVectors(B, g.o).dot(g.d);
    const sign = tb > ta ? 1 : -1;
    g.events.push([Math.min(ta, tb), sign], [Math.max(ta, tb), -sign]);
  }

  const out = [];
  for (const { d, o, events } of groups) {
    events.sort((x, y) => x[0] - y[0]);
    let acc = 0;
    let start = null;
    let i = 0;
    while (i < events.length) {
      const t = events[i][0];
      while (i < events.length && events[i][0] - t < 0.05) {
        acc += events[i][1];
        i++;
      }
      const active = Math.abs(acc) > 0.5;
      if (active && start === null) start = t;
      if (!active && start !== null) {
        if (t - start > 1e-3) {
          out.push([o.clone().addScaledVector(d, start).toArray(), o.clone().addScaledVector(d, t).toArray()]);
        }
        start = null;
      }
    }
  }
  return out;
}

// 図形同士が交差する線と、面が接している領域の外形を溶接線として返す
export function computeWeldLines(shapes) {
  const worlds = shapes.map((shape) => ({ id: shape.id, ...getWorldTriangles(shape) }));
  const all = [];

  for (let i = 0; i < worlds.length; i++) {
    for (let j = i + 1; j < worlds.length; j++) {
      const a = worlds[i];
      const b = worlds[j];
      if (!a.box.clone().expandByScalar(0.01).intersectsBox(b.box)) continue;
      const candidatesB = b.triangles.filter((t) => t.box.intersectsBox(a.box));
      const crossing = [];
      const contactEdges = [];
      const contactPairs = [];
      for (const ta of a.triangles) {
        if (!ta.box.intersectsBox(b.box)) continue;
        for (const tb of candidatesB) {
          if (!ta.box.intersectsBox(tb.box)) continue;
          const dot = ta.normal.dot(tb.normal);
          // ほぼ平行な面(曲面の分割面を含む)は交差線ではなく接触として扱う
          if (Math.abs(dot) > NEAR_PARALLEL_COS) {
            if (dot < 0) {
              const planeDist = (from, to) =>
                Math.max(...to.tri.map((p) => Math.abs(from.normal.dot(new THREE.Vector3().subVectors(p, from.tri[0])))));
              if (planeDist(ta, tb) < COPLANAR_DIST_MM && planeDist(tb, ta) < COPLANAR_DIST_MM) {
                const edges = coplanarContactEdges(ta, tb);
                if (edges.length) {
                  contactEdges.push(...edges);
                  contactPairs.push({ ta, tb, taTri: new THREE.Triangle(...ta.tri), tbTri: new THREE.Triangle(...tb.tri) });
                }
              }
            }
            continue;
          }
          const seg = triangleIntersectionSegment(ta.tri, tb.tri);
          if (seg && !ta.innerR && !tb.innerR) crossing.push([seg[0].toArray(), seg[1].toArray()]);
        }
      }
      const innerR = [...a.triangles, ...b.triangles].filter((t) => t.innerR);
      const onInnerR = (seg) => {
        const mid = new THREE.Vector3(
          (seg[0][0] + seg[1][0]) / 2,
          (seg[0][1] + seg[1][1]) / 2,
          (seg[0][2] + seg[1][2]) / 2,
        );
        const tmp = new THREE.Vector3();
        return innerR.some((t) => {
          if (!t.box.containsPoint(mid)) return false;
          return new THREE.Triangle(...t.tri).closestPointToPoint(mid, tmp).distanceTo(mid) < 0.05;
        });
      };
      // 接触領域の境界だけを溶接する。線の片側だけが接触領域なら外形、両側または無接触なら内部/ノイズ
      const probe = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      const inContact = (pt) =>
        contactPairs.some(
          (p) =>
            p.ta.box.containsPoint(pt) &&
            p.taTri.closestPointToPoint(pt, tmp).distanceTo(pt) < 0.15 &&
            p.tbTri.closestPointToPoint(pt, tmp).distanceTo(pt) < COPLANAR_DIST_MM + 0.1,
        );
      const isInteriorOfContact = (seg) => {
        const A0 = new THREE.Vector3(...seg[0]);
        const B0 = new THREE.Vector3(...seg[1]);
        const mid = A0.clone().add(B0).multiplyScalar(0.5);
        const dir = B0.clone().sub(A0).normalize();
        let near = null;
        let best = Infinity;
        for (const p of contactPairs) {
          const d = p.taTri.closestPointToPoint(mid, tmp).distanceTo(mid);
          if (d < best) {
            best = d;
            near = p;
          }
        }
        if (!near || best > 0.3) return false;
        const side = new THREE.Vector3().crossVectors(near.ta.normal, dir).normalize();
        const off = 0.1;
        const plus = inContact(probe.copy(mid).addScaledVector(side, off));
        const minus = inContact(probe.copy(mid).addScaledVector(side, -off));
        return plus === minus;
      };
      all.push(
        ...crossing,
        ...netOutlineSegments(contactEdges).filter((seg) => !onInnerR(seg) && !isInteriorOfContact(seg)),
      );
    }
  }
  return mergeCollinearSegments(all);
}

export function subtractShapeGeometry(targetShape, cutterShapes) {
  const createMesh = (shape, geometry) => {
    const mesh = new THREE.Mesh(geometry);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(getPoseMatrix(shape));
    mesh.updateMatrixWorld(true);
    return mesh;
  };

  const targetGeometry = createGeometryInObjectSpace(targetShape);
  const targetMatrix = getPoseMatrix(targetShape);
  const targetBounds = targetGeometry.boundingBox.clone().applyMatrix4(targetMatrix);
  let result;
  let intersectionCount = 0;
  const temporaryGeometries = [targetGeometry];

  try {
    result = CSG.fromMesh(createMesh(targetShape, targetGeometry));

    for (const cutterShape of cutterShapes) {
      const cutterGeometry = createGeometryInObjectSpace(cutterShape);
      temporaryGeometries.push(cutterGeometry);
      const cutterBounds = cutterGeometry.boundingBox.clone().applyMatrix4(getPoseMatrix(cutterShape));
      if (!targetBounds.intersectsBox(cutterBounds)) continue;

      result = result.subtract(CSG.fromMesh(createMesh(cutterShape, cutterGeometry)));
      intersectionCount += 1;
    }

    if (intersectionCount === 0) return { meshData: null };

    const resultGeometry = result.toGeometry(targetMatrix);
    try {
      const exportGeometry = resultGeometry.index ? resultGeometry.toNonIndexed() : resultGeometry;
      try {
        const position = exportGeometry.getAttribute('position');
        if (!position || position.count % 3 !== 0) {
          throw new Error('CSG subtraction returned invalid mesh geometry');
        }
        const beforeVolume = calculateGeometryVolumeMm3(targetGeometry);
        const afterVolume = calculateGeometryVolumeMm3(exportGeometry);
        if (Math.abs(beforeVolume - afterVolume) <= Math.max(1, beforeVolume) * 1e-8) {
          return { meshData: null };
        }
        return { meshData: { positions: Array.from(position.array) } };
      } finally {
        if (exportGeometry !== resultGeometry) exportGeometry.dispose();
      }
    } finally {
      resultGeometry.dispose();
    }
  } finally {
    temporaryGeometries.forEach((geometry) => geometry.dispose());
  }
}

function uniqueVec3(list, eps = 1e-4) {
  const map = new Map();
  for (const v of list) {
    const k = `${Math.round(v.x / eps)}_${Math.round(v.y / eps)}_${Math.round(v.z / eps)}`;
    if (!map.has(k)) map.set(k, v);
  }
  return Array.from(map.values());
}

const snapPointCache = new WeakMap();

function computeSnapPoints(obj, { includeMidpoints = true } = {}) {
  const cached = snapPointCache.get(obj);
  if (cached && (!includeMidpoints || cached.hasMidpoints)) return cached;

  const geo = buildGeometryFromShape(obj);
  try {
    const posAttr = geo.getAttribute('position');
    const mirrorScale = obj.mirrorScale ?? UNIT_SCALE;
    const verts = [];
    for (let i = 0; i < posAttr.count; i++) {
      verts.push(new THREE.Vector3(
        posAttr.getX(i) * mirrorScale[0],
        posAttr.getY(i) * mirrorScale[1],
        posAttr.getZ(i) * mirrorScale[2],
      ));
    }
    const vertices = uniqueVec3(verts);

    if (!includeMidpoints) {
      const points = { vertices, midpoints: [], hasMidpoints: false };
      snapPointCache.set(obj, points);
      return points;
    }

    const edges = new THREE.EdgesGeometry(geo);
    try {
      const ePos = edges.getAttribute('position');
      const mids = [];
      for (let i = 0; i < ePos.count; i += 2) {
        const a = new THREE.Vector3(ePos.getX(i), ePos.getY(i), ePos.getZ(i));
        const b = new THREE.Vector3(ePos.getX(i + 1), ePos.getY(i + 1), ePos.getZ(i + 1));
        mids.push(a.add(b).multiplyScalar(0.5));
      }
      const points = { vertices, midpoints: uniqueVec3(mids), hasMidpoints: true };
      snapPointCache.set(obj, points);
      return points;
    } finally {
      edges.dispose?.();
    }
  } finally {
    geo.dispose?.();
  }
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
  const mirrorScale = obj.mirrorScale ?? UNIT_SCALE;
  const fusedMeshOffset = [
    -pivot[0] * mirrorScale[0],
    -pivot[1] * mirrorScale[1],
    -pivot[2] * mirrorScale[2],
  ];

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
    <group position={fusedMeshOffset} scale={mirrorScale}>
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
  const geometry = useMemo(() => buildGeometryFromShape(obj), [obj]);
  const color = obj.color ?? '#bfbfbf';

  const outlineColorSelected = isPrimary ? '#ff8a00' : '#ffb020';
  const outlineColorHover = isOrangeLike(color) ? '#2f6bff' : '#ffb020';
  const showOutline = selected || hovered;
  const outlineColor = selected ? outlineColorSelected : outlineColorHover;

  const pivot = obj.pivot ?? [0, 0, 0];
  const mirrorScale = obj.mirrorScale ?? [1, 1, 1];
  const meshOffset = [
    -pivot[0] * mirrorScale[0],
    -pivot[1] * mirrorScale[1],
    -pivot[2] * mirrorScale[2],
  ];

  const Mat = (
    <meshStandardMaterial
      key={`${color}_${transparentMode ? 't' : 'o'}`}
      color={color}
      transparent={transparentMode}
      opacity={transparentMode ? 0.35 : 1}
      depthWrite={!transparentMode}
      side={obj.type === 'mesh' ? THREE.DoubleSide : THREE.FrontSide}
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
    scale: mirrorScale,
    castShadow: !!showShadows && obj.type !== 'mesh',
    // 被り除去後のメッシュは自己影(シャドウアクネ)が出るため影を受けない
    receiveShadow: !!showShadows && obj.type !== 'mesh',
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
    obj.type === 'mesh' ||
    obj.type === 'sketch-extrude' ||
    obj.type === 'plate'
  ) {
    return (
      <mesh {...common} geometry={geometry}>
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

function WeldLines({ segments }) {
  const geometry = useMemo(() => {
    if (!segments?.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segments.flat(2), 3));
    return g;
  }, [segments]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={999} raycast={() => null}>
      <lineBasicMaterial color="#ff0000" depthTest={false} transparent />
    </lineSegments>
  );
}

function BoxSelectController({ enabled, transforming, objectsRef, onBoxSelect, setRect }) {
  const { gl, camera } = useThree();
  const transformingRef = useRef(transforming);
  const callbackRef = useRef(onBoxSelect);
  useEffect(() => {
    transformingRef.current = transforming;
    callbackRef.current = onBoxSelect;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const el = gl.domElement;
    let start = null;
    let active = false;
    let suppressClick = false;

    const local = (e) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    };

    const onDown = (e) => {
      if (e.button !== 0) return;
      start = local(e);
      active = false;
    };

    const onMove = (e) => {
      if (!start) return;
      if (!(e.buttons & 1) || transformingRef.current) {
        start = null;
        setRect(null);
        return;
      }
      const p = local(e);
      if (!active && Math.hypot(p.x - start.x, p.y - start.y) < 5) return;
      active = true;
      setRect({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
    };

    const finish = (e) => {
      if (!start) return;
      const s = start;
      start = null;
      if (!active) return;
      active = false;
      setRect(null);
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
      const p = local(e);
      const minX = Math.min(s.x, p.x);
      const maxX = Math.max(s.x, p.x);
      const minY = Math.min(s.y, p.y);
      const maxY = Math.max(s.y, p.y);
      const crossing = p.x < s.x;

      camera.updateMatrixWorld();
      const ids = [];
      for (const shape of objectsRef.current) {
        let geometry = null;
        try {
          geometry = createGeometryInObjectSpace(shape);
          const bb = geometry.boundingBox;
          if (!bb) continue;
          const pose = getPoseMatrix(shape);
          let sMinX = Infinity;
          let sMaxX = -Infinity;
          let sMinY = Infinity;
          let sMaxY = -Infinity;
          let behind = false;
          for (const cx of [bb.min.x, bb.max.x]) {
            for (const cy of [bb.min.y, bb.max.y]) {
              for (const cz of [bb.min.z, bb.max.z]) {
                const v = new THREE.Vector3(cx, cy, cz).applyMatrix4(pose);
                const cam = v.clone().applyMatrix4(camera.matrixWorldInverse);
                if (cam.z >= 0) {
                  behind = true;
                  continue;
                }
                v.project(camera);
                const sx = ((v.x + 1) / 2) * s.w;
                const sy = ((1 - v.y) / 2) * s.h;
                sMinX = Math.min(sMinX, sx);
                sMaxX = Math.max(sMaxX, sx);
                sMinY = Math.min(sMinY, sy);
                sMaxY = Math.max(sMaxY, sy);
              }
            }
          }
          if (sMinX === Infinity) continue;
          if (crossing) {
            if (sMaxX >= minX && sMinX <= maxX && sMaxY >= minY && sMinY <= maxY) ids.push(shape.id);
          } else if (!behind && sMinX >= minX && sMaxX <= maxX && sMinY >= minY && sMaxY <= maxY) {
            ids.push(shape.id);
          }
        } catch {
          // 形状が生成できない図形は対象外
        } finally {
          geometry?.dispose?.();
        }
      }
      callbackRef.current?.(ids, !!e.shiftKey);
    };

    const onCancel = () => {
      start = null;
      active = false;
      setRect(null);
    };

    const onClickCapture = (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopImmediatePropagation();
      e.stopPropagation();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('click', onClickCapture, true);
      setRect(null);
    };
  }, [enabled, gl, camera, objectsRef, setRect]);

  return null;
}

export default function EditorCanvas({
  objects = [],
  selectedIds = [],
  primaryId = null,
  hoveredId = null,
  onSelect,
  onBoxSelect,
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
  weldSegments = null,

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
  const [boxRect, setBoxRect] = useState(null);
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

  const pivot = primaryObj?.pivot ?? ZERO_VEC3;
  const primaryMirrorScale = primaryObj?.mirrorScale ?? UNIT_SCALE;
  const pivotVec = useMemo(
    () => new THREE.Vector3(
      pivot[0] * primaryMirrorScale[0],
      pivot[1] * primaryMirrorScale[1],
      pivot[2] * primaryMirrorScale[2],
    ),
    [pivot, primaryMirrorScale],
  );

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

  const panCx = panCenter[0];
  const panCy = panCenter[1];
  const panCz = panCenter[2];
  const selectedKey = selectedIds.join('|');

  useEffect(() => {
    if (currentTool !== 'pan') return;
    panStartPosRef.current = new THREE.Vector3(panCx, panCy, panCz);
    if (panRef.current) panRef.current.position.set(panCx, panCy, panCz);
  }, [currentTool, panCx, panCy, panCz, selectedKey]);

  const showPanGizmo = currentTool === 'pan' && selectedIds.length > 0;

  // ✅ スケッチ用 3Dスナップ候補（面上の頂点/中点だけ）
  const sketchStep = sketchMode?.step;
  const sketchObjId = sketchMode?.objId;
  const sketchFrame = sketchMode?.frame;
  const sketchSnapWorldCandidates = useMemo(() => {
    if (!(currentTool === 'sketch2d' && sketchStep === 'drawing' && sketchFrame && sketchObjId)) return [];

    const obj = drawable.find((o) => o.id === sketchObjId);
    if (!obj) return [];

    const { vertices, midpoints } = computeSnapPoints(obj);

    const pv = obj.pivot ?? [0, 0, 0];
    const mirrorScale = obj.mirrorScale ?? UNIT_SCALE;
    const pivotV = new THREE.Vector3(
      (pv[0] ?? 0) * mirrorScale[0],
      (pv[1] ?? 0) * mirrorScale[1],
      (pv[2] ?? 0) * mirrorScale[2],
    );

    const p = obj.position ?? [0, 0, 0];
    const posV = new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);

    const r = obj.rotation ?? [0, 0, 0];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0));

    const fr = sketchFrame;
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
  }, [currentTool, sketchStep, sketchObjId, sketchFrame, drawable]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
      <directionalLight position={[8000, 10000, 6000]} intensity={1.0} castShadow={!!showShadows} shadow-bias={-0.0005} shadow-normalBias={2} />

      {showGrid ? <Grid infiniteGrid cellSize={100} sectionSize={1000} fadeDistance={70000} /> : null}
      <WeldLines segments={weldSegments} />

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
  const isSteelAddedObject = o.steelAdded === true || o.type?.startsWith('steel-');
  const sp = computeSnapPoints(o, { includeMidpoints: !isSteelAddedObject });

  const pv = o.pivot ?? [0, 0, 0];
  const mirrorScale = o.mirrorScale ?? UNIT_SCALE;
  const pivotV = new THREE.Vector3(
    (pv[0] ?? 0) * mirrorScale[0],
    (pv[1] ?? 0) * mirrorScale[1],
    (pv[2] ?? 0) * mirrorScale[2],
  );

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

      {!isSteelAddedObject ? midG.map((p, idx) => (
        <SnapDot
          key={`${o.id}_m_${idx}`}
          position={[p.x, p.y, p.z]}
          kind="mid"
          onSetPivotHere={isPrimary ? () => setPivotAtGroupPoint(p) : undefined}
          onLeftClick={() => handleSnapMoveClick(o.id, 'mid', p)}
          selected={isPickedPoint(o.id, 'mid', p)}
        />
      )) : null}

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
      <BoxSelectController
        enabled={!mobileViewMode && currentTool === 'select' && selectMode === 'body' && !!onBoxSelect}
        transforming={isTransforming}
        objectsRef={drawableRef}
        onBoxSelect={onBoxSelect}
        setRect={setBoxRect}
      />

      <OrbitControls ref={gizmoControlsRef} enabled={false} enableRotate={false} enablePan={false} enableZoom={false} />

      <GizmoHelper alignment="top-right" margin={[90, 90]} controls={gizmoControlsRef}>
        <GizmoViewport axisHeadScale={0.9} labelColor="black" />
      </GizmoHelper>
    </Canvas>
    {boxRect ? (
      <div
        style={{
          position: 'absolute',
          left: Math.min(boxRect.x1, boxRect.x2),
          top: Math.min(boxRect.y1, boxRect.y2),
          width: Math.abs(boxRect.x2 - boxRect.x1),
          height: Math.abs(boxRect.y2 - boxRect.y1),
          border: `1px ${boxRect.x2 < boxRect.x1 ? 'dashed' : 'solid'} #2563eb`,
          background: 'rgba(37,99,235,0.12)',
          pointerEvents: 'none',
        }}
      />
    ) : null}
    </div>
  );
}
