// file: components/plate/PlatePreview3D.js
'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

function makeShapeFromProfile(outer, holes) {
  if (!Array.isArray(outer) || outer.length < 3) return null;

  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) {
    shape.lineTo(outer[i].x, outer[i].y);
  }
  shape.lineTo(outer[0].x, outer[0].y);

  for (const holePts of holes ?? []) {
    if (!Array.isArray(holePts) || holePts.length < 3) continue;

    const hole = new THREE.Path();
    hole.moveTo(holePts[0].x, holePts[0].y);
    for (let i = 1; i < holePts.length; i++) {
      hole.lineTo(holePts[i].x, holePts[i].y);
    }
    hole.lineTo(holePts[0].x, holePts[0].y);
    shape.holes.push(hole);
  }

  return shape;
}

function PlateMesh({ outer, holes, thickness }) {
  const geometry = useMemo(() => {
    const shape = makeShapeFromProfile(outer, holes);
    if (!shape) return null;

    const t = Math.max(0.1, Number(thickness) || 1);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: t,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 32,
    });

    geo.translate(0, 0, -t / 2);
    geo.computeVertexNormals();
    return geo;
  }, [outer, holes, thickness]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} castShadow receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color="#bfbfbf" metalness={0.15} roughness={0.7} />
    </mesh>
  );
}

function ControlledOrbit({ active }) {
  return (
    <OrbitControls
      enabled={active}
      enableDamping={false}
      autoRotate={false}
      rotateSpeed={0.14}
      zoomSpeed={0.12}
      panSpeed={0.12}
      screenSpacePanning={true}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
    />
  );
}

export default function PlatePreview3D({
  outer = [],
  holes = [],
  thickness = 9,
}) {
  const canShow = Array.isArray(outer) && outer.length >= 3;

  const wrapRef = useRef(null);
  const [active, setActive] = useState(false);

  return (
    <div
      ref={wrapRef}
      className="h-[420px] w-full overflow-hidden rounded-xl border bg-white"
      onMouseDown={(e) => {
        if (e.button === 0 || e.button === 1 || e.button === 2) {
          setActive(true);
        }
      }}
      onMouseUp={() => setActive(false)}
      onMouseLeave={() => setActive(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        frameloop="demand"
        camera={{ position: [500, 400, 600], fov: 45 }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[400, 700, 500]} intensity={1.1} castShadow />

        <Grid infiniteGrid cellSize={10} sectionSize={100} fadeDistance={5000} />

        {canShow ? <PlateMesh outer={outer} holes={holes} thickness={thickness} /> : null}

        <ControlledOrbit active={active} />
      </Canvas>
    </div>
  );
}