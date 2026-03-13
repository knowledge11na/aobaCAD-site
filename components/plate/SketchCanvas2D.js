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
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}
function pointKey(p) {
  return `${round1(p.x)}_${round1(p.y)}`;
}
function distToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;

  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(p, a);

  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return dist(p, b);

  const t = c1 / c2;
  const px = a.x + t * vx;
  const py = a.y + t * vy;
  return dist(p, { x: px, y: py });
}

function createCirclePoints(cx, cy, diameter, segments = 48) {
  const r = diameter / 2;
  const pts = [];

  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
    });
  }

  return pts;
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
  const historyRef = useRef([]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [contours, setContours] = useState([]);
  const [looseLines, setLooseLines] = useState([]);

  const [draftPoints, setDraftPoints] = useState([]);
  const [draftClosed, setDraftClosed] = useState(false);

  const [draftStart, setDraftStart] = useState(null);
  const [draftEnd, setDraftEnd] = useState(null);
  const [snapHit, setSnapHit] = useState(null);

const [lineMode, setLineMode] = useState('single');
// 'single' | 'contour' | 'hole' | 'circleHole'
  const [selectedSegment, setSelectedSegment] = useState(null);
const [circleDiameter, setCircleDiameter] = useState(10); // mm
const [circleCenterX, setCircleCenterX] = useState('');
const [circleCenterY, setCircleCenterY] = useState('');

  const [cmdLength, setCmdLength] = useState('');
  const [cmdAngle, setCmdAngle] = useState('');
  const [lockedByNumbers, setLockedByNumbers] = useState(false);

  const [manualStartX, setManualStartX] = useState('');
  const [manualStartY, setManualStartY] = useState('');
  const [manualEndX, setManualEndX] = useState('');
  const [manualEndY, setManualEndY] = useState('');

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

  function snapshotState() {
    return {
      contours: deepClone(contours),
      looseLines: deepClone(looseLines),
      draftPoints: deepClone(draftPoints),
      draftClosed,
      draftStart: deepClone(draftStart),
      draftEnd: deepClone(draftEnd),
      snapHit: deepClone(snapHit),
      lineMode,
      selectedSegment: deepClone(selectedSegment),
      cmdLength,
      cmdAngle,
      lockedByNumbers,
      manualStartX,
      manualStartY,
      manualEndX,
      manualEndY,
      view: deepClone(view),
    };
  }

  function pushHistory() {
    historyRef.current.push(snapshotState());
    if (historyRef.current.length > 100) {
      historyRef.current.shift();
    }
  }

  function restoreHistory() {
    const prev = historyRef.current.pop();
    if (!prev) return;

    setContours(prev.contours);
    setLooseLines(prev.looseLines);
    setDraftPoints(prev.draftPoints);
    setDraftClosed(prev.draftClosed);
    setDraftStart(prev.draftStart);
    setDraftEnd(prev.draftEnd);
    setSnapHit(prev.snapHit);
    setLineMode(prev.lineMode);
    setSelectedSegment(prev.selectedSegment);
    setCmdLength(prev.cmdLength);
    setCmdAngle(prev.cmdAngle);
    setLockedByNumbers(prev.lockedByNumbers);
    setManualStartX(prev.manualStartX);
    setManualStartY(prev.manualStartY);
    setManualEndX(prev.manualEndX);
    setManualEndY(prev.manualEndY);
    setView(prev.view);
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

    historyRef.current = [];
    setContours(nextContours);
    setLooseLines([]);
    setDraftPoints([]);
    setDraftClosed(false);
    setDraftStart(null);
    setDraftEnd(null);
    setSnapHit(null);
    setSelectedSegment(null);
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
    for (let ci = 0; ci < contours.length; ci++) {
      const contour = contours[ci];
      if (!Array.isArray(contour) || contour.length < 2) continue;
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        segs.push({
          a,
          b,
          type: 'contour',
          contourIndex: ci,
          segmentIndex: i,
        });
      }
    }
    return segs;
  }, [contours]);

  const looseLineSegments = useMemo(() => {
    return looseLines
      .filter((ln) => ln?.a && ln?.b)
      .map((ln, index) => ({
        a: ln.a,
        b: ln.b,
        type: 'loose',
        index,
      }));
  }, [looseLines]);

  const draftLines = useMemo(() => {
    const segs = [];
    for (let i = 0; i < draftPoints.length - 1; i++) {
      segs.push({ a: draftPoints[i], b: draftPoints[i + 1], type: 'draft', index: i });
    }
    return segs;
  }, [draftPoints]);

  const allLines = useMemo(() => {
    return [...confirmedLines, ...looseLineSegments, ...draftLines];
  }, [confirmedLines, looseLineSegments, draftLines]);

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

  function findAnySegmentNear(worldP) {
    const hitWorld = (snapPx / view.scale) * 1.2;
    let best = null;
    let bestD = Infinity;

    for (const ln of [...looseLineSegments, ...confirmedLines]) {
      const d = distToSegment(worldP, ln.a, ln.b);
      if (d <= hitWorld && d < bestD) {
        bestD = d;
        if (ln.type === 'loose') {
          best = { kind: 'loose', index: ln.index };
        } else if (ln.type === 'contour') {
          best = {
            kind: 'contour',
            contourIndex: ln.contourIndex,
            segmentIndex: ln.segmentIndex,
          };
        }
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

  function clearManualInputs() {
    setManualStartX('');
    setManualStartY('');
    setManualEndX('');
    setManualEndY('');
  }

  function clearDraftOnly() {
    setDraftPoints([]);
    setDraftClosed(false);
    setDraftStart(null);
    setDraftEnd(null);
    setSnapHit(null);
  }

  function cancelDraft() {
    clearDraftOnly();
    clearNumbers();
  }

  function resetAll() {
    pushHistory();
    setContours([]);
    setLooseLines([]);
    setSelectedSegment(null);
    clearDraftOnly();
    clearNumbers();
    clearManualInputs();
  }

function addCircleHole(cx, cy, dia) {

  const circle = createCirclePoints(cx, cy, dia);

  pushHistory();

  setContours(prev => {
    if (prev.length === 0) {
      alert("外形を先に作ってください");
      return prev;
    }
    return [...prev, circle];
  });

}

  function startNewContour() {
    setLineMode('contour');
    clearDraftOnly();
    clearNumbers();
  }

  function startSingleLineMode() {
    setLineMode('single');
    clearDraftOnly();
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

  pushHistory();

  if (lineMode === 'hole') {
    setContours((prev) => {
      if (prev.length === 0) {
        alert('外形を先に作ってください');
        return prev;
      }
      return [...prev, nextPoints]; // hole
    });
  } else {
    setContours((prev) => {
      if (prev.length === 0) return [nextPoints]; // outer
      return [...prev, nextPoints];
    });
  }

  clearDraftOnly();
  setDraftClosed(true);
  clearNumbers();
}


function tryCloseIfNearStart(endWorld, currentPoints) {

  if (currentPoints.length < 3) return false;

  const start = currentPoints[0];
  const snapWorld = (snapPx / view.scale) * 1.2;

  if (dist(endWorld, start) <= snapWorld) {

    // ⭐ 最後を始点にスナップして閉じる
    const closed = [...currentPoints.slice(0, -1), start];

    finalizeContour(closed);
    return true;
  }

  return false;
}

  function addLooseLine(start, end) {
    if (!start || !end) return;
    if (dist(start, end) < 0.0001) return;

    pushHistory();
    setLooseLines((prev) => [...prev, { a: start, b: end }]);
    setSelectedSegment(null);
    clearDraftOnly();
    clearNumbers();
  }

  function contourToLooseLinesWithoutOne(contour, removeSegmentIndex) {
    const result = [];
    for (let i = 0; i < contour.length; i++) {
      if (i === removeSegmentIndex) continue;
      result.push({
        a: contour[i],
        b: contour[(i + 1) % contour.length],
      });
    }
    return result;
  }

  function deleteSelectedSegment() {
    if (!selectedSegment) return;

    pushHistory();

    if (selectedSegment.kind === 'loose') {
      setLooseLines((prev) => prev.filter((_, i) => i !== selectedSegment.index));
      setSelectedSegment(null);
      return;
    }

    if (selectedSegment.kind === 'contour') {
      setContours((prevContours) => {
        const contour = prevContours[selectedSegment.contourIndex];
        if (!contour || contour.length < 3) return prevContours;

        const nextContours = prevContours.filter((_, i) => i !== selectedSegment.contourIndex);
        const converted = contourToLooseLinesWithoutOne(contour, selectedSegment.segmentIndex);

        setLooseLines((prevLoose) => [...prevLoose, ...converted]);
        return nextContours;
      });
      setSelectedSegment(null);
    }
  }

  function commitManualSegment(start, end) {
    if (!start || !end) return;
    if (dist(start, end) < 0.0001) return;

    if (lineMode === 'single') {
      addLooseLine(start, end);
      clearManualInputs();
      return;
    }

    if (draftPoints.length === 0) {
      pushHistory();
      setDraftPoints([start, end]);
      setDraftStart(end);
      setDraftEnd(end);
      setDraftClosed(false);
      setSnapHit(null);
      clearNumbers();
      clearManualInputs();
      return;
    }

    const currentLast = draftPoints[draftPoints.length - 1];
    const startMatchesLast = dist(start, currentLast) < 0.001;

    if (!startMatchesLast) {
      addLooseLine(start, end);
      clearManualInputs();
      return;
    }

    const nextPoints = [...draftPoints, end];

    if (tryCloseIfNearStart(end, nextPoints)) {
      clearManualInputs();
      return;
    }

    pushHistory();
    setDraftPoints(nextPoints);
    setDraftStart(end);
    setDraftEnd(end);
    setDraftClosed(false);
    setSnapHit(null);
    clearNumbers();
    clearManualInputs();
  }

  function addManualSegment() {
    const sx = toNum(manualStartX);
    const sy = toNum(manualStartY);
    const ex = toNum(manualEndX);
    const ey = toNum(manualEndY);

    if (sx === null || sy === null || ex === null || ey === null) return;

    const start = { x: sx, y: sy };
    const end = { x: ex, y: ey };

    commitManualSegment(start, end);
  }

  function addManualSegmentByLengthAngle() {
    const sx = toNum(manualStartX);
    const sy = toNum(manualStartY);
    const len = toNum(cmdLength);
    const ang = toNum(cmdAngle);

    if (sx === null || sy === null || len === null || ang === null) return;

    const start = { x: sx, y: sy };
    const r = rad(ang);
    const end = {
      x: start.x + Math.cos(r) * len,
      y: start.y - Math.sin(r) * len,
    };

    commitManualSegment(start, end);
  }

  function tryConvertLooseLinesToContour() {
    if (looseLines.length < 3) return false;

    const adjacency = new Map();
    const pointMap = new Map();

    for (let i = 0; i < looseLines.length; i++) {
      const ln = looseLines[i];
      const ka = pointKey(ln.a);
      const kb = pointKey(ln.b);

      pointMap.set(ka, { x: ln.a.x, y: ln.a.y });
      pointMap.set(kb, { x: ln.b.x, y: ln.b.y });

      if (!adjacency.has(ka)) adjacency.set(ka, []);
      if (!adjacency.has(kb)) adjacency.set(kb, []);

      adjacency.get(ka).push({ key: kb, lineIndex: i });
      adjacency.get(kb).push({ key: ka, lineIndex: i });
    }

    for (const [, arr] of adjacency) {
      if (arr.length !== 2) return false;
    }

    const firstLine = looseLines[0];
    const startKey = pointKey(firstLine.a);

    const used = new Set();
    const ordered = [pointMap.get(startKey)];

    let currentKey = startKey;
    let prevKey = null;

    while (true) {
      const nextCandidates = adjacency
        .get(currentKey)
        .filter((it) => !used.has(it.lineIndex) && it.key !== prevKey);

      if (nextCandidates.length === 0) break;

      const next = nextCandidates[0];
      used.add(next.lineIndex);
      prevKey = currentKey;
      currentKey = next.key;

      if (currentKey === startKey) break;
      ordered.push(pointMap.get(currentKey));
    }

    if (used.size !== looseLines.length) return false;
    if (currentKey !== startKey) return false;
    if (ordered.length < 3) return false;

    pushHistory();
    setContours((prev) => [...prev, ordered]);
    setLooseLines([]);
    setSelectedSegment(null);
    clearDraftOnly();
    clearNumbers();
    return true;
  }

  function useCurrentStartToManual() {
    const p = draftStart ?? draftPoints[draftPoints.length - 1] ?? null;
    if (!p) return;
    setManualStartX(String(round1(p.x)));
    setManualStartY(String(round1(p.y)));
  }

  function useCurrentEndToManual() {
    const p = draftEnd ?? draftStart ?? null;
    if (!p) return;
    setManualEndX(String(round1(p.x)));
    setManualEndY(String(round1(p.y)));
  }

function onMouseDown(e) {

  if (e.button !== 0) return;

  // ⭐ 円穴モード
if (lineMode === 'circleHole') {

  const sp = getScreenPoint(e);
  const wp = screenToWorld(sp);

  setDraftPoints([{ x: wp.x, y: wp.y }]); // 中心
  clearNumbers();

  return;
}

  const sp = getScreenPoint(e);
  const wp0 = screenToWorld(sp);

    if (e.ctrlKey) {
      const hit = findAnySegmentNear(wp0);
      setSelectedSegment(hit);
      return;
    }

    const snap = findSnap(wp0);
    const wp = snap ? { x: snap.x, y: snap.y } : wp0;
    setSelectedSegment(null);

    if (lineMode === 'single') {
      if (!draftStart) {
        setDraftStart(wp);
        setDraftEnd(wp);
        setDraftClosed(false);
        setSnapHit(snap ? { x: snap.x, y: snap.y, type: snap.type } : null);
        return;
      }

      const endRaw = snap ? { x: snap.x, y: snap.y } : wp0;
      const end = applyNumbersEnd(draftStart, endRaw);

      addLooseLine(draftStart, end);
      return;
    }

    if (draftPoints.length === 0) {
      pushHistory();
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

    pushHistory();
    setDraftPoints(nextPoints);
    setDraftStart(end);
    setDraftEnd(end);
    clearNumbers();
  }

  function onMouseMove(e) {
    const sp = getScreenPoint(e);

    if (panDragRef.current.active) {
      const dx = sp.x - panDragRef.current.startX;
      const dy = sp.y - panDragRef.current.startY;
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
    if (panDragRef.current.active) {
      panDragRef.current.active = false;
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  function onWheel(e) {
    e.preventDefault();

    const sp = getScreenPoint(e);
    const beforeWorld = screenToWorld(sp);

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const nextScale = clamp(view.scale * factor, 0.05, 30);

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


if (lineMode === 'circleHole' && e.key === 'Enter') {

  if (draftPoints.length === 0) return;

  const c = draftPoints[0];

  const circle = createCirclePoints(
    c.x,
    c.y,
    circleDiameter
  );

  pushHistory();

  setContours(prev => {
    if (prev.length === 0) {
      alert("外形を先に作ってください");
      return prev;
    }
    return [...prev, circle];
  });

  clearDraftOnly();
}
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        restoreHistory();
        return;
      }

      if (e.key === 'Delete') {
        if (selectedSegment) {
          e.preventDefault();
          deleteSelectedSegment();
          return;
        }
      }

      if (e.key === 'Escape') {
        cancelDraft();
      }

      if (e.key === 'Enter') {
        const active = document.activeElement;
        const tag = active?.tagName?.toLowerCase?.();

        if (tag === 'input') {
          const sx = toNum(manualStartX);
          const sy = toNum(manualStartY);
          const ex = toNum(manualEndX);
          const ey = toNum(manualEndY);
          const len = toNum(cmdLength);
          const ang = toNum(cmdAngle);

          if (sx !== null && sy !== null && ex !== null && ey !== null) {
            addManualSegment();
            return;
          }

          if (sx !== null && sy !== null && len !== null && ang !== null) {
            addManualSegmentByLengthAngle();
            return;
          }
        }

        if (lineMode === 'single') {
          if (draftStart && draftEnd && dist(draftStart, draftEnd) > 0.0001) {
            addLooseLine(draftStart, draftEnd);
            return;
          }

          tryConvertLooseLinesToContour();
          return;
        }

        if (!draftStart || draftPoints.length === 0) return;

        const end = applyNumbersEnd(draftStart, draftEnd || draftStart);

        const nextPoints = [...draftPoints, end];
        if (tryCloseIfNearStart(end, nextPoints)) return;

        pushHistory();
        setDraftPoints(nextPoints);
        setDraftStart(end);
        setDraftEnd(end);
        clearNumbers();
      }
    }


    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    draftStart,
    draftEnd,
    cmdLength,
    cmdAngle,
    draftPoints,
    view.scale,
    manualStartX,
    manualStartY,
    manualEndX,
    manualEndY,
    lineMode,
    selectedSegment,
    looseLines,
    contours,
  ]);

  useEffect(() => {
    const outerContour = contours[0] ?? [];
    const holeContours = contours.slice(1);

const payload = {
profile: {
  outer: outerContour,
  holes: holeContours
},

  meta: {
    holes: holeContours
  },

  contours,
  looseLines,
  draftPoints,
  view,
};

    const key = JSON.stringify(payload.profile);
    if (lastNotifyRef.current === key) return;
    lastNotifyRef.current = key;

    onChangeRef.current?.(payload);
  }, [contours, looseLines, draftPoints, view]);

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

  function isSelectedLoose(index) {
    return selectedSegment?.kind === 'loose' && selectedSegment?.index === index;
  }

  function isSelectedContour(contourIndex, segmentIndex) {
    return (
      selectedSegment?.kind === 'contour' &&
      selectedSegment?.contourIndex === contourIndex &&
      selectedSegment?.segmentIndex === segmentIndex
    );
  }

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

    for (let ci = 0; ci < contours.length; ci++) {
      const contour = contours[ci];
      if (!Array.isArray(contour) || contour.length < 2) continue;

      for (let i = 0; i < contour.length; i++) {
        const a = worldToScreen(contour[i]);
        const b = worldToScreen(contour[(i + 1) % contour.length]);

        ctx.strokeStyle = isSelectedContour(ci, i) ? '#ef4444' : ci === 0 ? '#111827' : '#dc2626';
        ctx.lineWidth = isSelectedContour(ci, i) ? 3 : 2;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    for (const ln of looseLineSegments) {
      const a = worldToScreen(ln.a);
      const b = worldToScreen(ln.b);

      ctx.strokeStyle = isSelectedLoose(ln.index) ? '#ef4444' : '#0ea5e9';
      ctx.lineWidth = isSelectedLoose(ln.index) ? 3 : 2;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

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
  }, [
    width,
    height,
    contours,
    looseLineSegments,
    draftLines,
    snapPoints,
    draftStart,
    draftEnd,
    snapHit,
    view,
    selectedSegment,
  ]);

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <div className="rounded-xl border p-2 bg-white">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="h-auto w-full"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
        />
        <div className="mt-2 text-xs text-gray-600">
          ・黒線 = 外形 / 赤線 = 穴 / 水色線 = 単線 / 濃赤線 = 選択中 / 青線 = 作図中<br />
          ・Ctrl + クリックで線選択、Delete または ボタンで削除<br />
          ・輪郭線を1本消すと、その輪郭は単線に戻ります<br />
          ・Ctrl + Z で1つ戻る
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="text-xs text-gray-600">表示倍率：</div>
          <div className="text-xs font-semibold">{Math.round(view.scale * 100)}%</div>
          <button
            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
            onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale * 1.2, 0.05, 30) }))}
          >
            ＋
          </button>
          <button
            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
            onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale / 1.2, 0.05, 30) }))}
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
          <div className="mb-2 font-semibold">作図モード</div>

          <div className="flex flex-wrap gap-2">
            <button
              className={`rounded-lg border px-3 py-1 text-sm ${
                lineMode === 'single' ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'
              }`}
              onClick={startSingleLineMode}
            >
              単線モード
            </button>

            <button
              className={`rounded-lg border px-3 py-1 text-sm ${
                lineMode === 'contour' ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'
              }`}
              onClick={startNewContour}
            >
              輪郭モード
            </button>
          </div>

          <div className="mt-2 text-xs text-gray-500">
            ・単線モード: 1本ごとに自由な場所から開始<br />
            ・輪郭モード: 線をつないで閉じた輪郭を作成
          </div>
        </div>

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

          <div className="mt-3 border-t pt-3">
            <div className="mb-2 font-semibold">始点・終点を数値入力</div>

            <div className="grid grid-cols-[90px_1fr_1fr] gap-2 items-center">
              <div className="text-gray-600">始点</div>
              <input
                className="w-full rounded-md border px-2 py-1"
                placeholder="X"
                value={manualStartX}
                onChange={(e) => setManualStartX(e.target.value)}
              />
              <input
                className="w-full rounded-md border px-2 py-1"
                placeholder="Y"
                value={manualStartY}
                onChange={(e) => setManualStartY(e.target.value)}
              />

              <div className="text-gray-600">終点</div>
              <input
                className="w-full rounded-md border px-2 py-1"
                placeholder="X"
                value={manualEndX}
                onChange={(e) => setManualEndX(e.target.value)}
              />
              <input
                className="w-full rounded-md border px-2 py-1"
                placeholder="Y"
                value={manualEndY}
                onChange={(e) => setManualEndY(e.target.value)}
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                onClick={useCurrentStartToManual}
              >
                今の始点を入れる
              </button>

              <button
                className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                onClick={useCurrentEndToManual}
              >
                今の終点を入れる
              </button>

              <button
                className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                onClick={clearManualInputs}
              >
                数値座標クリア
              </button>
            </div>

            <div className="mt-2 grid gap-2">
              <button
                className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={addManualSegment}
              >
                この始点・終点で線を追加
              </button>

              <button
                className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={addManualSegmentByLengthAngle}
              >
                この始点 + 長さ + 角度で線を追加
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-500">
              ・終点を入れなくても、始点X/Y と 上の長さ・角度で線を追加できます<br />
              ・角度は 右=0°、上=90°、左=180°、下=270° です
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

            <button
              className={`rounded-lg border px-3 py-1 text-sm ${
                selectedSegment ? 'hover:bg-gray-50' : 'opacity-40'
              }`}
              disabled={!selectedSegment}
              onClick={deleteSelectedSegment}
            >
              選択線削除
            </button>
          </div>
        </div>

<button
  className={`rounded-lg border px-3 py-1 text-sm ${
    lineMode === 'hole' ? 'bg-red-50 border-red-300' : 'hover:bg-gray-50'
  }`}
  onClick={() => {
    setLineMode('hole');
    clearDraftOnly();
    clearNumbers();
  }}
>
  穴モード
</button>

<button
  className={`rounded-lg border px-3 py-1 text-sm ${
    lineMode === 'circleHole'
      ? 'bg-red-50 border-red-300'
      : 'hover:bg-gray-50'
  }`}
  onClick={() => setLineMode('circleHole')}
>
  円穴
</button>

<div className="flex items-center gap-2 text-sm mt-1">
  φ
  <input
    type="number"
    value={circleDiameter}
    onChange={(e)=>setCircleDiameter(Number(e.target.value))}
    className="border rounded px-2 py-1 w-20"
  />
</div>

<div className="flex items-center gap-2 text-sm mt-2">
  中心X
  <input
    type="number"
    value={circleCenterX}
    onChange={(e)=>setCircleCenterX(e.target.value)}
    className="border rounded px-2 py-1 w-20"
  />
</div>

<div className="flex items-center gap-2 text-sm mt-1">
  中心Y
  <input
    type="number"
    value={circleCenterY}
    onChange={(e)=>setCircleCenterY(e.target.value)}
    className="border rounded px-2 py-1 w-20"
  />
</div>

<button
  className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50 mt-2"
  onClick={()=>{
    const cx = Number(circleCenterX);
    const cy = Number(circleCenterY);
    const dia = Number(circleDiameter);

    if(!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(dia)) return;

    addCircleHole(cx,cy,dia);
  }}
>
  この位置に円穴作成
</button>

        <div className="rounded-lg border bg-white p-2 text-xs text-gray-600">
          <div className="font-semibold mb-1">輪郭</div>
          外形：{contours.length >= 1 ? 'あり' : 'なし'}<br />
          穴数：{Math.max(0, contours.length - 1)}<br />
          単線数：{looseLines.length}<br />
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