// file: components/plate/PlatePreview3D.js
'use client';

import { useEffect, useMemo, useRef } from 'react';

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default function PlatePreview3D({ points = [], closed = false, thickness = 9 }) {
  const holderRef = useRef(null);
  const threeRef = useRef({
    THREE: null,
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    mesh: null,
    raf: 0,
    ro: null,
  });

  const canExtrude = useMemo(() => closed && points && points.length >= 3, [closed, points]);

  // THREE init
  useEffect(() => {
    let disposed = false;

    async function init() {
      const holder = holderRef.current;
      if (!holder) return;

      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      holder.appendChild(renderer.domElement);

      const scene = new THREE.Scene();

      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
      camera.position.set(0, -450, 350);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;

      // light
      const light1 = new THREE.DirectionalLight(0xffffff, 1.0);
      light1.position.set(300, -300, 500);
      scene.add(light1);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));

      // grid
      const grid = new THREE.GridHelper(800, 20);
      grid.rotation.x = Math.PI / 2;
      scene.add(grid);

      // resize
      const resize = () => {
        const r = holder.getBoundingClientRect();
        const w = Math.max(10, Math.floor(r.width));
        const h = Math.max(10, Math.floor(r.height));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };

      const ro = new ResizeObserver(resize);
      ro.observe(holder);
      resize();

      const tick = () => {
        controls.update();
        renderer.render(scene, camera);
        threeRef.current.raf = requestAnimationFrame(tick);
      };
      tick();

      threeRef.current = { THREE, renderer, scene, camera, controls, mesh: null, raf: threeRef.current.raf, ro };
    }

    init();

    return () => {
      disposed = true;
      const t = threeRef.current;
      if (t.raf) cancelAnimationFrame(t.raf);
      if (t.ro) t.ro.disconnect();
      if (t.scene && t.mesh) {
        t.scene.remove(t.mesh);
      }
      if (t.mesh?.geometry) t.mesh.geometry.dispose();
      if (t.mesh?.material) t.mesh.material.dispose();
      if (t.renderer) {
        const dom = t.renderer.domElement;
        t.renderer.dispose();
        if (dom?.parentNode) dom.parentNode.removeChild(dom);
      }
      threeRef.current = { THREE: null, renderer: null, scene: null, camera: null, controls: null, mesh: null, raf: 0, ro: null };
    };
  }, []);

  // update mesh
  useEffect(() => {
    const t = threeRef.current;
    if (!t.THREE || !t.scene) return;
    const THREE = t.THREE;

    // remove old
    if (t.mesh) {
      t.scene.remove(t.mesh);
      if (t.mesh.geometry) t.mesh.geometry.dispose();
      if (t.mesh.material) t.mesh.material.dispose();
      t.mesh = null;
    }

    if (!canExtrude) return;

    const depth = clamp(Number(thickness) || 0, 0.1, 2000);

    // points are in canvas coords (px). Convert to 3D coords:
    // - center around (0,0)
    // - flip Y (canvas down is +)
    // We will first compute centroid in canvas coords, then shift.
    let cx = 0;
    let cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    cx /= points.length;
    cy /= points.length;

    const shape = new THREE.Shape();
    const p0 = points[0];
    shape.moveTo(p0.x - cx, -(p0.y - cy));
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      shape.lineTo(p.x - cx, -(p.y - cy));
    }
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      steps: 1,
    });

    // center Z
    geom.translate(0, 0, -depth / 2);

    const mat = new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.7 });
    const mesh = new THREE.Mesh(geom, mat);
    t.scene.add(mesh);
    t.mesh = mesh;

    if (t.controls) {
      t.controls.target.set(0, 0, 0);
      t.controls.update();
    }
  }, [points, closed, thickness, canExtrude]);

  return (
    <div className="rounded-xl border bg-white" style={{ height: 520 }}>
      <div ref={holderRef} className="h-full w-full" />
    </div>
  );
}