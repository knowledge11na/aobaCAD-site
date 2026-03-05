'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Mouse:
 * - wheel: zoom
 * - middle drag: rotate
 * - left+right drag: pan
 *
 * Touch:
 * - 1 finger: rotate
 * - 2 finger: pan (move midpoint) + zoom (pinch)
 */
const CustomCameraControls = forwardRef(function CustomCameraControls(
  { enabled = true, zoomSensitivity = 1.0, rotateSensitivity = 1.0, panSensitivity = 1.0 },
  ref
) {
  const { camera, gl } = useThree();

  const target = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const spherical = useMemo(() => new THREE.Spherical(), []);
  const vTemp = useMemo(() => new THREE.Vector3(), []);
  const vRight = useMemo(() => new THREE.Vector3(), []);
  const vUp = useMemo(() => new THREE.Vector3(), []);

  const stateRef = useRef({
    isDragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    mode: 'none', // mouse: 'rotate'|'pan'|'none'
    // touch
    pointers: new Map(), // pointerId -> {x,y}
    touchPrevDist: 0,
    touchPrevMid: { x: 0, y: 0 },
  });

  function syncFromCamera() {
    vTemp.copy(camera.position).sub(target);
    spherical.setFromVector3(vTemp);
    spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, spherical.phi));
  }

  function applyToCamera() {
    vTemp.setFromSpherical(spherical).add(target);
    camera.position.copy(vTemp);
    camera.lookAt(target);
  }

  function setModeFromButtons(buttonsBitmask) {
    // left=1, right=2, middle=4
    if (buttonsBitmask === 4) return 'rotate';
    if (buttonsBitmask === 3) return 'pan';
    return 'none';
  }

  function rotateBy(dx, dy) {
    const element = gl.domElement;
    const rotSpeed = 0.0035 * rotateSensitivity;

    spherical.theta -= (dx / element.clientWidth) * Math.PI * 2 * rotSpeed * 100;
    spherical.phi -= (dy / element.clientHeight) * Math.PI * rotSpeed * 100;
    spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, spherical.phi));
  }

  function panBy(dx, dy) {
    const element = gl.domElement;
    const distance = spherical.radius;
    const fov = (camera.fov * Math.PI) / 180;
    const screenHeightAtDist = 2 * Math.tan(fov / 2) * distance;

    const panX = (-dx / element.clientHeight) * screenHeightAtDist * panSensitivity;
    const panY = (dy / element.clientHeight) * screenHeightAtDist * panSensitivity;

    vTemp.copy(camera.position).sub(target).normalize();
    vUp.copy(camera.up).normalize();
    vRight.crossVectors(vUp, vTemp).normalize();

    const move = new THREE.Vector3().addScaledVector(vRight, panX).addScaledVector(vUp, panY);
    target.add(move);
  }

  function zoomByWheel(deltaY) {
    const base = 0.0012;
    const k = base * zoomSensitivity;
    const zoomFactor = Math.exp(deltaY * k);
    spherical.radius *= zoomFactor;
    spherical.radius = Math.max(100, Math.min(300000, spherical.radius));
  }

  function zoomByPinchRatio(ratio) {
    // ratio > 1 で拡大、<1 で縮小（直感的に）
    const k = 1 / Math.max(0.01, ratio);
    spherical.radius *= Math.pow(k, zoomSensitivity);
    spherical.radius = Math.max(100, Math.min(300000, spherical.radius));
  }

  // ===== 視点切り替え API =====
  function setView(viewName) {
    syncFromCamera();
    const clampPhi = (phi) => Math.max(0.001, Math.min(Math.PI - 0.001, phi));

    if (viewName === 'front') {
      spherical.theta = 0;
      spherical.phi = Math.PI / 2;
    } else if (viewName === 'back') {
      spherical.theta = Math.PI;
      spherical.phi = Math.PI / 2;
    } else if (viewName === 'right') {
      spherical.theta = Math.PI / 2;
      spherical.phi = Math.PI / 2;
    } else if (viewName === 'left') {
      spherical.theta = -Math.PI / 2;
      spherical.phi = Math.PI / 2;
    } else if (viewName === 'top') {
      spherical.phi = 0.001;
    } else if (viewName === 'bottom') {
      spherical.phi = Math.PI - 0.001;
    } else if (viewName === 'iso') {
      spherical.theta = Math.PI / 4;
      spherical.phi = Math.PI / 3;
    }

    spherical.phi = clampPhi(spherical.phi);
    applyToCamera();
  }

  useImperativeHandle(ref, () => ({
    setView,
    setTarget: (x, y, z) => {
      target.set(x, y, z);
      syncFromCamera();
      applyToCamera();
    },
    getTarget: () => target.clone(),
  }));

  useEffect(() => {
    const el = gl.domElement;

    syncFromCamera();
    applyToCamera();

    const updateTouchGesture = () => {
      const pts = Array.from(stateRef.current.pointers.values());
      if (pts.length === 1) {
        // 1本指：回転（差分は pointermove 側で dx/dy を使う）
        stateRef.current.touchPrevDist = 0;
        return;
      }
      if (pts.length >= 2) {
        const a = pts[0];
        const b = pts[1];

        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dxMid = mid.x - stateRef.current.touchPrevMid.x;
        const dyMid = mid.y - stateRef.current.touchPrevMid.y;

        const dist = Math.hypot(a.x - b.x, a.y - b.y);

        // pan（2本指の中点移動）
        if (Number.isFinite(stateRef.current.touchPrevMid.x)) {
          panBy(dxMid, dyMid);
        }

        // zoom（ピンチ）
        if (stateRef.current.touchPrevDist > 0 && dist > 0) {
          const ratio = dist / stateRef.current.touchPrevDist;
          zoomByPinchRatio(ratio);
        }

        stateRef.current.touchPrevDist = dist;
        stateRef.current.touchPrevMid = mid;

        applyToCamera();
      }
    };

    const onPointerDown = (e) => {
      if (!enabled) return;

      // iOSで二本指スクロール等を抑制
      e.preventDefault?.();

      if (e.button === 1) e.preventDefault();

      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {}

      syncFromCamera();

      if (e.pointerType === 'touch') {
        stateRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        const pts = Array.from(stateRef.current.pointers.values());
        if (pts.length >= 2) {
          const a = pts[0];
          const b = pts[1];
          stateRef.current.touchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
          stateRef.current.touchPrevMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        } else {
          stateRef.current.touchPrevDist = 0;
          stateRef.current.touchPrevMid = { x: e.clientX, y: e.clientY };
        }

        stateRef.current.isDragging = true;
        return;
      }

      // mouse
      stateRef.current.isDragging = true;
      stateRef.current.pointerId = e.pointerId;
      stateRef.current.lastX = e.clientX;
      stateRef.current.lastY = e.clientY;
      stateRef.current.mode = setModeFromButtons(e.buttons);
    };

    const onPointerMove = (e) => {
      if (!enabled) return;
      if (!stateRef.current.isDragging) return;

      if (e.pointerType === 'touch') {
        if (!stateRef.current.pointers.has(e.pointerId)) return;
        stateRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        const pts = Array.from(stateRef.current.pointers.values());
        if (pts.length === 1) {
          // 1本指 rotate
          const dx = e.movementX ?? e.clientX - (stateRef.current.lastX || e.clientX);
          const dy = e.movementY ?? e.clientY - (stateRef.current.lastY || e.clientY);
          stateRef.current.lastX = e.clientX;
          stateRef.current.lastY = e.clientY;

          rotateBy(dx, dy);
          applyToCamera();
          return;
        }

        // 2本指 pan+zoom
        updateTouchGesture();
        return;
      }

      // mouse
      if (stateRef.current.pointerId != null && e.pointerId !== stateRef.current.pointerId) return;

      const dx = e.clientX - stateRef.current.lastX;
      const dy = e.clientY - stateRef.current.lastY;
      stateRef.current.lastX = e.clientX;
      stateRef.current.lastY = e.clientY;

      const mode = setModeFromButtons(e.buttons);
      stateRef.current.mode = mode;

      if (mode === 'rotate') {
        rotateBy(dx, dy);
        applyToCamera();
      } else if (mode === 'pan') {
        panBy(dx, dy);
        applyToCamera();
      }
    };

    const endDrag = (e) => {
      if (!enabled) return;

      if (e.pointerType === 'touch') {
        stateRef.current.pointers.delete(e.pointerId);
        if (stateRef.current.pointers.size === 0) {
          stateRef.current.isDragging = false;
          stateRef.current.touchPrevDist = 0;
        } else {
          // 残ってる指で基準を作り直す
          const pts = Array.from(stateRef.current.pointers.values());
          if (pts.length >= 2) {
            const a = pts[0];
            const b = pts[1];
            stateRef.current.touchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
            stateRef.current.touchPrevMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          } else {
            stateRef.current.touchPrevDist = 0;
          }
        }

        try {
          el.releasePointerCapture?.(e.pointerId);
        } catch {}
        return;
      }

      if (!stateRef.current.isDragging) return;
      if (stateRef.current.pointerId != null && e.pointerId !== stateRef.current.pointerId) return;

      stateRef.current.isDragging = false;
      stateRef.current.mode = 'none';
      const pid = stateRef.current.pointerId;
      stateRef.current.pointerId = null;

      try {
        if (pid != null) el.releasePointerCapture?.(pid);
      } catch {}
    };

    const onWheel = (e) => {
      if (!enabled) return;
      e.preventDefault();
      syncFromCamera();
      zoomByWheel(e.deltaY);
      applyToCamera();
    };

    const onContextMenu = (e) => e.preventDefault();

    // 重要：タッチ操作で画面スクロールしないように
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', onPointerDown, { passive: false });
    el.addEventListener('pointermove', onPointerMove, { passive: false });
    el.addEventListener('pointerup', endDrag, { passive: false });
    el.addEventListener('pointercancel', endDrag, { passive: false });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [gl, camera, target, spherical, zoomSensitivity, rotateSensitivity, panSensitivity, enabled]);

  return null;
});

export default CustomCameraControls;