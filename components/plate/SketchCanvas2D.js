// file: components/plate/SketchCanvas2D.js
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function rad(deg) {
  return (deg * Math.PI) / 180;
}
function degFromRad(r) {
  return (r * 180) / Math.PI;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}

export default function SketchCanvas2D({
  width = 700,
  height = 450,
  snapPx = 12,
  outer = [],
  holes = [],
  onChange,
}) {
  const canvasRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const lastLoadedRef = useRef('');
  const lastNotifyRef = useRef('');
  const hoverRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [contours, setContours] = useState([]);
  const [draftPoints, setDraftPoints] = useState([]);
  const [draftClosed, setDraftClosed] = useState(false);

  const [draftStart, setDraftStart] = useState(null);
  const [draftEnd, setDraftEnd] = useState(null);
  const [snapHit, setSnapHit] = useState(null);

  const [cmdLength, setCmdLength] = useState('');
  const [cmdAngle, setCmdAngle] = useState('');
  const [lockedByNumbers, setLockedByNumbers] = useState(false);

  const [view, setView] = useState(() => ({
    scale: 1.0,
    panX: width / 2,
    panY: height / 2,
  }));

  const panDragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  function stopPanDrag() {
    panDragRef.current.active = false;
  }

  useEffect(() => {
    const key = JSON.stringify({
      outer: Array.isArray(outer) ? outer : [],
      holes: Array.isArray(holes) ? holes : [],
    });

    if (lastLoadedRef.current === key) return;
    lastLoadedRef.current = key;

    const nextContours = [];
    if (Array.isArray(outer) && outer.length >= 3) {
      nextContours.push(outer);
    }
    if (Array.isArray(holes)) {
      for (const h of holes) {
        if (Array.isArray(h) && h.length >= 3) nextContours.push(h);
      }
    }

    setContours(nextContours);
    setDraftPoints([]);
    setDraftClosed(false);
    setDraftStart(null);
    setDraftEnd(null);
    setSnapHit(null);
  }, [outer, holes]);

  const worldToScreen = (p) => ({
    x: p.x * view.scale + view.panX,
    y: p.y * view.scale + view.panY,
  });

  const screenToWorld = (p) => ({
    x: (p.x - view.panX) / view.scale,
    y: (p.y - view.panY) / view.scale,
  });

  function getScreenPoint(e) {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const scaleX = c.width / r.width;
    const scaleY = c.height / r.height;
    return {
      x: (e.clientX - r.left) * scaleX,
      y: (e.clientY - r.top) * scaleY,
    };
  }

  const confirmedLines = useMemo(() => {
    const segs = [];
    for (const contour of contours) {
      if (!Array.isArray(contour) || contour.length < 2) continue;
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        segs.push({ a, b });
      }
    }
    return segs;
  }, [contours]);

  const draftLines = useMemo(() => {
    const segs = [];
    for (let i = 0; i < draftPoints.length - 1; i++) {
      segs.push({ a: draftPoints[i], b: draftPoints[i + 1] });
    }
    return segs;
  }, [draftPoints]);

  const allLines = useMemo(() => {
    return [...confirmedLines, ...draftLines];
  }, [confirmedLines, draftLines]);

  const snapPoints = useMemo(() => {
    const pts = [];

    for (const ln of allLines) {
      pts.push({ x: ln.a.x, y: ln.a.y, type: '端点' });
      pts.push({ x: ln.b.x, y: ln.b.y, type: '端点' });
      pts.push({ x: (ln.a.x + ln.b.x) / 2, y: (ln.a.y + ln.b.y) / 2, type: '中点' });
    }

    if (draftPoints.length >= 1) {
      pts.push({
        x: draftPoints[0].x,
        y: draftPoints[0].y,
        type: '始点',
      });
    }

    return pts;
  }, [allLines, draftPoints]);

  function findSnap(worldP) {
    const snapWorld = snapPx / view.scale;
    let best = null;
    let bestD = Infinity;

    for (const s of snapPoints) {
      const d = dist(worldP, s);
      if (d <= snapWorld && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  function applyNumbersEnd(startWorld, rawEndWorld) {
    if (!startWorld) return rawEndWorld;

    const hasLen = cmdLength !== '' && !Number.isNaN(Number(cmdLength));
    const hasAng = cmdAngle !== '' && !Number.isNaN(Number(cmdAngle));
    if (!hasLen && !hasAng) return rawEndWorld;

    const L = hasLen ? clamp(Number(cmdLength), 0, 9999999) : dist(startWorld, rawEndWorld || startWorld);

    if (hasAng) {
      const ang = rad(Number(cmdAngle));
      const dx = Math.cos(ang) * L;
      const dy = -Math.sin(ang) * L;
      return { x: startWorld.x + dx, y: startWorld.y + dy };
    }

    const end = rawEndWorld || startWorld;
    const vx = end.x - startWorld.x;
    const vy = end.y - startWorld.y;
    const vlen = Math.sqrt(vx * vx + vy * vy) || 1;
    const ux = vx / vlen;
    const uy = vy / vlen;

    return {
      x: startWorld.x + ux * L,
      y: startWorld.y + uy * L,
    };
  }

  function clearNumbers() {
    setLockedByNumbers(false);
    setCmdLength('');
    setCmdAngle('');
  }

  function cancelDraft() {
    setDraftStart(null);
    setDraftEnd(null);
    setSnapHit(null);
    setDraftClosed(false);
    clearNumbers();
  }

  function resetAll() {
    setContours([]);
    setDraftPoints([]);
    cancelDraft();
  }

  function startNewContour() {
    setDraftPoints([]);
    setDraftClosed(false);
    setDraftStart(null);
    setDraftEnd(null);
    setSnapHit(null);
    clearNumbers();
  }

  function updateDraftEndByMouse(worldP) {
    const snap = findSnap(worldP);
    const raw = snap ? { x: snap.x, y: snap.y } : worldP;

    setSnapHit(snap ? { x: snap.x, y: snap.y, type: snap.type } : null);

    if (!draftStart) return;

    const end = lockedByNumbers ? applyNumbersEnd(draftStart, raw) : raw;
    setDraftEnd(end);
  }

  function finalizeContour(nextPoints) {
    if (!Array.isArray(nextPoints) || nextPoints.length < 3) return;

    setContours((prev) => [...prev, nextPoints]);
    setDraftPoints([]);
    setDraftClosed(true);
    setDraftStart(null);
    setDraftEnd(null);
    setSnapHit(null);
    clearNumbers();
  }

  function tryCloseIfNearStart(endWorld, currentPoints) {
    if (currentPoints.length < 3) return false;
    const s = currentPoints[0];
    const snapWorld = (snapPx / view.scale) * 1.2;

    if (dist(endWorld, s) <= snapWorld) {
      finalizeContour(currentPoints);
      return true;
    }
    return false;
  }

  function onMouseDown(e) {
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      const sp = getScreenPoint(e);
      panDragRef.current = {
        active: true,
        startX: sp.x,
        startY: sp.y,
        startPanX: view.panX,
        startPanY: view.panY,
      };
      return;
    }

    if (e.button !== 0) return;

    const sp = getScreenPoint(e);
    const wp0 = screenToWorld(sp);
    const snap = findSnap(wp0);
    const wp = snap ? { x: snap.x, y: snap.y } : wp0;

    if (draftPoints.length === 0) {
      setDraftPoints([wp]);
      setDraftStart(wp);
      setDraftEnd(wp);
      setDraftClosed(false);
      setSnapHit(snap ? { x: snap.x, y: snap.y, type: snap.type } : null);
      return;
    }

    const currentStart = draftStart ?? draftPoints[draftPoints.length - 1];
    const endRaw = snap ? { x: snap.x, y: snap.y } : wp0;
    const end = applyNumbersEnd(currentStart, endRaw);

    const nextPoints = [...draftPoints, end];

    if (tryCloseIfNearStart(end, nextPoints)) return;

    setDraftPoints(nextPoints);
    setDraftStart(end);
    setDraftEnd(end);
    clearNumbers();
  }

  function onMouseMove(e) {
    if (!hoverRef.current) {
      stopPanDrag();
      return;
    }

    const sp = getScreenPoint(e);

    if (panDragRef.current.active) {
      const isRightPressed = (e.buttons & 2) === 2;
      const isMiddlePressed = (e.buttons & 4) === 4;

      if (!isRightPressed && !isMiddlePressed) {
        stopPanDrag();
        return;
      }

      const PAN_SENS = 0.18;

      const rawDx = sp.x - panDragRef.current.startX;
      const rawDy = sp.y - panDragRef.current.startY;

      const dx = Math.abs(rawDx) < 2 ? 0 : rawDx * PAN_SENS;
      const dy = Math.abs(rawDy) < 2 ? 0 : rawDy * PAN_SENS;

      setView((v) => ({
        ...v,
        panX: panDragRef.current.startPanX + dx,
        panY: panDragRef.current.startPanY + dy,
      }));
      return;
    }

    const wp = screenToWorld(sp);
    updateDraftEndByMouse(wp);
  }

  function onMouseUp() {
    stopPanDrag();
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  useEffect(() => {
    function handleGlobalMouseUp() {
      stopPanDrag();
    }

    function handleWindowBlur() {
      stopPanDrag();
    }

    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  function onWheel(e) {
    e.preventDefault();

    if (!hoverRef.current) return;
    if (Math.abs(e.deltaY) < 8) return;

    const sp = getScreenPoint(e);
    const beforeWorld = screenToWorld(sp);

    const factor = e.deltaY < 0 ? 1.015 : 1 / 1.015;
    const nextScale = clamp(view.scale * factor, 0.2, 8);
    const nextPanX = sp.x - beforeWorld.x * nextScale;
    const nextPanY = sp.y - beforeWorld.y * nextScale;

    setView({
      scale: nextScale,
      panX: nextPanX,
      panY: nextPanY,
    });
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        cancelDraft();
      }

      if (e.key === 'Enter') {
        if (!draftStart || draftPoints.length === 0) return;

        const end = applyNumbersEnd(draftStart, draftEnd || draftStart);

        const nextPoints = [...draftPoints, end];
        if (tryCloseIfNearStart(end, nextPoints)) return;

        setDraftPoints(nextPoints);
        setDraftStart(end);
        setDraftEnd(end);
        clearNumbers();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draftStart, draftEnd, cmdLength, cmdAngle, draftPoints, view.scale]);

  useEffect(() => {
    const outerContour = contours[0] ?? [];
    const holeContours = contours.slice(1);

    const payload = {
      profile: {
        outer: outerContour,
        holes: holeContours,
      },
      contours,
      draftPoints,
      view,
    };

    const key = JSON.stringify(payload.profile);
    if (lastNotifyRef.current === key) return;
    lastNotifyRef.current = key;

    onChangeRef.current?.(payload);
  }, [contours, draftPoints, view]);

  const info = useMemo(() => {
    const start = draftStart;
    const end = draftEnd;
    if (!start || !end) return { length: '', angle: '' };

    const L = dist(start, end);
    const vx = end.x - start.x;
    const vy = end.y - start.y;
    const ang = Math.atan2(-vy, vx);
    const angDeg = (degFromRad(ang) + 360) % 360;

    return {
      length: round1(L),
      angle: round1(angDeg),
    };
  }, [draftStart, draftEnd]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const major = 100;
    const minor = 10;

    const worldLeftTop = screenToWorld({ x: 0, y: 0 });
    const worldRightBottom = screenToWorld({ x: width, y: height });

    const minX = Math.min(worldLeftTop.x, worldRightBottom.x);
    const maxX = Math.max(worldLeftTop.x, worldRightBottom.x);
    const minY = Math.min(worldLeftTop.y, worldRightBottom.y);
    const maxY = Math.max(worldLeftTop.y, worldRightBottom.y);

    function drawGrid(stepMm, strokeStyle, lineWidth) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;

      const startX = Math.floor(minX / stepMm) * stepMm;
      const endX = Math.ceil(maxX / stepMm) * stepMm;
      for (let x = startX; x <= endX; x += stepMm) {
        const sx = worldToScreen({ x, y: 0 }).x;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
      }

      const startY = Math.floor(minY / stepMm) * stepMm;
      const endY = Math.ceil(maxY / stepMm) * stepMm;
      for (let y = startY; y <= endY; y += stepMm) {
        const sy = worldToScreen({ x: 0, y }).y;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
        ctx.stroke();
      }
    }

    const pxPerMinor = minor * view.scale;
    if (pxPerMinor >= 6) {
      drawGrid(minor, '#f3f4f6', 1);
    }
    drawGrid(major, '#e5e7eb', 1);

    const o = worldToScreen({ x: 0, y: 0 });
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(o.x - 10, o.y);
    ctx.lineTo(o.x + 10, o.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(o.x, o.y - 10);
    ctx.lineTo(o.x, o.y + 10);
    ctx.stroke();

    contours.forEach((contour, idx) => {
      if (!Array.isArray(contour) || contour.length < 2) return;

      ctx.strokeStyle = idx === 0 ? '#111827' : '#dc2626';
      ctx.lineWidth = 2;

      for (let i = 0; i < contour.length; i++) {
        const a = worldToScreen(contour[i]);
        const b = worldToScreen(contour[(i + 1) % contour.length]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    });

    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    for (const ln of draftLines) {
      const a = worldToScreen(ln.a);
      const b = worldToScreen(ln.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    if (draftStart && draftEnd) {
      const a = worldToScreen(draftStart);
      const b = worldToScreen(draftEnd);

      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(a.x, a.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
    }

    for (const p of snapPoints) {
      const sp = worldToScreen(p);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, p.type === '中点' ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle =
        p.type === '中点'
          ? 'rgba(17,24,39,0.55)'
          : p.type === '始点'
          ? 'rgba(239,68,68,0.9)'
          : 'rgba(17,24,39,0.9)';
      ctx.fill();
    }

    if (snapHit) {
      const sp = worldToScreen(snapHit);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [width, height, contours, draftLines, snapPoints, draftStart, draftEnd, snapHit, view]);

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <div className="rounded-xl border p-2 bg-white">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="h-auto w-full"
          style={{ touchAction: 'none' }}
          onMouseEnter={() => {
            hoverRef.current = true;
          }}
          onMouseLeave={() => {
            hoverRef.current = false;
            onMouseUp();
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
        />
        <div className="mt-2 text-xs text-gray-600">
          ・1個目に閉じた輪郭 = 外形<br />
          ・2個目以降に閉じた輪郭 = 穴<br />
          ・四角穴は四角く囲んで「輪郭確定」すればOK
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="text-xs text-gray-600">表示倍率：</div>
          <div className="text-xs font-semibold">{Math.round(view.scale * 100)}%</div>
          <button
            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
            onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale * 1.08, 0.2, 8) }))}
          >
            ＋
          </button>
          <button
            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
            onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale / 1.08, 0.2, 8) }))}
          >
            －
          </button>
          <button
            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
            onClick={() =>
              setView({
                scale: 1.0,
                panX: width / 2,
                panY: height / 2,
              })
            }
          >
            リセット
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-3 bg-gray-50 space-y-2">
        <div className="text-sm font-semibold">コマンド</div>

        <div className="rounded-lg border bg-white p-2 text-sm">
          <div className="font-semibold mb-1">線分</div>

          <div className="grid grid-cols-[90px_1fr] gap-y-1">
            <div className="text-gray-600">始点</div>
            <div>{draftStart ? `${round1(draftStart.x)}, ${round1(draftStart.y)} mm` : '—'}</div>

            <div className="text-gray-600">終点</div>
            <div>{draftEnd ? `${round1(draftEnd.x)}, ${round1(draftEnd.y)} mm` : '—'}</div>

            <div className="text-gray-600">長さ</div>
            <div className="flex items-center gap-2">
              <input
                className="w-full rounded-md border px-2 py-1"
                placeholder={`例）${info.length || '1000'}`}
                value={cmdLength}
                onChange={(e) => {
                  setCmdLength(e.target.value);
                  setLockedByNumbers(true);
                }}
              />
              <span className="text-xs text-gray-500">mm</span>
            </div>

            <div className="text-gray-600">角度</div>
            <div className="flex items-center gap-2">
              <input
                className="w-full rounded-md border px-2 py-1"
                placeholder={`例）${info.angle || '0'}`}
                value={cmdAngle}
                onChange={(e) => {
                  setCmdAngle(e.target.value);
                  setLockedByNumbers(true);
                }}
              />
              <span className="text-xs text-gray-500">deg</span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <button className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50" onClick={clearNumbers}>
              数値解除
            </button>

            <button
              className={`rounded-lg border px-3 py-1 text-sm ${
                draftPoints.length >= 3 ? 'hover:bg-gray-50' : 'opacity-40'
              }`}
              disabled={draftPoints.length < 3}
              onClick={() => finalizeContour(draftPoints)}
            >
              輪郭確定
            </button>

            <button
              className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
              onClick={startNewContour}
            >
              新しい輪郭
            </button>

            <button
              className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
              onClick={cancelDraft}
            >
              ドラフト取消
            </button>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-2 text-xs text-gray-600">
          <div className="font-semibold mb-1">輪郭</div>
          外形：{contours.length >= 1 ? 'あり' : 'なし'}<br />
          穴数：{Math.max(0, contours.length - 1)}<br />
          作図中の点数：{draftPoints.length}
        </div>

        <div className="rounded-lg border bg-white p-2">
          <button
            className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={resetAll}
          >
            スケッチを全削除
          </button>
        </div>
      </div>
    </div>
  );
}