'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * PC:
 * - wheel: zoom
 * - middle drag: rotate
 * - left+right drag: pan
 *
 * Touch / Mobile:
 * - 1 finger: rotate
 * - 2 fingers: pan + pinch zoom
 *
 * 重要:
 * - スマホでは閲覧優先
 * - canvas 自体に touchAction='none' を入れてブラウザスクロールを止める
 */
const CustomCameraControls = forwardRef(function CustomCameraControls(
  {
    enabled = true,
    zoomSensitivity = 1.0,
    rotateSensitivity = 1.0,
    panSensitivity = 1.0,
  },
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
    mode: 'none', // mouse: 'rotate' | 'pan' | 'none'

    // touch
    pointers: new Map(), // pointerId -> { x, y }
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

    // 少しゆっくりめ
    const rotSpeed = 0.0026 * rotateSensitivity;

    spherical.theta -= (dx / Math.max(1, element.clientWidth)) * Math.PI * 2 * rotSpeed * 100;
    spherical.phi -= (dy / Math.max(1, element.clientHeight)) * Math.PI * rotSpeed * 100;

    spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, spherical.phi));
  }

  function panBy(dx, dy) {
    const element = gl.domElement;
    const distance = spherical.radius;
    const fov = (camera.fov * Math.PI) / 180;
    const screenHeightAtDist = 2 * Math.tan(fov / 2) * distance;

    const panX = (-dx / Math.max(1, element.clientHeight)) * screenHeightAtDist * 0.9 * panSensitivity;
    const panY = (dy / Math.max(1, element.clientHeight)) * screenHeightAtDist * 0.9 * panSensitivity;

    vTemp.copy(camera.position).sub(target).normalize();
    vUp.copy(camera.up).normalize();
    vRight.crossVectors(vUp, vTemp).normalize();

    const move = new THREE.Vector3()
      .addScaledVector(vRight, panX)
      .addScaledVector(vUp, panY);

    target.add(move);
  }

  function zoomByWheel(deltaY) {
    // 少しゆっくりめ
    const base = 0.00075;
    const k = base * zoomSensitivity;
    const zoomFactor = Math.exp(deltaY * k);
    spherical.radius *= zoomFactor;
    spherical.radius = Math.max(100, Math.min(300000, spherical.radius));
  }

  function zoomByPinchRatio(ratio) {
    // ratio > 1 で指が開く → 拡大
    // 少しゆっくりめ
    const k = 1 / Math.max(0.01, ratio);
    spherical.radius *= Math.pow(k, 0.85 * zoomSensitivity);
    spherical.radius = Math.max(100, Math.min(300000, spherical.radius));
  }

  function setView(viewName) {
    syncFromCamera();

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

    spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, spherical.phi));
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

    // 画面スクロール防止
    el.style.touchAction = 'none';

    const updateTouchGesture = () => {
      const pts = Array.from(stateRef.current.pointers.values());
      if (pts.length < 2) return;

      const a = pts[0];
      const b = pts[1];

      const mid = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);

      const dxMid = mid.x - stateRef.current.touchPrevMid.x;
      const dyMid = mid.y - stateRef.current.touchPrevMid.y;

      if (stateRef.current.touchPrevDist > 0) {
        panBy(dxMid, dyMid);

        if (dist > 0) {
          const ratio = dist / stateRef.current.touchPrevDist;
          zoomByPinchRatio(ratio);
        }

        applyToCamera();
      }

      stateRef.current.touchPrevDist = dist;
      stateRef.current.touchPrevMid = mid;
    };

    const onPointerDown = (e) => {
      if (!enabled) return;

      e.preventDefault?.();

      if (e.button === 1) e.preventDefault();

      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {}

      syncFromCamera();

      if (e.pointerType === 'touch') {
        stateRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        stateRef.current.isDragging = true;

        const pts = Array.from(stateRef.current.pointers.values());

        if (pts.length === 1) {
          stateRef.current.lastX = e.clientX;
          stateRef.current.lastY = e.clientY;
          stateRef.current.touchPrevDist = 0;
          stateRef.current.touchPrevMid = { x: e.clientX, y: e.clientY };
          return;
        }

        if (pts.length >= 2) {
          const a = pts[0];
          const b = pts[1];
          stateRef.current.touchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
          stateRef.current.touchPrevMid = {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
          };
        }

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

        const prev = stateRef.current.pointers.get(e.pointerId) ?? { x: e.clientX, y: e.clientY };
        stateRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        const pts = Array.from(stateRef.current.pointers.values());

        if (pts.length === 1) {
          const dx = e.clientX - prev.x;
          const dy = e.clientY - prev.y;

          rotateBy(dx, dy);
          applyToCamera();

          stateRef.current.lastX = e.clientX;
          stateRef.current.lastY = e.clientY;
          return;
        }

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
          stateRef.current.touchPrevMid = { x: 0, y: 0 };
        } else {
          const pts = Array.from(stateRef.current.pointers.values());

          if (pts.length === 1) {
            stateRef.current.touchPrevDist = 0;
            stateRef.current.lastX = pts[0].x;
            stateRef.current.lastY = pts[0].y;
          } else if (pts.length >= 2) {
            const a = pts[0];
            const b = pts[1];
            stateRef.current.touchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
            stateRef.current.touchPrevMid = {
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
            };
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

    const onContextMenu = (e) => {
      e.preventDefault();
    };

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