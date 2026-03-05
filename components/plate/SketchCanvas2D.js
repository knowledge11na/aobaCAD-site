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

  // 親のonChangeが毎回変わっても無限ループしないようにref化
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [lines, setLines] = useState([]); // {a:{x,y}, b:{x,y}}[]
  const [tool] = useState('line');

  const [draftStart, setDraftStart] = useState(null);
  const [draftEnd, setDraftEnd] = useState(null);

  const [snapHit, setSnapHit] = useState(null);

  const [cmdLength, setCmdLength] = useState('');
  const [cmdAngle, setCmdAngle] = useState('');
  const [lockedByNumbers, setLockedByNumbers] = useState(false);

  const cmdStart = draftStart;
  const cmdEnd = draftEnd;

  const snapPoints = useMemo(() => {
    const pts = [];
    for (const ln of lines) {
      const a = ln.a;
      const b = ln.b;
      pts.push({ x: a.x, y: a.y, type: '端点' });
      pts.push({ x: b.x, y: b.y, type: '端点' });
      pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, type: '中点' });
    }
    return pts;
  }, [lines]);

  function getCanvasPoint(e) {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function findSnap(p) {
    let best = null;
    let bestD = Infinity;
    for (const s of snapPoints) {
      const d = dist(p, s);
      if (d <= snapPx && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  function applyNumbersEnd(start, rawEnd) {
    if (!start) return rawEnd;

    const hasLen = cmdLength !== '' && !Number.isNaN(Number(cmdLength));
    const hasAng = cmdAngle !== '' && !Number.isNaN(Number(cmdAngle));
    if (!hasLen && !hasAng) return rawEnd;

    const L = hasLen ? clamp(Number(cmdLength), 0, 999999) : dist(start, rawEnd || start);

    if (hasAng) {
      const ang = rad(Number(cmdAngle));
      const dx = Math.cos(ang) * L;
      const dy = -Math.sin(ang) * L; // 画面上方向を+にしたいのでマイナス
      return { x: start.x + dx, y: start.y + dy };
    }

    const end = rawEnd || start;
    const vx = end.x - start.x;
    const vy = end.y - start.y;
    const vlen = Math.sqrt(vx * vx + vy * vy) || 1;
    const ux = vx / vlen;
    const uy = vy / vlen;
    return { x: start.x + ux * L, y: start.y + uy * L };
  }

  function updateDraftEndByMouse(p) {
    const snap = findSnap(p);
    const raw = snap ? { x: snap.x, y: snap.y } : p;

    setSnapHit(snap ? { x: snap.x, y: snap.y, type: snap.type } : null);

    if (!draftStart) return;

    const end = lockedByNumbers ? applyNumbersEnd(draftStart, raw) : raw;
    setDraftEnd(end);
  }

  function commitLine(a, b) {
    const aa = { x: a.x, y: a.y };
    const bb = { x: b.x, y: b.y };
    if (dist(aa, bb) < 0.5) return;

    setLines((prev) => [...prev, { a: aa, b: bb }]);
    setDraftStart(null);
    setDraftEnd(null);
    setSnapHit(null);
    setLockedByNumbers(false);
    setCmdLength('');
    setCmdAngle('');
  }

  function cancelDraft() {
    setDraftStart(null);
    setDraftEnd(null);
    setSnapHit(null);
    setLockedByNumbers(false);
    setCmdLength('');
    setCmdAngle('');
  }

  function onMouseDown(e) {
    if (tool !== 'line') return;

    const p0 = getCanvasPoint(e);
    const snap = findSnap(p0);
    const p = snap ? { x: snap.x, y: snap.y } : p0;

    // 1回目：始点
    if (!draftStart) {
      setDraftStart(p);
      setDraftEnd(p);
      setSnapHit(snap ? { x: snap.x, y: snap.y, type: snap.type } : null);
      return;
    }

    // 2回目：終点
    const endRaw = snap ? { x: snap.x, y: snap.y } : p0;
    const end = applyNumbersEnd(draftStart, endRaw);
    commitLine(draftStart, end);
  }

  function onMouseMove(e) {
    const p = getCanvasPoint(e);
    updateDraftEndByMouse(p);
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') cancelDraft();
      if (e.key === 'Enter') {
        if (!draftStart) return;
        const end = applyNumbersEnd(draftStart, draftEnd || draftStart);
        commitLine(draftStart, end);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStart, draftEnd, cmdLength, cmdAngle]);

  // ★無限ループ対策：depsに onChange を入れない（ref経由で呼ぶ）
  useEffect(() => {
    onChangeRef.current?.({ lines });
  }, [lines]);

  // 描画
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // grid
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    const step = 25;
    for (let x = 0; x <= width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // existing lines
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    for (const ln of lines) {
      ctx.beginPath();
      ctx.moveTo(ln.a.x, ln.a.y);
      ctx.lineTo(ln.b.x, ln.b.y);
      ctx.stroke();
    }

    // snap points
    for (const p of snapPoints) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.type === '中点' ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = p.type === '中点' ? 'rgba(17,24,39,0.55)' : 'rgba(17,24,39,0.9)';
      ctx.fill();
    }

    // draft
    if (draftStart && draftEnd) {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(draftStart.x, draftStart.y);
      ctx.lineTo(draftEnd.x, draftEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(draftStart.x, draftStart.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
    }

    // snap highlight
    if (snapHit) {
      ctx.beginPath();
      ctx.arc(snapHit.x, snapHit.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [width, height, lines, snapPoints, draftStart, draftEnd, snapHit]);

  const info = useMemo(() => {
    const start = cmdStart;
    const end = cmdEnd;
    if (!start || !end) return { length: '', angle: '' };

    const L = dist(start, end);
    const vx = end.x - start.x;
    const vy = end.y - start.y;
    const ang = Math.atan2(-vy, vx);
    const angDeg = (degFromRad(ang) + 360) % 360;

    return { length: round1(L), angle: round1(angDeg) };
  }, [cmdStart, cmdEnd]);

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
        />
        <div className="mt-2 text-xs text-gray-600">
          ・線ツール：始点クリック → マウス追従 → 終点クリック<br />
          ・長さ/角度を入れたら Enter で確定（Escでキャンセル）
        </div>
      </div>

      <div className="rounded-xl border p-3 bg-gray-50 space-y-2">
        <div className="text-sm font-semibold">コマンド</div>

        <div className="rounded-lg border bg-white p-2 text-sm">
          <div className="font-semibold mb-1">線分</div>

          <div className="grid grid-cols-[90px_1fr] gap-y-1">
            <div className="text-gray-600">始点</div>
            <div>{cmdStart ? `${round1(cmdStart.x)}, ${round1(cmdStart.y)}` : '—'}</div>

            <div className="text-gray-600">終点</div>
            <div>{cmdEnd ? `${round1(cmdEnd.x)}, ${round1(cmdEnd.y)}` : '—'}</div>

            <div className="text-gray-600">長さ</div>
            <div className="flex items-center gap-2">
              <input
                className="w-full rounded-md border px-2 py-1"
                placeholder={`例）${info.length || '120'}`}
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

          <div className="mt-2 flex gap-2">
            <button
              className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
              onClick={() => {
                setLockedByNumbers(false);
                setCmdLength('');
                setCmdAngle('');
              }}
            >
              数値解除
            </button>
            <button className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50" onClick={cancelDraft}>
              キャンセル
            </button>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-2 text-xs text-gray-600">
          <div className="font-semibold mb-1">スナップ</div>
          端点/中点に近づくと黄色でハイライト（半径 {snapPx}px）
        </div>

        <div className="rounded-lg border bg-white p-2">
          <button
            className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => {
              setLines([]);
              cancelDraft();
            }}
          >
            スケッチを全削除
          </button>
        </div>
      </div>
    </div>
  );
}