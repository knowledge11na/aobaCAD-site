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
  onChange,
}) {
  const canvasRef = useRef(null);

  // onChange ref（無限ループ対策）
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // ===== 世界座標(mm)で保持 =====
  const [points, setPoints] = useState([]); // {x,y} world(mm)
  const [closed, setClosed] = useState(false);

  // ===== 表示変換（world(mm) -> screen(px)） =====
  // scale: px/mm, pan: screen(px)
  const [view, setView] = useState(() => ({
    scale: 1.0, // px per mm（初期は1）
    panX: width / 2,
    panY: height / 2,
  }));

  // 表示用の線分（world）
  const lines = useMemo(() => {
    const segs = [];
    for (let i = 0; i < points.length - 1; i++) segs.push({ a: points[i], b: points[i + 1] });
    if (closed && points.length >= 3) segs.push({ a: points[points.length - 1], b: points[0] });
    return segs;
  }, [points, closed]);

  // ドラフト（次の1本）
  const [draftStart, setDraftStart] = useState(null); // world
  const [draftEnd, setDraftEnd] = useState(null); // world
  const [snapHit, setSnapHit] = useState(null); // world + type

  // 数値入力（mm / deg）
  const [cmdLength, setCmdLength] = useState('');
  const [cmdAngle, setCmdAngle] = useState('');
  const [lockedByNumbers, setLockedByNumbers] = useState(false);

  // パン操作
  const panDragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  // ===== 変換関数 =====
  const worldToScreen = (p) => ({
    x: p.x * view.scale + view.panX,
    y: p.y * view.scale + view.panY,
  });

  const screenToWorld = (p) => ({
    x: (p.x - view.panX) / view.scale,
    y: (p.y - view.panY) / view.scale,
  });

  // ★重要：表示ズレ補正（CSS表示→内部座標）
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

  // スナップ点（world）
  const snapPoints = useMemo(() => {
    const pts = [];
    for (const ln of lines) {
      pts.push({ x: ln.a.x, y: ln.a.y, type: '端点' });
      pts.push({ x: ln.b.x, y: ln.b.y, type: '端点' });
      pts.push({ x: (ln.a.x + ln.b.x) / 2, y: (ln.a.y + ln.b.y) / 2, type: '中点' });
    }
    if (!closed && points.length >= 1) {
      pts.push({ x: points[0].x, y: points[0].y, type: '始点' });
    }
    return pts;
  }, [lines, points, closed]);

  function findSnap(worldP) {
    // snapPx（画面px）をworld距離に変換
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
      const ang = rad(Number(cmdAngle)); // 右=0°, 上=90°にしたいのでyはマイナス方向
      const dx = Math.cos(ang) * L;
      const dy = -Math.sin(ang) * L;
      return { x: startWorld.x + dx, y: startWorld.y + dy };
    }

    // 角度なし（長さだけ）→マウス方向
    const end = rawEndWorld || startWorld;
    const vx = end.x - startWorld.x;
    const vy = end.y - startWorld.y;
    const vlen = Math.sqrt(vx * vx + vy * vy) || 1;
    const ux = vx / vlen;
    const uy = vy / vlen;
    return { x: startWorld.x + ux * L, y: startWorld.y + uy * L };
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
    clearNumbers();
  }

  function resetAll() {
    setPoints([]);
    setClosed(false);
    cancelDraft();
  }

  function updateDraftEndByMouse(worldP) {
    const snap = findSnap(worldP);
    const raw = snap ? { x: snap.x, y: snap.y } : worldP;

    setSnapHit(snap ? { x: snap.x, y: snap.y, type: snap.type } : null);

    if (!draftStart) return;

    const end = lockedByNumbers ? applyNumbersEnd(draftStart, raw) : raw;
    setDraftEnd(end);
  }

  function tryCloseIfNearStart(endWorld) {
    if (points.length < 3) return false;
    const s = points[0];
    const snapWorld = (snapPx / view.scale) * 1.2;
    if (dist(endWorld, s) <= snapWorld) {
      setClosed(true);
      cancelDraft();
      return true;
    }
    return false;
  }

  function commitSegment(a, b) {
    if (dist(a, b) < 0.0001) return;

    // 1本目
    if (points.length === 0) {
      setPoints([a, b]);
      setDraftStart(b);
      setDraftEnd(b);
      clearNumbers();
      return;
    }

    if (closed) return;

    // 閉じる判定
    if (tryCloseIfNearStart(b)) return;

    setPoints((prev) => [...prev, b]);
    setDraftStart(b);
    setDraftEnd(b);
    clearNumbers();
  }

  function closeByButton() {
    if (closed) return;
    if (points.length < 3) return;
    setClosed(true);
    cancelDraft();
  }

  // ===== マウス操作 =====
  function onMouseDown(e) {
    // 右ボタン/中ボタン：パン開始
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

    // 左クリック：作図
    if (e.button !== 0) return;
    if (closed) return;

    const sp = getScreenPoint(e);
    const wp0 = screenToWorld(sp);
    const snap = findSnap(wp0);
    const wp = snap ? { x: snap.x, y: snap.y } : wp0;

    // 始点がないなら始点
    if (!draftStart) {
      const start = points.length > 0 ? points[points.length - 1] : wp;
      setDraftStart(start);
      setDraftEnd(start);
      setSnapHit(snap ? { x: snap.x, y: snap.y, type: snap.type } : null);

      if (points.length === 0) {
        setPoints([start]); // 始点だけ入れておく
      }
      return;
    }

    // 終点確定
    const endRaw = snap ? { x: snap.x, y: snap.y } : wp0;
    const end = applyNumbersEnd(draftStart, endRaw);

    // pointsが始点だけのとき
    if (points.length === 1) {
      const first = points[0];
      setPoints([first, end]);
      setDraftStart(end);
      setDraftEnd(end);
      clearNumbers();
      return;
    }

    commitSegment(draftStart, end);
  }

  function onMouseMove(e) {
    const sp = getScreenPoint(e);

    // パン中
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

    // 作図中の追従
    const wp = screenToWorld(sp);
    updateDraftEndByMouse(wp);
  }

  function onMouseUp() {
    if (panDragRef.current.active) {
      panDragRef.current.active = false;
    }
  }

  // 右クリックメニュー無効（パンで使う）
  function onContextMenu(e) {
    e.preventDefault();
  }

  // ホイール：ズーム（カーソル位置中心）
  function onWheel(e) {
    e.preventDefault();
    const c = canvasRef.current;
    if (!c) return;

    const sp = getScreenPoint(e);
    const beforeWorld = screenToWorld(sp);

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const nextScale = clamp(view.scale * factor, 0.05, 30);

    // “カーソル位置のworld座標”が動かないようにpanを調整
    // sp = world*scale + pan  → pan = sp - world*scale
    const nextPanX = sp.x - beforeWorld.x * nextScale;
    const nextPanY = sp.y - beforeWorld.y * nextScale;

    setView({ scale: nextScale, panX: nextPanX, panY: nextPanY });
  }

  // キーボード
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') cancelDraft();
      if (e.key === 'Enter') {
        if (closed) return;
        if (!draftStart) return;

        const end = applyNumbersEnd(draftStart, draftEnd || draftStart);

        if (points.length === 1) {
          const first = points[0];
          setPoints([first, end]);
          setDraftStart(end);
          setDraftEnd(end);
          clearNumbers();
          return;
        }
        commitSegment(draftStart, end);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStart, draftEnd, cmdLength, cmdAngle, points, closed]);

  // 親へ通知
  useEffect(() => {
    onChangeRef.current?.({
      profile: { points, closed },
      lines,
      view,
    });
  }, [points, closed, lines, view]);

  // ===== 描画 =====
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // グリッド：1マス=100mm（太線）、10mm（薄線）
    const major = 100; // mm
    const minor = 10;  // mm

    // 画面に見えるworld範囲を計算
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

    // ズームが遠いときは細かいグリッドを省略（重い＆見えない）
    const pxPerMinor = minor * view.scale;
    if (pxPerMinor >= 6) {
      drawGrid(minor, '#f3f4f6', 1);
    }
    drawGrid(major, '#e5e7eb', 1);

    // 原点クロス（world 0,0）
    {
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
    }

    // 既存線
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    for (const ln of lines) {
      const a = worldToScreen(ln.a);
      const b = worldToScreen(ln.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // スナップ点
    for (const p of snapPoints) {
      const sp = worldToScreen(p);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, p.type === '中点' ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle =
        p.type === '中点' ? 'rgba(17,24,39,0.55)' : p.type === '始点' ? 'rgba(239,68,68,0.9)' : 'rgba(17,24,39,0.9)';
      ctx.fill();
    }

    // ドラフト
    if (!closed && draftStart && draftEnd) {
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
      ctx.fillStyle = '#ef4444';
      ctx.fill();
    }

    // スナップハイライト
    if (snapHit) {
      const sp = worldToScreen(snapHit);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [width, height, lines, snapPoints, draftStart, draftEnd, snapHit, closed, view]);

  const info = useMemo(() => {
    const start = draftStart;
    const end = draftEnd;
    if (!start || !end) return { length: '', angle: '' };

    const L = dist(start, end);
    const vx = end.x - start.x;
    const vy = end.y - start.y;
    const ang = Math.atan2(-vy, vx);
    const angDeg = (degFromRad(ang) + 360) % 360;

    return { length: round1(L), angle: round1(angDeg) };
  }, [draftStart, draftEnd]);

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
          ・グリッド：太線=100mm / 細線=10mm（ズームで自動表示）<br />
          ・ホイール：拡大縮小（カーソル中心） / 右ドラッグ：移動（パン）<br />
          ・クリックで線を追加、最後に「閉じる」で輪郭確定
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
              className={`rounded-lg border px-3 py-1 text-sm ${points.length >= 3 && !closed ? 'hover:bg-gray-50' : 'opacity-40'}`}
              disabled={points.length < 3 || closed}
              onClick={closeByButton}
            >
              閉じる
            </button>

            <button className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50" onClick={cancelDraft}>
              ドラフト取消
            </button>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-2 text-xs text-gray-600">
          <div className="font-semibold mb-1">輪郭</div>
          点数：{points.length} / 状態：{closed ? '閉じた' : '未閉'}
        </div>

        <div className="rounded-lg border bg-white p-2">
          <button className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" onClick={resetAll}>
            スケッチを全削除
          </button>
        </div>
      </div>
    </div>
  );
}