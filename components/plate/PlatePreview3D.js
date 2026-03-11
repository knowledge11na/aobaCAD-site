// file: components/plate/PlatePreview3D.js
'use client';

import { useMemo } from 'react';

function round1(n) {
  return Math.round(n * 10) / 10;
}

function isoProject(x, y, z) {
  const cos = 0.8660254037844386; // cos(30deg)
  const sin = 0.5; // sin(30deg)
  return {
    x: (x - y) * cos,
    y: (x + y) * sin - z,
  };
}

function pointsToPath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round1(p.x)} ${round1(p.y)}`).join(' ') + ' Z';
}

function signedArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function ensureClockwise(points) {
  return signedArea(points) < 0 ? points : [...points].reverse();
}

function ensureCounterClockwise(points) {
  return signedArea(points) > 0 ? points : [...points].reverse();
}

function edgeVisible(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx + dy > 0;
}

function buildIsoData(outer, holes, thickness) {
  if (!Array.isArray(outer) || outer.length < 3) return null;

  const t = Math.max(0.1, Number(thickness) || 1);

  const outerCW = ensureClockwise(outer);
  const holesCCW = (holes || []).filter((h) => Array.isArray(h) && h.length >= 3).map(ensureCounterClockwise);

  const topOuter = outerCW.map((p) => isoProject(p.x, p.y, t));
  const botOuter = outerCW.map((p) => isoProject(p.x, p.y, 0));

  const topHoles = holesCCW.map((hole) => hole.map((p) => isoProject(p.x, p.y, t)));
  const botHoles = holesCCW.map((hole) => hole.map((p) => isoProject(p.x, p.y, 0)));

  const sideFaces = [];

  for (let i = 0; i < outerCW.length; i++) {
    const a = outerCW[i];
    const b = outerCW[(i + 1) % outerCW.length];
    if (!edgeVisible(a, b)) continue;

    const p1 = isoProject(a.x, a.y, 0);
    const p2 = isoProject(b.x, b.y, 0);
    const p3 = isoProject(b.x, b.y, t);
    const p4 = isoProject(a.x, a.y, t);

    sideFaces.push([p1, p2, p3, p4]);
  }

  const holeFaces = [];
  for (const hole of holesCCW) {
    for (let i = 0; i < hole.length; i++) {
      const a = hole[i];
      const b = hole[(i + 1) % hole.length];
      if (!edgeVisible(a, b)) continue;

      const p1 = isoProject(a.x, a.y, 0);
      const p2 = isoProject(b.x, b.y, 0);
      const p3 = isoProject(b.x, b.y, t);
      const p4 = isoProject(a.x, a.y, t);

      holeFaces.push([p1, p2, p3, p4]);
    }
  }

  const allPts = [
    ...topOuter,
    ...botOuter,
    ...topHoles.flat(),
    ...botHoles.flat(),
    ...sideFaces.flat(),
    ...holeFaces.flat(),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of allPts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  const pad = 40;
  const viewBox = `${round1(minX - pad)} ${round1(minY - pad)} ${round1(maxX - minX + pad * 2)} ${round1(maxY - minY + pad * 2)}`;

  const topPath =
    pointsToPath(topOuter) +
    holesCCW
      .map((hole) => {
        const topHole = hole.map((p) => isoProject(p.x, p.y, t));
        return ' ' + pointsToPath([...topHole].reverse());
      })
      .join('');

  return {
    viewBox,
    topPath,
    sideFaces,
    holeFaces,
    topOuter,
    topHoles,
    botOuter,
    botHoles,
    thickness: t,
  };
}

export default function PlatePreview3D({
  outer = [],
  holes = [],
  thickness = 9,
}) {
  const data = useMemo(() => {
    return buildIsoData(outer, holes, thickness);
  }, [outer, holes, thickness]);

  const canShow = !!data;

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-xl border bg-white">
      {!canShow ? (
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          外形を閉じるとアイソメ図を表示します
        </div>
      ) : (
        <div className="h-full w-full p-2">
          <svg
            viewBox={data.viewBox}
            className="h-full w-full"
            aria-label="plate-isometric-preview"
          >
            <rect x="-100000" y="-100000" width="200000" height="200000" fill="#ffffff" />

            {data.sideFaces.map((face, i) => (
              <polygon
                key={`side-${i}`}
                points={face.map((p) => `${round1(p.x)},${round1(p.y)}`).join(' ')}
                fill="#9ca3af"
                stroke="#4b5563"
                strokeWidth="1.2"
              />
            ))}

            {data.holeFaces.map((face, i) => (
              <polygon
                key={`hole-side-${i}`}
                points={face.map((p) => `${round1(p.x)},${round1(p.y)}`).join(' ')}
                fill="#a1a1aa"
                stroke="#52525b"
                strokeWidth="1.1"
              />
            ))}

            <path
              d={data.topPath}
              fill="#d1d5db"
              stroke="#111827"
              strokeWidth="1.5"
              fillRule="evenodd"
            />

            {data.topOuter.map((p, i) => {
              const q = data.topOuter[(i + 1) % data.topOuter.length];
              return (
                <line
                  key={`top-edge-${i}`}
                  x1={round1(p.x)}
                  y1={round1(p.y)}
                  x2={round1(q.x)}
                  y2={round1(q.y)}
                  stroke="#111827"
                  strokeWidth="1.5"
                />
              );
            })}

            {data.topHoles.map((hole, hi) =>
              hole.map((p, i) => {
                const q = hole[(i + 1) % hole.length];
                return (
                  <line
                    key={`top-hole-${hi}-${i}`}
                    x1={round1(p.x)}
                    y1={round1(p.y)}
                    x2={round1(q.x)}
                    y2={round1(q.y)}
                    stroke="#111827"
                    strokeWidth="1.3"
                  />
                );
              })
            )}

            <text
              x="18"
              y="28"
              fontSize="18"
              fill="#374151"
            >
              板厚: {round1(data.thickness)} mm
            </text>
          </svg>
        </div>
      )}
    </div>
  );
}