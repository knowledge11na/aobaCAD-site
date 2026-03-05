// file: app/editor/page.js
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import EditorCanvas from '@/components/EditorCanvas';
import EditorToolbar from '@/components/EditorToolbar';
import { fetchSteelCatalog } from '@/components/steel/steelCatalog';
import * as THREE from 'three';
import { SketchToolPanel, ExtrudePanel } from '@/components/sketch2d/SketchPanels';
import { detectClosedLoops } from '@/components/sketch2d/SketchOverlay';
import FileManagerModal from '@/components/file/FileManagerModal';
import PlateInsertModal from '@/components/plate/PlateInsertModal';
import { sanitizeObjectsForSave } from '@/components/file/fsStorage';

// ✅ sections.js の形状生成（EditorCanvas と一致させる）
import {
  buildChannelGeometry,
  buildAngleGeometry,
  buildHBeamGeometry,
  buildPipeGeometry,
  buildRoundBarGeometry,
  buildFlatBarGeometry,
  buildSquarePipeGeometry,
  buildExpandedMetalGeometry,
  buildCheckeredPlateGeometry,
} from '@/components/steel/sections';

const DEFAULT_LEFT = 260;
const DEFAULT_RIGHT = 260;

const LS_LEFT = 'cadsite_editor_left_w_v5';
const LS_RIGHT = 'cadsite_editor_right_w_v5';

const MM_BASE = 1000;

function uid() {
  return `obj_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function numLoose(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function buildSketchEntitiesFromPlateProfile(profile) {
  const pts = profile?.points ?? [];
  const closed = !!profile?.closed;
  if (pts.length < 2) return [];

  const norm = pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));

  const mkId = () => `ent_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

  const entities = [];
  for (let i = 0; i < norm.length - 1; i++) {
    entities.push({
      id: mkId(),
      type: 'line',
      a: { x: norm[i].x, y: norm[i].y },
      b: { x: norm[i + 1].x, y: norm[i + 1].y },
    });
  }
  if (closed && norm.length >= 3) {
    entities.push({
      id: mkId(),
      type: 'line',
      a: { x: norm[norm.length - 1].x, y: norm[norm.length - 1].y },
      b: { x: norm[0].x, y: norm[0].y },
    });
  }
  return entities;
}
// ✅ 生成時のデフォルト原点：正面左下（角）
// （円柱/円錐は底面中心）
function defaultPivotFor(type, data) {
  if (
    type === 'cube' ||
    type === 'box' ||
    type === 'fused' ||
    type === 'steel-channel' ||
    type === 'steel-angle' ||
    type === 'steel-hbeam' ||
    type === 'steel-squarepipe' ||
    type === 'steel-expanded' ||
    type === 'steel-checkered'
  ) {
    const s = data?.size ?? [MM_BASE, MM_BASE, MM_BASE];
    const w = Number(s[0]) || MM_BASE;
    const h = Number(s[1]) || MM_BASE;
    const d = Number(s[2]) || MM_BASE;
    return [-w / 2, -h / 2, -d / 2];
  }
  if (type === 'cylinder' || type === 'cone' || type === 'steel-pipe' || type === 'steel-roundbar') {
    const h = Number(data?.height) || Number(data?.size?.[1]) || MM_BASE;
    return [0, -h / 2, 0];
  }
  if (type === 'steel-flatbar') {
    // flatbar は外形箱ベースに合わせる
    const s = data?.size ?? [MM_BASE, MM_BASE, MM_BASE];
    return [-(s[0] ?? MM_BASE) / 2, -(s[1] ?? MM_BASE) / 2, -(s[2] ?? MM_BASE) / 2];
  }
  return [0, 0, 0];
}

// ✅ 生成時のデフォルト位置：床に置く（Y=0）
function defaultPositionFor() {
  return [0, 0, 0];
}

/** ====== Add panel（立方体/直方体/円柱/円錐） ====== */
function AddShapePanel({ draft, setDraft, onPlace, onCancel }) {
  if (!draft) return null;

  const type = draft.type;

  function setField(key, value) {
    setDraft((p) => ({ ...(p ?? {}), [key]: value }));
  }

  const isCube = type === 'cube';
  const isBox = type === 'box';
  const isCyl = type === 'cylinder';
  const isCone = type === 'cone';

  return (
    <div style={{ padding: 12, borderTop: '1px solid #333' }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>追加：{type}</div>

      {isCube ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>一辺 edge (mm)</div>
            <input
              type="number"
              value={Number(draft.edge ?? MM_BASE)}
              onChange={(e) => setField('edge', Number(e.target.value))}
              style={{ width: '100%', padding: 8 }}
            />
          </div>
        </div>
      ) : null}

      {isBox ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>サイズ W/H/D (mm)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="number"
                  value={(draft.size ?? [MM_BASE, MM_BASE, MM_BASE])[i]}
                  onChange={(e) => {
                    const s = [...(draft.size ?? [MM_BASE, MM_BASE, MM_BASE])];
                    s[i] = Number(e.target.value);
                    setField('size', s);
                  }}
                  style={{ width: '100%', padding: 8 }}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isCyl || isCone ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>半径入力</div>
            <select
              value={draft.radiusMode ?? 'diameter'}
              onChange={(e) => setField('radiusMode', e.target.value)}
              style={{ width: '100%', padding: 8 }}
            >
              <option value="diameter">直径</option>
              <option value="radius">半径</option>
            </select>
          </div>

          {draft.radiusMode === 'radius' ? (
            <div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>半径 r (mm)</div>
              <input
                type="number"
                value={Number(draft.radius ?? MM_BASE / 2)}
                onChange={(e) => setField('radius', Number(e.target.value))}
                style={{ width: '100%', padding: 8 }}
              />
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>直径 D (mm)</div>
              <input
                type="number"
                value={Number(draft.diameter ?? MM_BASE)}
                onChange={(e) => setField('diameter', Number(e.target.value))}
                style={{ width: '100%', padding: 8 }}
              />
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>高さ h (mm)</div>
            <input
              type="number"
              value={Number(draft.height ?? MM_BASE)}
              onChange={(e) => setField('height', Number(e.target.value))}
              style={{ width: '100%', padding: 8 }}
            />
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={onPlace} style={{ flex: 1, padding: 10 }}>
          配置
        </button>
        <button onClick={onCancel} style={{ padding: 10 }}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

/** ====== Steel add panel（チャンネル/アングル以外も対応） ====== */
function SteelAddPanel({ catalog, draft, setDraft, onPlace, onCancel, disabled }) {
  if (!draft) return null;

  // draft:
  // {
  //   kind: 'channel'|'angle'|'hbeam'|'pipe'|'roundbar'|'flatbar'|'squarepipe'|'expanded'|'checkered-plate',
  //   name: string,
  //   length: number,
  //   width: number,
  //   height: number
  // }

  const kind = draft.kind ?? 'channel';

  const list =
    kind === 'channel'
      ? catalog?.channels ?? []
      : kind === 'angle'
      ? catalog?.angles ?? []
      : kind === 'hbeam'
      ? catalog?.hBeams ?? []
      : kind === 'pipe'
      ? catalog?.pipes ?? []
      : kind === 'roundbar'
      ? catalog?.roundBars ?? []
      : kind === 'flatbar'
      ? catalog?.flatBars ?? []
      : kind === 'squarepipe'
      ? catalog?.squarePipes ?? []
      : kind === 'expanded'
      ? catalog?.expands ?? []
      : kind === 'checkered-plate'
      ? catalog?.checkeredPlates ?? []
      : [];

  const selected = list.find((x) => x.name === draft.name) ?? list[0] ?? null;

  function setField(key, value) {
    setDraft((p) => ({ ...(p ?? {}), [key]: value }));
  }

  function ensureDefaultNameIfEmpty(nextKind) {
    const nextList =
      nextKind === 'channel'
        ? catalog?.channels ?? []
        : nextKind === 'angle'
        ? catalog?.angles ?? []
        : nextKind === 'hbeam'
        ? catalog?.hBeams ?? []
        : nextKind === 'pipe'
        ? catalog?.pipes ?? []
        : nextKind === 'roundbar'
        ? catalog?.roundBars ?? []
        : nextKind === 'flatbar'
        ? catalog?.flatBars ?? []
        : nextKind === 'squarepipe'
        ? catalog?.squarePipes ?? []
        : nextKind === 'expanded'
        ? catalog?.expands ?? []
        : nextKind === 'checkered-plate'
        ? catalog?.checkeredPlates ?? []
        : [];

    const firstName = nextList?.[0]?.name ?? '';
    setDraft((p) => {
      const hasName = String(p?.name ?? '').trim().length > 0;
      return {
        ...(p ?? {}),
        kind: nextKind,
        name: hasName ? p.name : firstName,
      };
    });
  }

  function buildGeometryForDraft() {
    const L = Number(draft.length ?? 6000);
    const W = Number(draft.width ?? 1200);
    const H = Number(draft.height ?? 600);

    if (!selected) return null;

    if (kind === 'channel') {
      return buildChannelGeometry({
        H: selected.H,
        B: selected.B,
        t1: selected.t1,
        t2: selected.t2,
        r1: selected.r1 ?? 0,
        r2: selected.r2 ?? 0,
        L,
      });
    }
    if (kind === 'angle') {
      return buildAngleGeometry({
        A: selected.A,
        B: selected.B,
        t: selected.t,
        r1: selected.r1 ?? 0,
        r2: selected.r2 ?? 0,
        L,
      });
    }
    if (kind === 'hbeam') {
      return buildHBeamGeometry({
        H: selected.H,
        B: selected.B,
        t1: selected.t1,
        t2: selected.t2,
        r: selected.r ?? 0,
        L,
      });
    }
    if (kind === 'pipe') {
      return buildPipeGeometry({
        D: selected.D,
        t: selected.t,
        L,
      });
    }
    if (kind === 'roundbar') {
      return buildRoundBarGeometry({
        D: selected.D,
        L,
      });
    }
    if (kind === 'flatbar') {
      return buildFlatBarGeometry({
        H: selected.H,
        t: selected.t,
        L,
      });
    }
    if (kind === 'squarepipe') {
      return buildSquarePipeGeometry({
        H: selected.H,
        B: selected.B,
        t: selected.t,
        L,
      });
    }
    if (kind === 'expanded') {
      return buildExpandedMetalGeometry({
        SW: selected.SW ?? selected.sw ?? undefined,
        LW: selected.LW ?? selected.lw ?? undefined,
        T: selected.T ?? selected.t ?? undefined,
        W: selected.W ?? selected.w ?? undefined,
        width: W,
        height: H,
      });
    }
    if (kind === 'checkered-plate') {
      return buildCheckeredPlateGeometry({
        t: selected.t ?? 3.2,
        width: W,
        height: H,
      });
    }

    return null;
  }

  function onClickPlace() {
    const geo = buildGeometryForDraft();
    if (!geo) return;

    const L = Number(draft.length ?? 6000);
    const W = Number(draft.width ?? 1200);
    const Hh = Number(draft.height ?? 600);

    const obj = {
      kind: 'steel',
      type:
        kind === 'channel'
          ? 'steel-channel'
          : kind === 'angle'
          ? 'steel-angle'
          : kind === 'hbeam'
          ? 'steel-hbeam'
          : kind === 'pipe'
          ? 'steel-pipe'
          : kind === 'roundbar'
          ? 'steel-roundbar'
          : kind === 'flatbar'
          ? 'steel-flatbar'
          : kind === 'squarepipe'
          ? 'steel-squarepipe'
          : kind === 'expanded'
          ? 'steel-expanded'
          : kind === 'checkered-plate'
          ? 'steel-checkered'
          : 'steel',

      name: selected?.name ?? draft.name ?? '',

      // ✅ 再編集用に spec と dims を保存（EditorCanvas 側で再生成できる）
      spec: { ...(selected ?? {}) },
      dims:
        kind === 'expanded' || kind === 'checkered-plate'
          ? { width: W, height: Hh, t: selected?.t ?? selected?.T ?? null }
          : { length: L },

      // ✅ 生成済みジオメトリを渡す（EditorCanvas が __geometry 優先で描画する）
      __geometry: geo,
    };

    onPlace(obj);
  }

  const isPlate = kind === 'expanded' || kind === 'checkered-plate';
  const showLength = !isPlate;
  const showWH = isPlate;

  return (
    <div style={{ padding: 12, borderTop: '1px solid #333' }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>鋼材種類</div>
          <select
            value={kind}
            onChange={(e) => ensureDefaultNameIfEmpty(e.target.value)}
            disabled={disabled}
            style={{ width: '100%', padding: 8 }}
          >
            <option value="channel">チャンネル</option>
            <option value="angle">アングル</option>
            <option value="hbeam">H鋼</option>
            <option value="pipe">ガス管</option>
            <option value="roundbar">丸鋼</option>
            <option value="flatbar">FB</option>
            <option value="squarepipe">角パイプ</option>
            <option value="expanded">エキスパンド</option>
            <option value="checkered-plate">縞板</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>規格</div>
          <select
            value={draft.name ?? (selected?.name ?? '')}
            onChange={(e) => setField('name', e.target.value)}
            disabled={disabled || !list?.length}
            style={{ width: '100%', padding: 8 }}
          >
            {(list ?? []).map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
          </select>
          {!list?.length ? (
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>この種類のシートがExcelに無い/空です</div>
          ) : null}
        </div>

        {showLength ? (
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>長さ L (mm)</div>
            <input
              type="number"
              value={Number(draft.length ?? 6000)}
              onChange={(e) => setField('length', Number(e.target.value))}
              disabled={disabled}
              style={{ width: '100%', padding: 8 }}
            />
          </div>
        ) : null}

        {showWH ? (
          <>
            <div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>幅 width (mm)</div>
              <input
                type="number"
                value={Number(draft.width ?? 1200)}
                onChange={(e) => setField('width', Number(e.target.value))}
                disabled={disabled}
                style={{ width: '100%', padding: 8 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>高さ height (mm)</div>
              <input
                type="number"
                value={Number(draft.height ?? 600)}
                onChange={(e) => setField('height', Number(e.target.value))}
                disabled={disabled}
                style={{ width: '100%', padding: 8 }}
              />
            </div>
          </>
        ) : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClickPlace} disabled={disabled || !selected} style={{ flex: 1, padding: 10 }}>
            配置
          </button>
          <button onClick={onCancel} disabled={disabled} style={{ padding: 10 }}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

function InspectorPanel({ obj, onChange, selectedCount = 1, onSetColor }) {
   const [posStr, setPosStr] = useState(['0', '0', '0']);
  const [applyAll, setApplyAll] = useState(true);

  useEffect(() => {
    if (!obj) return;
    const p = obj.position ?? [0, 0, 0];
    setPosStr([String(p[0] ?? 0), String(p[1] ?? 0), String(p[2] ?? 0)]);
  }, [obj?.id, (obj?.position ?? []).join(',')]);

  if (!obj) return null;

  const pos = obj.position ?? [0, 0, 0];

  const tryCommit = (i, s) => {
    if (s === '' || s === '-' || s === '+' || s === '.' || s === '-.' || s === '+.') return;
    const n = Number(s);
    if (Number.isFinite(n)) {
      const p = [...pos];
      p[i] = n;
      onChange?.({ position: p });
    }
  };

  const clampCommitOnBlur = (i) => {
    const s = posStr[i];
    const n = Number(s);
    if (!Number.isFinite(n)) {
      const p = obj.position ?? [0, 0, 0];
      setPosStr((prev) => {
        const next = [...prev];
        next[i] = String(p[i] ?? 0);
        return next;
      });
      return;
    }
    const p = [...pos];
    p[i] = n;
    onChange?.({ position: p });
  };

    return (
     <div className="space-y-2 rounded-lg border p-2">
       <div className="text-xs font-semibold">選択中：{obj.name ?? obj.type}</div>

      {/* ✅ 色（ワンタッチ） */}
      <div>
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-gray-500 mb-1">色 Color</div>
          <label className="flex items-center gap-1 text-[10px] text-gray-600 select-none">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
            />
            選択全体に適用（{selectedCount}）
          </label>
        </div>

        <div className="flex items-center gap-2">
          {/* 現在色プレビュー */}
          <div
            className="h-6 w-10 rounded border"
            style={{ background: obj.color ?? '#bfbfbf' }}
            title={obj.color ?? '#bfbfbf'}
          />

          {/* 直接選択（OSカラーピッカー） */}
          <input
            className="h-8 w-12 rounded border p-1"
            type="color"
            value={obj.color ?? '#bfbfbf'}
            onChange={(e) => onSetColor?.(e.target.value, applyAll)}
            title="カラーピッカー"
          />

          {/* 16進入力（任意） */}
          <input
            className="flex-1 rounded border px-2 py-1 text-xs"
            type="text"
            value={obj.color ?? '#bfbfbf'}
            onChange={(e) => {
              const v = e.target.value.trim();
              // #RGB / #RRGGBB だけ許可（途中入力は許すなら条件ゆるめてもOK）
              if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) return;
              onSetColor?.(v, applyAll);
            }}
            placeholder="#bfbfbf"
          />
        </div>

        {/* ワンタッチパレット */}
        <div className="mt-2 grid grid-cols-6 gap-2">
          {[
            '#bfbfbf', // 標準
            '#808080',
            '#404040',
            '#ffffff',
            '#111827', // ほぼ黒
            '#ef4444', // 赤
            '#f59e0b', // オレンジ
            '#eab308', // 黄
            '#22c55e', // 緑
            '#06b6d4', // シアン
            '#3b82f6', // 青
            '#a855f7', // 紫
          ].map((c) => (
            <button
              key={c}
              type="button"
              className="h-7 w-full rounded border hover:opacity-90"
              style={{ background: c }}
              title={c}
              onClick={() => onSetColor?.(c, applyAll)}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] text-gray-500 mb-1">位置 Position (mm)</div>
        <div className="grid grid-cols-3 gap-2">
          {['X', 'Y', 'Z'].map((label, i) => (
            <div key={label}>
              <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
              <input
                className="w-full rounded border px-2 py-1 text-xs"
                type="text"
                inputMode="decimal"
                value={posStr[i]}
                onChange={(e) => {
                  const s = e.target.value;
                  if (!/^[+\-]?\d*(\.\d*)?$/.test(s)) return;
                  setPosStr((prev) => {
                    const next = [...prev];
                    next[i] = s;
                    return next;
                  });
                  tryCommit(i, s);
                }}
                onBlur={() => clampCommitOnBlur(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {(obj.type === 'cube' || obj.type === 'box' || obj.type === 'fused') && (
        <div>
          <div className="text-[10px] text-gray-500 mb-1">サイズ Size (mm)</div>
          <div className="grid grid-cols-3 gap-2">
            {['W', 'H', 'D'].map((label, i) => (
              <div key={label}>
                <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
                <input
                  className="w-full rounded border px-2 py-1 text-xs"
                  type="number"
                  step="1"
                  value={(obj.size ?? [MM_BASE, MM_BASE, MM_BASE])[i]}
                  onChange={(e) => {
                    const s = [...(obj.size ?? [MM_BASE, MM_BASE, MM_BASE])];
                    s[i] = Math.max(1, Number(e.target.value) || 1);
                    onChange?.({ size: s });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {(obj.type === 'cylinder' || obj.type === 'cone') && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-gray-500 mb-1">半径 r(mm)</div>
            <input
              className="w-full rounded border px-2 py-1 text-xs"
              type="number"
              step="1"
              value={obj.radius ?? MM_BASE / 2}
              onChange={(e) =>
                onChange?.({ radius: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </div>
          <div>
            <div className="text-[10px] text-gray-500 mb-1">高さ h(mm)</div>
            <input
              className="w-full rounded border px-2 py-1 text-xs"
              type="number"
              step="1"
              value={obj.height ?? MM_BASE}
              onChange={(e) =>
                onChange?.({ height: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </div>
        </div>
      )}

      {/* ✅ steel：長さ L (mm) */}
      {obj.type?.startsWith('steel-') &&
      obj.type !== 'steel-expanded' &&
      obj.type !== 'steel-checkered' ? (
        <div>
          <div className="text-[10px] text-gray-500 mb-1">長さ L(mm)</div>
          <input
            className="w-full rounded border px-2 py-1 text-xs"
            type="number"
            step="1"
            value={Number(obj.dims?.length ?? 6000)}
            onChange={(e) => {
              const L = Math.max(1, Number(e.target.value) || 1);
              onChange?.({
                dims: { ...(obj.dims ?? {}), length: L },
              });
            }}
          />
        </div>
      ) : null}

      {/* ✅ steel：板（expanded / checkered） */}
      {obj.type === 'steel-expanded' ||
      obj.type === 'steel-checkered' ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-gray-500 mb-1">幅 W(mm)</div>
            <input
              className="w-full rounded border px-2 py-1 text-xs"
              type="number"
              step="1"
              value={Number(obj.dims?.width ?? 1200)}
              onChange={(e) => {
                const W = Math.max(10, Number(e.target.value) || 10);
                onChange?.({
                  dims: { ...(obj.dims ?? {}), width: W },
                });
              }}
            />
          </div>
          <div>
            <div className="text-[10px] text-gray-500 mb-1">高さ H(mm)</div>
            <input
              className="w-full rounded border px-2 py-1 text-xs"
              type="number"
              step="1"
              value={Number(obj.dims?.height ?? 600)}
              onChange={(e) => {
                const H = Math.max(10, Number(e.target.value) || 10);
                onChange?.({
                  dims: { ...(obj.dims ?? {}), height: H },
                });
              }}
            />
          </div>
        </div>
      ) : null}

    </div>
  );
}

export default function EditorPage() {
  const [currentTool, setCurrentTool] = useState('select');
  const [selectMode, setSelectMode] = useState('body');
const [fileModal, setFileModal] = useState({ open: false, mode: 'save' }); // 'save' | 'open'
const [plateInsertModal, setPlateInsertModal] = useState({ open: false });

  // ✅ 頂点移動：1点目(頂点/中点)の記憶
  const [snapMovePick, setSnapMovePick] = useState(null);

  const [showShadows, setShowShadows] = useState(true);
  const [showGrid, setShowGrid] = useState(true);

  // ===== 2D Sketch / Extrude =====
  const [sketchMode, setSketchMode] = useState(null);
  const [sketchEntities, setSketchEntities] = useState([]);

  const [extrudeMode, setExtrudeMode] = useState(null);
  const [extrudeLen, setExtrudeLen] = useState('1000');

  const AXIS_ACTIVE = 'bg-orange-500 text-white border-orange-600 ring-2 ring-orange-300';
  const AXIS_INACTIVE = 'bg-white hover:bg-gray-50';

  const [objects, setObjects] = useState([]);
  const historyRef = useRef([]);
  const futureRef = useRef([]);

  const [selectedIds, setSelectedIds] = useState([]);
  const [primaryId, setPrimaryId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const containerRef = useRef(null);
  const canvasWrapRef = useRef(null);


  // ====== Splitter Drag ======
  const draggingRef = useRef(false);
  const dragTargetRef = useRef(null); // 'left' | 'right'
  const startXRef = useRef(0);
  const startLeftRef = useRef(DEFAULT_LEFT);
  const startRightRef = useRef(DEFAULT_RIGHT);

  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT);

  const lastLeftOpenRef = useRef(DEFAULT_LEFT);
  const lastRightOpenRef = useRef(DEFAULT_RIGHT);

  const HIT = 10;
  const MIN_CANVAS = 80;

  const leftVisible = leftWidth > 0;
  const rightVisible = rightWidth > 0;

  // ✅ 鋼材カタログ（全種類）
  const [steelCatalog, setSteelCatalog] = useState({
    channels: [],
    angles: [],
    hBeams: [],
    pipes: [],
    roundBars: [],
    flatBars: [],
    squarePipes: [],
    expands: [],
    checkeredPlates: [],
  });
  const [steelLoadError, setSteelLoadError] = useState('');
  const [steelDraft, setSteelDraft] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cat = await fetchSteelCatalog();
        if (!alive) return;
        setSteelCatalog(
          cat ?? {
            channels: [],
            angles: [],
            hBeams: [],
            pipes: [],
            roundBars: [],
            flatBars: [],
            squarePipes: [],
            expands: [],
            checkeredPlates: [],
          }
        );
        setSteelLoadError('');
      } catch (e) {
        if (!alive) return;
        setSteelLoadError(String(e?.message ?? e));
        setSteelCatalog({
          channels: [],
          angles: [],
          hBeams: [],
          pipes: [],
          roundBars: [],
          flatBars: [],
          squarePipes: [],
          expands: [],
          checkeredPlates: [],
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ✅ Canvas領域内のホイールでページ側がスクロール/履歴ジェスチャー等を起こさない
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;

    const onWheel = (e) => {
      e.preventDefault();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);


  // ===== 平行移動（まとめ移動） =====
  const [moveDelta, setMoveDelta] = useState({ x: '0', y: '0', z: '0' });
  const panBaseRef = useRef(new Map());

  const moveDeltaN = useMemo(
    () => ({
      x: numLoose(moveDelta.x, 0),
      y: numLoose(moveDelta.y, 0),
      z: numLoose(moveDelta.z, 0),
    }),
    [moveDelta.x, moveDelta.y, moveDelta.z]
  );

  // ✅ pan入力をリアルタイムで反映
  useEffect(() => {
    if (currentTool !== 'pan') return;
    if (!panBaseRef.current || panBaseRef.current.size === 0) return;
    livePanDelta(moveDeltaN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTool, moveDeltaN.x, moveDeltaN.y, moveDeltaN.z]);

  function livePanDelta(delta) {
    const base = panBaseRef.current;
    if (!base || base.size === 0) return;

    setObjects((prev) =>
      prev.map((o) => {
        if (o.type === 'group') return o;
        if (!base.has(o.id)) return o;
        const b = base.get(o.id);
        return { ...o, position: [b[0] + delta.x, b[1] + delta.y, b[2] + delta.z] };
      })
    );
  }

  // ===== 回転（軸＋角度） =====
  const [rotAxis, setRotAxis] = useState('y');
  const [rotAngleDeg, setRotAngleDeg] = useState('0');
  const rotBaseRef = useRef(new Map());
  const rotAngleDegN = useMemo(() => numLoose(rotAngleDeg, 0), [rotAngleDeg]);

  // ===== 複製：平行 =====
  const [dupMove, setDupMove] = useState({ x: '0', y: '0', z: '0' });
  const dupMoveN = useMemo(
    () => ({
      x: numLoose(dupMove.x, 0),
      y: numLoose(dupMove.y, 0),
      z: numLoose(dupMove.z, 0),
    }),
    [dupMove.x, dupMove.y, dupMove.z]
  );

  // ===== 複製：回転 =====
  const [dupRotAxis, setDupRotAxis] = useState('y');
  const [dupRotDeg, setDupRotDeg] = useState('90');
  const dupRotDegN = useMemo(() => numLoose(dupRotDeg, 0), [dupRotDeg]);

  // ===== 複製：ミラー =====
  const [dupMirrorAxis, setDupMirrorAxis] = useState('x');

  const groupCountRef = useRef(1);
  const fusedCountRef = useRef(1);

  const groups = useMemo(() => objects.filter((o) => o.type === 'group'), [objects]);
  const shapes = useMemo(() => objects.filter((o) => o.type !== 'group'), [objects]);

  const groupById = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);

  const childrenByGroupId = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(g.id, g.children ?? []);
    return m;
  }, [groups]);

  function getGroupChildren(groupId) {
    return childrenByGroupId.get(groupId) ?? [];
  }

  function expandSelectionToShapes(ids) {
    const out = new Set();
    for (const id of ids) {
      const g = groupById.get(id);
      if (g) {
        for (const cid of g.children ?? []) out.add(cid);
      } else {
        out.add(id);
      }
    }
    const final = new Set();
    for (const id of out) {
      const s = shapes.find((x) => x.id === id);
      const pg = s?.parentGroupId;
      if (pg && groupById.get(pg)) {
        for (const cid of getGroupChildren(pg)) final.add(cid);
      } else {
        final.add(id);
      }
    }
    return Array.from(final).filter((id) => shapes.some((s) => s.id === id));
  }

  const [addDraft, setAddDraft] = useState(null);

  function canSetLeft(newLeft) {
    const total = containerRef.current?.clientWidth ?? 1200;
    const canvas = total - newLeft - rightWidth - HIT * 2;
    return canvas >= MIN_CANVAS;
  }
  function canSetRight(newRight) {
    const total = containerRef.current?.clientWidth ?? 1200;
    const canvas = total - leftWidth - newRight - HIT * 2;
    return canvas >= MIN_CANVAS;
  }

  function ensureRightOpen() {
    if (rightWidth > 0) return;
    const back = lastRightOpenRef.current > 0 ? lastRightOpenRef.current : DEFAULT_RIGHT;
    if (canSetRight(back)) setRightWidth(back);
    else setRightWidth(DEFAULT_RIGHT);
  }

  function openAdd(type) {
    setSteelDraft(null);
    ensureRightOpen();

    if (type === 'cube') {
      setAddDraft({ type: 'cube', edge: MM_BASE });
      return;
    }
    if (type === 'box') {
      setAddDraft({ type: 'box', size: [MM_BASE, MM_BASE, MM_BASE] });
      return;
    }
    if (type === 'cylinder') {
      setAddDraft({
        type: 'cylinder',
        radiusMode: 'diameter',
        diameter: MM_BASE,
        radius: MM_BASE / 2,
        height: MM_BASE,
      });
      return;
    }
    if (type === 'cone') {
      setAddDraft({
        type: 'cone',
        radiusMode: 'diameter',
        diameter: MM_BASE,
        radius: MM_BASE / 2,
        height: MM_BASE,
      });
      return;
    }
  }

  function commit(nextObjects) {
    historyRef.current.push(nextObjects);
    futureRef.current = [];
    setObjects(nextObjects);

    const exist = new Set(nextObjects.map((o) => o.id));
    setSelectedIds((prev) => prev.filter((id) => exist.has(id)));
    setPrimaryId((prev) => (prev && exist.has(prev) ? prev : null));
  }

  function undo() {
    if (historyRef.current.length <= 1) return;
    const current = historyRef.current.pop();
    futureRef.current.unshift(current);
    const prev = historyRef.current[historyRef.current.length - 1];
    setObjects(prev);
    const exist = new Set(prev.map((o) => o.id));
    setSelectedIds((ids) => ids.filter((id) => exist.has(id)));
    setPrimaryId((pid) => (pid && exist.has(pid) ? pid : null));
  }

  function redo() {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.shift();
    historyRef.current.push(next);
    setObjects(next);
    const exist = new Set(next.map((o) => o.id));
    setSelectedIds((ids) => ids.filter((id) => exist.has(id)));
    setPrimaryId((pid) => (pid && exist.has(pid) ? pid : null));
  }

   function openFileSave() {
     ensureRightOpen?.();
     setFileModal({ open: true, mode: 'save' });
   }

   function openFileOpen() {
     ensureRightOpen?.();
     setFileModal({ open: true, mode: 'open' });
   }

function openPlateInsert() {
  ensureRightOpen?.();
  setPlateInsertModal({ open: true });
}

   function getCurrentPayloadForSave() {
     const safeObjects = sanitizeObjectsForSave(objects);
     return { objects: safeObjects };
   }

   function applyOpenedPayload(payload) {
     const nextObjects = payload?.objects ?? [];
     // 履歴もリセット（開いた瞬間が初期状態）
     setObjects(nextObjects);
     historyRef.current = [nextObjects];
     futureRef.current = [];

     // 選択は先頭shapeに寄せる（無ければ解除）
     const firstShape = (nextObjects ?? []).find((o) => o.type !== 'group') ?? null;
     if (firstShape?.id) {
       setSelectedIds([firstShape.id]);
       setPrimaryId(firstShape.id);
     } else {
       setSelectedIds([]);
       setPrimaryId(null);
     }
     setCurrentTool('select');
     setSelectMode('body');
   }

  function nextNameForType(type) {
    const count = shapes.filter((o) => o.type === type).length + 1;
    return `${type}${count}`;
  }

  function add(type, data = {}) {
    const id = uid();

    const pivot = data.pivot ?? defaultPivotFor(type, data);
    const position = data.position ?? defaultPositionFor(type, data);

    const next = [
      {
        id,
        type,
        name: nextNameForType(type),
        position,
        pivot,
        rotation: [0, 0, 0],
        color: '#bfbfbf',
        ...data,
      },
      ...objects,
    ];

    commit(next);

    setSelectedIds([id]);
    setPrimaryId(id);
    setCurrentTool('select');
    setSelectMode('body');
  }

  function placeDraft() {
    if (!addDraft?.type) return;

    if (addDraft.type === 'cube') {
      const e = Math.max(1, num(addDraft.edge, MM_BASE));
      add('cube', { size: [e, e, e], position: [0, 0, 0] });
      setAddDraft(null);
      return;
    }

    if (addDraft.type === 'box') {
      const s = addDraft.size ?? [MM_BASE, MM_BASE, MM_BASE];
      const w = Math.max(1, num(s[0], MM_BASE));
      const h = Math.max(1, num(s[1], MM_BASE));
      const d = Math.max(1, num(s[2], MM_BASE));
      add('box', { size: [w, h, d], position: [0, 0, 0] });
      setAddDraft(null);
      return;
    }

    if (addDraft.type === 'cylinder') {
      const mode = addDraft.radiusMode ?? 'diameter';
      const h = Math.max(1, num(addDraft.height, MM_BASE));
      const r = mode === 'radius' ? Math.max(1, num(addDraft.radius, MM_BASE / 2)) : Math.max(1, num(addDraft.diameter, MM_BASE) / 2);
      add('cylinder', { radius: r, height: h, position: [0, 0, 0] });
      setAddDraft(null);
      return;
    }

    if (addDraft.type === 'cone') {
      const mode = addDraft.radiusMode ?? 'diameter';
      const h = Math.max(1, num(addDraft.height, MM_BASE));
      const r = mode === 'radius' ? Math.max(1, num(addDraft.radius, MM_BASE / 2)) : Math.max(1, num(addDraft.diameter, MM_BASE) / 2);
      add('cone', { radius: r, height: h, position: [0, 0, 0] });
      setAddDraft(null);
      return;
    }
  }

  // ✅ 新：SteelAddPanel（全種類）を開く
  function openSteel() {
    setAddDraft(null);
    ensureRightOpen();

    const first = steelCatalog.channels?.[0] ?? null;
    setSteelDraft({ kind: 'channel', name: first?.name ?? '', length: 6000, width: 1200, height: 600 });
  }

  // ✅ 新：SteelAddPanel から obj を受け取って add する（チャンネル/アングル以外もOK）
  function placeSteelObj(objFromPanel) {
    if (!objFromPanel) return;

    const type = objFromPanel.type;
    const spec = objFromPanel.spec ?? {};
    const dims = objFromPanel.dims ?? {};
    const col = objFromPanel.color ?? '#bfbfbf';

    // 外形箱サイズは “表示/ピボットのため” に入れておく（EditorCanvas は __geometry を優先で描画）
    let size = [MM_BASE, MM_BASE, MM_BASE];

    if (type === 'steel-channel') {
      const L = Math.max(1, num(dims.length, num(spec.length, 6000)));
      size = [L, Math.max(1, num(spec.H, 100)), Math.max(1, num(spec.B, 50))];
    } else if (type === 'steel-angle') {
      const L = Math.max(1, num(dims.length, num(spec.length, 6000)));
      size = [L, Math.max(1, num(spec.A, 50)), Math.max(1, num(spec.B, 50))];
    } else if (type === 'steel-hbeam') {
      const L = Math.max(1, num(dims.length, num(spec.length, 6000)));
      size = [L, Math.max(1, num(spec.H, 200)), Math.max(1, num(spec.B, 100))];
    } else if (type === 'steel-pipe') {
      const L = Math.max(1, num(dims.length, num(spec.length, 6000)));
      const D = Math.max(1, num(spec.D, 100));
      size = [D, L, D];
    } else if (type === 'steel-roundbar') {
      const L = Math.max(1, num(dims.length, num(spec.length, 6000)));
      const D = Math.max(1, num(spec.D, 50));
      size = [D, L, D];
    } else if (type === 'steel-flatbar') {
      const L = Math.max(1, num(dims.length, num(spec.length, 6000)));
      const H = Math.max(1, num(spec.H, 50));
      const t = Math.max(1, num(spec.t, 6));
      size = [L, H, t];
    } else if (type === 'steel-squarepipe') {
      const L = Math.max(1, num(dims.length, num(spec.length, 6000)));
      const H = Math.max(1, num(spec.H, 75));
      const B = Math.max(1, num(spec.B, 75));
      size = [L, H, B];
    } else if (type === 'steel-expanded' || type === 'steel-checkered') {
      const w = Math.max(10, num(dims.width, 1200));
      const h = Math.max(10, num(dims.height, 600));
      const t = Math.max(1, num(dims.t ?? spec.t ?? spec.T, 3));
      size = [w, t, h];
    }

    add(type, {
      name: objFromPanel.name ?? type,
      spec,
      dims,
      __geometry: objFromPanel.__geometry,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      color: col,
      size,
      pivot: defaultPivotFor(type, { size }),
    });

    setSteelDraft(null);
  }

  useEffect(() => {
    if (historyRef.current.length > 0) return;

    try {
      const lw = Number(localStorage.getItem(LS_LEFT));
      const rw = Number(localStorage.getItem(LS_RIGHT));
      if (Number.isFinite(lw)) {
        setLeftWidth(lw);
        if (lw > 0) lastLeftOpenRef.current = lw;
      }
      if (Number.isFinite(rw)) {
        setRightWidth(rw);
        if (rw > 0) lastRightOpenRef.current = rw;
      }
    } catch {}

    const firstId = uid();
    const initH = MM_BASE;
    const initSize = [MM_BASE * 2, initH, MM_BASE];
    const init = [
      {
        id: firstId,
        type: 'box',
        name: 'box1',
        size: initSize,
        position: [0, 0, 0],
        pivot: defaultPivotFor('box', { size: initSize }),
        rotation: [0, 0, 0],
        color: '#bfbfbf',
      },
    ];

    setObjects(init);
    historyRef.current = [init];

    setSelectedIds([firstId]);
    setPrimaryId(firstId);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_LEFT, String(leftWidth));
      localStorage.setItem(LS_RIGHT, String(rightWidth));
    } catch {}
  }, [leftWidth, rightWidth]);

  function selectSingle(id) {
    if (!id) {
      setSelectedIds([]);
      setPrimaryId(null);
      return;
    }
    const s = shapes.find((x) => x.id === id);
    const pg = s?.parentGroupId;
    if (pg && groupById.get(pg)) {
      const kids = getGroupChildren(pg);
      setSelectedIds(kids);
      setPrimaryId(id);
      return;
    }

    const g = groupById.get(id);
    if (g) {
      const kids = g.children ?? [];
      setSelectedIds(kids);
      setPrimaryId(kids[0] ?? null);
      return;
    }

    setSelectedIds([id]);
    setPrimaryId(id);
  }

  function toggleSelect(id) {
    if (!id) return;

    const g = groupById.get(id);
    if (g) {
      const kids = g.children ?? [];
      setSelectedIds((prev) => {
        const s = new Set(prev);
        const anySelected = kids.some((k) => s.has(k));
        if (anySelected) kids.forEach((k) => s.delete(k));
        else kids.forEach((k) => s.add(k));
        return Array.from(s);
      });
      setPrimaryId((prev) => prev ?? kids[0] ?? null);
      return;
    }

    const shape = shapes.find((x) => x.id === id);
    const pg = shape?.parentGroupId;
    if (pg && groupById.get(pg)) {
      const kids = getGroupChildren(pg);
      setSelectedIds((prev) => {
        const s = new Set(prev);
        const anySelected = kids.some((k) => s.has(k));
        if (anySelected) kids.forEach((k) => s.delete(k));
        else kids.forEach((k) => s.add(k));
        return Array.from(s);
      });
      setPrimaryId(id);
      return;
    }

    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return Array.from(s);
    });
    setPrimaryId(id);
  }

  function handleSelectFromCanvas(id, evt) {
    if (!id) return selectSingle(null);
    const shift = !!(evt?.shiftKey || evt?.nativeEvent?.shiftKey);
    if (shift) toggleSelect(id);
    else selectSingle(id);
  }

  function handleSelectFromTree(id, evt) {
    const shift = !!evt?.shiftKey;
    if (shift) toggleSelect(id);
    else selectSingle(id);
  }

  const primaryObject = useMemo(() => shapes.find((o) => o.id === primaryId) ?? null, [shapes, primaryId]);

  function updateObject(id, patch) {
    const next = objects.map((o) => (o.id === id ? { ...o, ...patch } : o));
    commit(next);
  }

    function updatePrimary(patch) {
     if (!primaryId) return;
     updateObject(primaryId, patch);
   }

  function applyColorToObject(o, color) {
    if (o.type === 'fused') {
      return {
        ...o,
        color,
        sources: Array.isArray(o.sources) ? o.sources.map((s) => ({ ...s, color })) : o.sources,
      };
    }
    return { ...o, color };
  }

  function setColorForSelection(color, applyAll) {
    if (!primaryId) return;
    const ids = applyAll ? expandedShapeSelection : [primaryId];
    const set = new Set(ids);
    const next = objects.map((o) => (set.has(o.id) ? applyColorToObject(o, color) : o));
    commit(next);
  }

  function livePatchObject(id, patch) {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  function setPivotForPrimary(newPivotLocal) {
    if (!primaryObject) return;
    const oldPivot = primaryObject.pivot ?? [0, 0, 0];
    const pos = primaryObject.position ?? [0, 0, 0];

    const dx = newPivotLocal[0] - oldPivot[0];
    const dy = newPivotLocal[1] - oldPivot[1];
    const dz = newPivotLocal[2] - oldPivot[2];

    updatePrimary({
      pivot: [newPivotLocal[0], newPivotLocal[1], newPivotLocal[2]],
      position: [pos[0] + dx, pos[1] + dy, pos[2] + dz],
    });
  }

  function deleteSelected() {
    if (selectedIds.length === 0) return;

    const shapeIds = expandSelectionToShapes(selectedIds);
    const groupIds = selectedIds.filter((id) => groupById.get(id));
    const delSet = new Set([...shapeIds]);

    const next = objects
      .map((o) => {
        if (o.type === 'group') {
          const kids = (o.children ?? []).filter((cid) => !delSet.has(cid));
          return { ...o, children: kids };
        }
        return o;
      })
      .filter((o) => {
        if (delSet.has(o.id)) return false;
        if (groupIds.includes(o.id)) return false;
        if (o.type === 'group' && (o.children ?? []).length === 0) return false;
        return true;
      });

    const groupExists = (id) => next.some((x) => x.type === 'group' && x.id === id);

    const fixed = next.map((o) => {
      if (o.type !== 'group' && o.parentGroupId && !groupExists(o.parentGroupId)) {
        const { parentGroupId, ...rest } = o;
        return rest;
      }
      return o;
    });

    commit(fixed);
    setSelectedIds([]);
    setPrimaryId(null);
  }

  function renameObject(id) {
    const obj = objects.find((o) => o.id === id);
    if (!obj) return;
    const current = obj.name ?? '';
    const next = window.prompt('名前を入力してください', current);
    if (next == null) return;
    const trimmed = String(next).trim();
    if (!trimmed) return;
    updateObject(id, { name: trimmed });
  }

  function groupSelected() {
    const shapeIds = expandSelectionToShapes(selectedIds);
    if (shapeIds.length < 2) return;

    const gid = uid();
    const gname = `group${groupCountRef.current++}`;

    const next = objects.map((o) => {
      if (o.type === 'group') {
        const kids = (o.children ?? []).filter((cid) => !shapeIds.includes(cid));
        return { ...o, children: kids };
      }
      if (o.type !== 'group' && shapeIds.includes(o.id)) {
        return { ...o, parentGroupId: gid };
      }
      return o;
    });

    const withNewGroup = [
      { id: gid, type: 'group', name: gname, children: shapeIds },
      ...next.filter((o) => !(o.type === 'group' && (o.children ?? []).length === 0)),
    ];

    commit(withNewGroup);
    setSelectedIds(shapeIds);
    setPrimaryId(shapeIds[0] ?? null);
  }

  function ungroupSelected() {
    const gids = new Set();

    for (const id of selectedIds) {
      const g = groupById.get(id);
      if (g) gids.add(g.id);
      const s = shapes.find((x) => x.id === id);
      if (s?.parentGroupId && groupById.get(s.parentGroupId)) gids.add(s.parentGroupId);
    }

    if (gids.size === 0) return;

    const gidList = Array.from(gids);

    const allKids = [];
    for (const gid of gidList) allKids.push(...getGroupChildren(gid));

    const next = objects
      .filter((o) => !(o.type === 'group' && gidList.includes(o.id)))
      .map((o) => {
        if (o.type !== 'group' && gidList.includes(o.parentGroupId)) {
          const { parentGroupId, ...rest } = o;
          return rest;
        }
        return o;
      });

    commit(next);
    setSelectedIds(allKids.filter((id) => next.some((o) => o.id === id)));
    setPrimaryId(allKids[0] ?? null);
  }

  function fuseSelected() {
    const shapeIds = expandSelectionToShapes(selectedIds);
    if (shapeIds.length < 2) return;

    const srcShapes = shapes.filter((s) => shapeIds.includes(s.id));
    if (srcShapes.length < 2) return;

    const base = shapes.find((s) => s.id === primaryId) ?? srcShapes[0];
    if (!base) return;

    const fusedId = uid();
    const fusedName = `fused${fusedCountRef.current++}`;
    const color = base.color ?? '#bfbfbf';

    const fusedPos = base.position ?? [0, 0, 0];
    const fusedRot = base.rotation ?? [0, 0, 0];
    const fusedPivot = base.pivot ?? [0, 0, 0];

    const fusedObj = {
      id: fusedId,
      type: 'fused',
      name: fusedName,
      position: [fusedPos[0], fusedPos[1], fusedPos[2]],
      rotation: [fusedRot[0] ?? 0, fusedRot[1] ?? 0, fusedRot[2] ?? 0],
      pivot: [fusedPivot[0], fusedPivot[1], fusedPivot[2]],
      color,
      size: base.size ?? [MM_BASE, MM_BASE, MM_BASE],
      sources: [],
    };

    const qF = new THREE.Quaternion().setFromEuler(new THREE.Euler(fusedRot[0] ?? 0, fusedRot[1] ?? 0, fusedRot[2] ?? 0));
    const qFInv = qF.clone().invert();

    const vFPos = new THREE.Vector3(fusedPos[0] ?? 0, fusedPos[1] ?? 0, fusedPos[2] ?? 0);
    const fusedMeshOffset = new THREE.Vector3(-(fusedPivot[0] ?? 0), -(fusedPivot[1] ?? 0), -(fusedPivot[2] ?? 0));

    const sources = srcShapes.map((s) => {
      const p = s.position ?? [0, 0, 0];
      const r = s.rotation ?? [0, 0, 0];
      const pv = s.pivot ?? [0, 0, 0];

      const vSPos = new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      const qS = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0));

      const qRel = qFInv.clone().multiply(qS);

      const srcMeshOffset = new THREE.Vector3(-(pv[0] ?? 0), -(pv[1] ?? 0), -(pv[2] ?? 0));

      const localPos = vSPos
        .clone()
        .sub(vFPos)
        .applyQuaternion(qFInv)
        .add(srcMeshOffset.clone().applyQuaternion(qRel))
        .sub(fusedMeshOffset)
        .sub(srcMeshOffset);

      const eRel = new THREE.Euler().setFromQuaternion(qRel, 'XYZ');

      return {
        id: s.id,
        type: s.type,
        size: s.size,
        radius: s.radius,
        height: s.height,
        steel: s.steel,
        spec: s.spec,
        dims: s.dims,
        __geometry: s.__geometry,
        color: s.color,
        pivot: s.pivot,
        localPosition: [localPos.x, localPos.y, localPos.z],
        localRotation: [eRel.x, eRel.y, eRel.z],
      };
    });

    fusedObj.sources = sources;

    const delSet = new Set(shapeIds);

    const tmp = objects
      .map((o) => {
        if (o.type === 'group') {
          const kids = (o.children ?? []).filter((cid) => !delSet.has(cid));
          return { ...o, children: kids };
        }
        return o;
      })
      .filter((o) => {
        if (delSet.has(o.id)) return false;
        if (o.type === 'group' && (o.children ?? []).length === 0) return false;
        return true;
      });

    const groupExists = (gid) => tmp.some((x) => x.type === 'group' && x.id === gid);

    const next = tmp.map((o) => {
      if (o.type !== 'group' && o.parentGroupId && !groupExists(o.parentGroupId)) {
        const { parentGroupId, ...rest } = o;
        return rest;
      }
      return o;
    });

    commit([fusedObj, ...next]);

    setSelectedIds([fusedId]);
    setPrimaryId(fusedId);
    setCurrentTool('select');
    setSelectMode('body');
  }

  function rebuildPanBase() {
    const m = new Map();
    const shapeIds = expandSelectionToShapes(selectedIds);
    for (const o of shapes) {
      if (shapeIds.includes(o.id)) {
        const p = o.position ?? [0, 0, 0];
        m.set(o.id, [p[0], p[1], p[2]]);
      }
    }
    panBaseRef.current = m;
  }

  function commitPanDelta(delta) {
    const base = panBaseRef.current;
    if (!base || base.size === 0) return;

    const next = objects.map((o) => {
      if (o.type === 'group') return o;
      if (!base.has(o.id)) return o;
      const b = base.get(o.id);
      return { ...o, position: [b[0] + delta.x, b[1] + delta.y, b[2] + delta.z] };
    });
    commit(next);

    setMoveDelta({ x: '0', y: '0', z: '0' });
  }

  useEffect(() => {
    if (currentTool !== 'pan') return;
    rebuildPanBase();
    setMoveDelta({ x: '0', y: '0', z: '0' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTool, selectedIds.join('|')]);

  function rebuildRotBase() {
    const m = new Map();
    const shapeIds = expandSelectionToShapes(selectedIds);
    for (const o of shapes) {
      if (shapeIds.includes(o.id)) {
        const r = o.rotation ?? [0, 0, 0];
        m.set(o.id, [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0]);
      }
    }
    rotBaseRef.current = m;
  }

  function commitRotate(angleDeg) {
    const base = rotBaseRef.current;
    if (!base || base.size === 0) return;

    const a = degToRad(angleDeg);
    const axis = rotAxis;

    const next = objects.map((o) => {
      if (o.type === 'group') return o;
      if (!base.has(o.id)) return o;
      const b = base.get(o.id);
      const r = [b[0], b[1], b[2]];
      if (axis === 'x') r[0] = b[0] + a;
      if (axis === 'y') r[1] = b[1] + a;
      if (axis === 'z') r[2] = b[2] + a;
      return { ...o, rotation: r };
    });

    commit(next);
    setRotAngleDeg('0');
  }

  function quickRotate(deg) {
    if (selectedIds.length === 0) return;
    setRotAngleDeg('0');
    rebuildRotBase();
    commitRotate(deg);
  }

  useEffect(() => {
    if (currentTool !== 'rotate') return;
    rebuildRotBase();
    setRotAngleDeg('0');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTool, selectedIds.join('|')]);

  function makeCopyName(baseName, index) {
    const n = baseName?.trim() ? baseName.trim() : 'object';
    return `${n}_copy${index}`;
  }

  function cloneObject(o, patch = {}, copyIndex = 1) {
  // ✅ structuredClone は BufferGeometry 等で落ちるので使わない
  const base = { ...o };

  // ✅ 複製時はジオメトリを状態に持ち回さない（再生成できるので不要）
  delete base.__geometry;

  // fused の中にも __geometry が潜むので消す
  if (base.type === 'fused' && Array.isArray(base.sources)) {
    base.sources = base.sources.map((s) => {
      const ss = { ...s };
      delete ss.__geometry;
      return ss;
    });
  }

  return {
    ...base,
    id: uid(),
    name: makeCopyName(o.name ?? o.type, copyIndex),
    ...patch,
  };
}


  function duplicateTranslate(dx, dy, dz) {
    const shapeIds = expandSelectionToShapes(selectedIds);
    if (shapeIds.length === 0) return;

    const src = shapes.filter((o) => shapeIds.includes(o.id));
    const copies = src.map((o, i) => {
      const p = o.position ?? [0, 0, 0];
      return cloneObject(o, { position: [p[0] + dx, p[1] + dy, p[2] + dz], parentGroupId: undefined }, i + 1);
    });

    const next = [...copies, ...objects];
    commit(next);

    setSelectedIds(copies.map((o) => o.id));
    setPrimaryId(copies[0]?.id ?? null);
  }

  function duplicateRotate(axis, deg) {
    const shapeIds = expandSelectionToShapes(selectedIds);
    if (shapeIds.length === 0) return;

    const a = degToRad(deg);

    const src = shapes.filter((o) => shapeIds.includes(o.id));
    const copies = src.map((o, i) => {
      const r = o.rotation ?? [0, 0, 0];
      const nr = [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0];
      if (axis === 'x') nr[0] += a;
      if (axis === 'y') nr[1] += a;
      if (axis === 'z') nr[2] += a;

      return cloneObject(o, { rotation: nr, parentGroupId: undefined }, i + 1);
    });

    const next = [...copies, ...objects];
    commit(next);

    setSelectedIds(copies.map((o) => o.id));
    setPrimaryId(copies[0]?.id ?? null);
  }

  function duplicateMirror(axis) {
    const shapeIds = expandSelectionToShapes(selectedIds);
    if (shapeIds.length === 0) return;

    const src = shapes.filter((o) => shapeIds.includes(o.id));
    const copies = src.map((o, i) => {
      const p = o.position ?? [0, 0, 0];
      const pv = o.pivot ?? [0, 0, 0];
      const r = o.rotation ?? [0, 0, 0];

      const np = [p[0], p[1], p[2]];
      const npv = [pv[0], pv[1], pv[2]];
      const nr = [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0];

      if (axis === 'x') {
        np[0] = -p[0];
        npv[0] = -pv[0];
        nr[1] = -nr[1];
        nr[2] = -nr[2];
      }
      if (axis === 'y') {
        np[1] = -p[1];
        npv[1] = -pv[1];
        nr[0] = -nr[0];
        nr[2] = -nr[2];
      }
      if (axis === 'z') {
        np[2] = -p[2];
        npv[2] = -pv[2];
        nr[0] = -nr[0];
        nr[1] = -nr[1];
      }

      return cloneObject(o, { position: np, pivot: npv, rotation: nr, parentGroupId: undefined }, i + 1);
    });

    const next = [...copies, ...objects];
    commit(next);

    setSelectedIds(copies.map((o) => o.id));
    setPrimaryId(copies[0]?.id ?? null);
  }

  useEffect(() => {
    const isTyping = (el) => {
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    };

    const onKey = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Delete') {
        if (isTyping(document.activeElement)) return;
        e.preventDefault();
        deleteSelected();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, objects]);

  // ===== Splitter Drag start =====
  function startDrag(which, e) {
    e.preventDefault();
    e.stopPropagation?.();

    draggingRef.current = true;
    dragTargetRef.current = which;
    startXRef.current = e.clientX;
    startLeftRef.current = leftWidth;
    startRightRef.current = rightWidth;

    e.currentTarget.setPointerCapture?.(e.pointerId);

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  function endDrag(e) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    dragTargetRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    e?.currentTarget?.releasePointerCapture?.(e.pointerId);
  }

  function toggleCollapseLeft() {
    if (leftWidth <= 0) {
      const back = lastLeftOpenRef.current > 0 ? lastLeftOpenRef.current : DEFAULT_LEFT;
      if (canSetLeft(back)) setLeftWidth(back);
      else setLeftWidth(0);
    } else {
      lastLeftOpenRef.current = leftWidth;
      setLeftWidth(0);
    }
  }
  function toggleCollapseRight() {
    if (rightWidth <= 0) {
      const back = lastRightOpenRef.current > 0 ? lastRightOpenRef.current : DEFAULT_RIGHT;
      if (canSetRight(back)) setRightWidth(back);
      else setRightWidth(0);
    } else {
      lastRightOpenRef.current = rightWidth;
      setRightWidth(0);
    }
  }

  function resetLayout() {
    setLeftWidth(DEFAULT_LEFT);
    setRightWidth(DEFAULT_RIGHT);
    lastLeftOpenRef.current = DEFAULT_LEFT;
    lastRightOpenRef.current = DEFAULT_RIGHT;
  }

  const ResizeArrows = (
    <svg width="44" height="12" viewBox="0 0 44 12" aria-hidden="true">
      <path d="M12 6H32" stroke="black" strokeWidth="1" />
      <path d="M12 6L17 1" stroke="black" strokeWidth="1" />
      <path d="M12 6L17 11" stroke="black" strokeWidth="1" />
      <path d="M32 6L27 1" stroke="black" strokeWidth="1" />
      <path d="M32 6L27 11" stroke="black" strokeWidth="1" />
    </svg>
  );

  function Splitter({ which, onDoubleClick }) {
    const hidden = (which === 'left' && leftWidth <= 0) || (which === 'right' && rightWidth <= 0);

    return (
      <div
        className={`relative select-none flex-shrink-0 z-20 ${hidden ? 'opacity-60' : ''}`}
        style={{ width: HIT }}
        title="ドラッグでサイズ変更 / ダブルクリックで折りたたみ"
        onPointerDown={(e) => startDrag(which, e)}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          const dx = e.clientX - startXRef.current;

          if (dragTargetRef.current === 'left') {
            const nextLeft = Math.max(0, startLeftRef.current + dx);
            if (canSetLeft(nextLeft)) {
              setLeftWidth(nextLeft);
              if (nextLeft > 0) lastLeftOpenRef.current = nextLeft;
            }
          }

          if (dragTargetRef.current === 'right') {
            const nextRight = Math.max(0, startRightRef.current - dx);
            if (canSetRight(nextRight)) {
              setRightWidth(nextRight);
              if (nextRight > 0) lastRightOpenRef.current = nextRight;
            }
          }
        }}
        onPointerUp={(e) => endDrag(e)}
        onPointerCancel={(e) => endDrag(e)}
        onDoubleClick={(e) => {
          e.preventDefault();
          onDoubleClick?.();
        }}
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gray-300" />
        <div className="group absolute inset-0 cursor-col-resize">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-white/80 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {ResizeArrows}
          </div>
        </div>
      </div>
    );
  }

  const QuickBtn = ({ deg }) => (
    <button
      className={`rounded border px-2 py-1 text-xs hover:bg-gray-50 ${selectedIds.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
      onClick={() => {
        if (selectedIds.length === 0) return;
        quickRotate(deg);
      }}
      title={`${deg > 0 ? '+' : ''}${deg}° を確定回転`}
      type="button"
    >
      {deg > 0 ? `+${deg}°` : `${deg}°`}
    </button>
  );

  const expandedShapeSelection = useMemo(() => expandSelectionToShapes(selectedIds), [selectedIds.join('|'), objects]);
  const canGroup = expandedShapeSelection.length >= 2;
  const canFuse = expandedShapeSelection.length >= 2;
  const canUngroup = useMemo(() => {
    for (const id of selectedIds) {
      if (groupById.get(id)) return true;
      const s = shapes.find((x) => x.id === id);
      if (s?.parentGroupId && groupById.get(s.parentGroupId)) return true;
    }
    return false;
  }, [selectedIds.join('|'), shapes, groups, groupById]);

  function startSketch2D() {
    setSketchMode({ type: 'sketch2d', step: 'pickFace', objId: null, frame: null, tool: 'line' });
    setSketchEntities([]);
    ensureRightOpen();
    setCurrentTool('sketch2d');
  }

  function exitSketch2D() {
    setSketchMode(null);
    setCurrentTool('select');
  }

  function deleteLastSketchEntity() {
    setSketchEntities((prev) => prev.slice(0, Math.max(0, prev.length - 1)));
  }

  // ✅ Extrude：直前Sketchのframeを流用
  function startExtrude() {
    ensureRightOpen();

    const canReuseFrame = !!sketchMode?.frame && (sketchEntities ?? []).length >= 3;

    if (canReuseFrame) {
      const loops = detectClosedLoops(sketchEntities ?? []);
      const first = loops[0] ?? null;
      setExtrudeMode({
        step: 'pickRegion',
        objId: sketchMode?.objId ?? null,
        frame: sketchMode.frame,
        loops,
        selectedLoopId: first?.id ?? null,
        selectedLoop: first ?? null,
      });
      setExtrudeLen('1000');
      setCurrentTool('extrude');
      return;
    }

    setExtrudeMode({ step: 'pickFace', objId: null, frame: null, loops: [], selectedLoopId: null, selectedLoop: null });
    setExtrudeLen('1000');
    setCurrentTool('extrude');
  }

  function exitExtrude() {
    setExtrudeMode(null);
    setCurrentTool('select');
  }

   return (
     <div className="h-screen flex flex-col min-h-0">
      <FileManagerModal
        open={fileModal.open}
        mode={fileModal.mode}
        onClose={() => setFileModal((p) => ({ ...p, open: false }))}
        getCurrentPayload={getCurrentPayloadForSave}
        onOpenPayload={applyOpenedPayload}
      />

<PlateInsertModal
  open={plateInsertModal.open}
  onClose={() => setPlateInsertModal({ open: false })}
  // PlateInsertModal の onPickPlate を差し替え
onPickPlate={(payload, options) => {
  const plate = payload?.plate ?? payload ?? null;
  const profile = plate?.profile ?? payload?.profile ?? null;
  const pts = profile?.points ?? [];

  if (!pts.length) {
    alert('この切板データに輪郭(profile)が見つかりません。');
    return;
  }

  // 厚み：データにあれば拾う。無ければ 12mm デフォ
  const t = Number(plate?.t ?? plate?.thickness ?? profile?.t ?? 12) || 12;

  // points -> Shape
  const norm = pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
  if (norm.length < 3) {
    alert('切板の輪郭点が不足しています。');
    return;
  }

  const first = norm[0];
  const last = norm[norm.length - 1];
  const isClosed =
    !!profile?.closed || (first.x === last.x && first.y === last.y);

  const shape = new THREE.Shape();
  shape.moveTo(first.x, first.y);
  for (let i = 1; i < norm.length; i++) shape.lineTo(norm[i].x, norm[i].y);
  if (!isClosed) shape.lineTo(first.x, first.y);

  // Shape -> ExtrudeGeometry（厚み）
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.1, t),
    bevelEnabled: false,
    steps: 1,
    curveSegments: 16,
  });

  // profile が XY で来る前提：
  // Extrude は +Z 方向に厚みが出るので、厚みを Y にしたいなら回す
  geo.rotateX(-Math.PI / 2);

  geo.computeBoundingBox();
  geo.computeVertexNormals();

  // bbox から size/pivot を作る（鋼材追加と同じ “外形箱” 用）
  const bb = geo.boundingBox;
  const sx = Math.max(1, (bb?.max.x ?? 0) - (bb?.min.x ?? 0));
  const sy = Math.max(1, (bb?.max.y ?? 0) - (bb?.min.y ?? 0));
  const sz = Math.max(1, (bb?.max.z ?? 0) - (bb?.min.z ?? 0));

  // 「0,0に即配置」＝ 左下角が原点に来るように pivot を min 側に寄せる
  const pivot = [-(bb?.min.x ?? 0), -(bb?.min.y ?? 0), -(bb?.min.z ?? 0)];

  add('plate', {
    name: plate?.name ?? 'plate',
    __geometry: geo,          // ✅ EditorCanvas が最優先で描く
    size: [sx, sy, sz],       // ✅ pivot/UI 用（inspectorなど）
    pivot,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    color: '#bfbfbf',

    // 保存/再生成用に生データも持っておく（任意）
    profile: { points: norm, closed: !!profile?.closed },
    dims: { t },
  });

  setPlateInsertModal({ open: false });
}}
/>     
 <div className="shrink-0 sticky top-0 z-40 bg-white border-b">
        <EditorToolbar
          currentTool={currentTool}
          setTool={(t) => {
            setCurrentTool(t);
    if (t === 'vertex-move') setSelectMode('vertex');
    if (t !== 'vertex-move' && selectMode === 'vertex') setSelectMode('body');
            if (t !== 'sketch2d' && sketchMode) setSketchMode(null);
            if (t !== 'extrude' && extrudeMode) setExtrudeMode(null);
            if (t !== 'vertex-move') setSnapMovePick(null);

          }}
	 onFileSave={openFileSave}
         onFileOpen={openFileOpen}
          selectMode={selectMode}
          setSelectMode={setSelectMode}
          onAddCube={() => openAdd('cube')}
          onAddBox={() => openAdd('box')}
          onAddCylinder={() => openAdd('cylinder')}
          onAddCone={() => openAdd('cone')}
          onOpenSteelPanel={openSteel}
          onDeleteSelected={deleteSelected}
          canDelete={selectedIds.length > 0}
          onResetLayout={resetLayout}
          leftVisible={leftVisible}
          rightVisible={rightVisible}
          onToggleLeft={toggleCollapseLeft}
          onToggleRight={toggleCollapseRight}
          onGroupSelected={groupSelected}
          onUngroupSelected={ungroupSelected}
          onFuseSelected={fuseSelected}
          canGroup={canGroup}
          canUngroup={canUngroup}
          canFuse={canFuse}
          showShadows={showShadows}
          showGrid={showGrid}
          onToggleShadows={() => setShowShadows((v) => !v)}
          onToggleGrid={() => setShowGrid((v) => !v)}
          onStartSketch2D={startSketch2D}
          onStartExtrude={startExtrude}
	  onOpenPlateInsert={openPlateInsert}
        />
      </div>

      <div ref={containerRef} className="flex-1 flex min-h-0">
        {/* 左：構成ツリー */}
        <aside
          className="border-r bg-white flex flex-col min-h-0 overflow-hidden"
          style={{ width: leftWidth, display: leftWidth > 0 ? 'flex' : 'none' }}
        >
          <div className="border-b px-3 py-2 text-sm font-semibold truncate">構成ツリー</div>

          <div className="flex-1 overflow-auto p-2 space-y-2 text-xs">
            {groups.map((g, gi) => {
              const kids = g.children ?? [];
              const anySelected = kids.some((k) => selectedIds.includes(k));
              const label = g.name?.trim() ? g.name : `group${gi + 1}`;

              return (
                <div key={g.id} className={`rounded-lg border ${anySelected ? 'bg-gray-50 border-gray-400' : ''}`}>
                  <button
                    className="w-full text-left px-2 py-2 hover:bg-gray-50"
                    onClick={(e) => handleSelectFromTree(g.id, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      renameObject(g.id);
                    }}
                    title="右クリックで名前変更 / クリックでグループ選択"
                    type="button"
                  >
                    <div className="font-semibold truncate">📦 {label}</div>
                    <div className="text-gray-500 truncate">group ({kids.length})</div>
                  </button>

                  <div className="px-2 pb-2 space-y-1">
                    {kids.map((cid) => {
                      const s = shapes.find((x) => x.id === cid);
                      if (!s) return null;
                      const active = selectedIds.includes(s.id);
                      const primary = s.id === primaryId;
                      const nm = s.name?.trim() ? s.name : s.type;
                      return (
                        <button
                          key={s.id}
                          className={`w-full text-left rounded border px-2 py-1 overflow-hidden ${
                            active ? 'bg-gray-100 border-gray-400' : 'hover:bg-gray-50'
                          } ${primary ? 'ring-2 ring-gray-400' : ''}`}
                          onClick={(e) => handleSelectFromTree(s.id, e)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            renameObject(s.id);
                          }}
                          title="右クリックで名前変更 / クリックするとグループ全体が選択されます"
                          type="button"
                        >
                          <div className="truncate">- {nm}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {shapes
              .filter((s) => !s.parentGroupId)
              .map((o, i) => {
                const active = selectedIds.includes(o.id);
                const primary = o.id === primaryId;
                const label = o.name?.trim() ? o.name : o.type;

                return (
                  <button
                    key={o.id}
                    className={`w-full text-left rounded-lg border px-2 py-2 overflow-hidden ${
                      active ? 'bg-gray-100 border-gray-400' : 'hover:bg-gray-50'
                    } ${primary ? 'ring-2 ring-gray-400' : ''}`}
                    onClick={(e) => handleSelectFromTree(o.id, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      renameObject(o.id);
                    }}
                    title="右クリックで名前変更 / Shiftで複数選択"
                    type="button"
                  >
                    <div className="font-semibold truncate">
                      {i + 1}. {label} {primary ? '(primary)' : ''}
                    </div>
                    <div className="text-gray-500 truncate">{o.type}</div>
                  </button>
                );
              })}
          </div>

          <div className="border-t p-2">
            <div className="text-[11px] text-gray-500 mb-2">Undo/Redo</div>
            <div className="flex gap-2 text-xs">
              <button className="rounded border px-2 py-1 hover:bg-gray-50" onClick={undo} type="button">
                ← 戻る
              </button>
              <button className="rounded border px-2 py-1 hover:bg-gray-50" onClick={redo} type="button">
                → やり直し
              </button>
            </div>
          </div>
        </aside>

        <Splitter which="left" onDoubleClick={toggleCollapseLeft} />

        {/* 中央：Canvas */}
        <div ref={canvasWrapRef} className="flex-1 min-h-0 bg-gray-100">
          <EditorCanvas
            objects={objects}
            selectedIds={expandedShapeSelection.length ? expandedShapeSelection : selectedIds}
            primaryId={primaryId}
            hoveredId={hoveredId}
            onSelect={handleSelectFromCanvas}
            onHover={setHoveredId}
            currentTool={currentTool}
            selectMode={selectMode}
            snapMovePick={snapMovePick}
            onSnapMovePickChange={setSnapMovePick}
            onSetPivotLocal={setPivotForPrimary}
            onCommitMove={(id, pos) => updateObject(id, { position: pos })}
            onLiveMove={(id, pos) => {
              setObjects((prev) => prev.map((oo) => (oo.id === id ? { ...oo, position: pos } : oo)));
            }}
            onLiveScale={(id, patch) => livePatchObject(id, patch)}
            onCommitScale={(id, patch) => updateObject(id, patch)}
            onLivePanDelta={(delta) => livePanDelta(delta)}
            onCommitPanDelta={(delta) => commitPanDelta(delta)}
            showShadows={showShadows}
            showGrid={showGrid}
            sketchMode={sketchMode}
            onSketchModeChange={(v) => {
              if (!v) return;
              if (v.type === 'sketch2d') {
                setSketchMode((prev) => ({ ...(prev ?? {}), ...v, tool: prev?.tool ?? 'line' }));
              }
            }}
            sketchEntities={sketchEntities}
            onSketchEntitiesChange={setSketchEntities}
            extrudeMode={extrudeMode}
            onExtrudeModeChange={(v) => {
              if (!v) return;

              if (v.step === 'pickRegion' && v.frame) {
                const loops = detectClosedLoops(sketchEntities ?? []);
                const first = loops[0] ?? null;
                setExtrudeMode((prev) => ({
                  ...(prev ?? {}),
                  step: 'pickRegion',
                  objId: v.objId ?? prev?.objId ?? null,
                  frame: v.frame,
                  loops,
                  selectedLoopId: first?.id ?? prev?.selectedLoopId ?? null,
                  selectedLoop: first ?? prev?.selectedLoop ?? null,
                }));
                return;
              }

              setExtrudeMode((prev) => ({ ...(prev ?? {}), ...v }));
            }}
          />
        </div>

        <Splitter which="right" onDoubleClick={toggleCollapseRight} />

        {/* 右：構成ツール */}
        <aside
          className="border-l bg-white flex flex-col min-h-0 overflow-hidden"
          style={{ width: rightWidth, display: rightWidth > 0 ? 'flex' : 'none' }}
        >
          <div className="border-b px-3 py-2 text-sm font-semibold truncate">構成ツール</div>

          <div className="flex-1 overflow-auto p-3 space-y-4">
            <div className="text-xs text-gray-600">
              選択数: <span className="font-semibold">{expandedShapeSelection.length}</span>
            </div>

            {addDraft ? (
              <AddShapePanel draft={addDraft} setDraft={setAddDraft} onPlace={placeDraft} onCancel={() => setAddDraft(null)} />
            ) : null}

{currentTool !== 'sketch2d' && currentTool !== 'extrude' ? (
  <InspectorPanel
    obj={primaryObject}
    onChange={(patch) => updatePrimary(patch)}
    selectedCount={expandedShapeSelection.length}
    onSetColor={(color, applyAll) => setColorForSelection(color, applyAll)}
  />
) : null}
            {currentTool === 'sketch2d' ? (
              <SketchToolPanel
                step={sketchMode?.step ?? 'pickFace'}
                tool={sketchMode?.tool ?? 'line'}
                setTool={(t) =>
                  setSketchMode((prev) => ({
                    ...(prev ?? {}),
                    tool: t,
                    step: prev?.frame ? 'drawing' : prev?.step ?? 'pickFace',
                  }))
                }
                onExit={exitSketch2D}
                onDeleteLast={deleteLastSketchEntity}
                entityCount={(sketchEntities ?? []).length}
              />
            ) : null}

            {currentTool === 'extrude' ? (
              <ExtrudePanel
                step={extrudeMode?.step ?? 'pickFace'}
                loops={extrudeMode?.loops ?? []}
                selectedLoopId={extrudeMode?.selectedLoopId ?? null}
                setSelectedLoopId={(id) => {
                  const loops = extrudeMode?.loops ?? [];
                  const sel = loops.find((l) => l.id === id) ?? null;
                  setExtrudeMode((prev) => ({ ...(prev ?? {}), selectedLoopId: id, selectedLoop: sel }));
                }}
                length={extrudeLen}
                setLength={setExtrudeLen}
                onDoExtrude={() => {
                  const sel = extrudeMode?.selectedLoop;
                  const frame = extrudeMode?.frame;
                  if (!sel || !frame) return;

                  const L = Math.max(1, Number(extrudeLen) || 1);

                  add('sketch-extrude', {
                    name: `extrude${Date.now()}`,
                    frame,
                    profile: { points: sel.points },
                    length: L,
                    position: [0, 0, 0],
                    pivot: [0, 0, 0],
                    rotation: [0, 0, 0],
                    color: '#bfbfbf',
                  });

                  exitExtrude();
                }}
                onExit={exitExtrude}
              />
            ) : null}

            {steelLoadError ? (
              <div className="rounded border p-2 text-xs">
                <div className="font-semibold text-red-600">鋼材カタログの読み込み失敗</div>
                <div className="text-[11px] text-gray-600 break-words mt-1">{steelLoadError}</div>
              </div>
            ) : null}

            {steelDraft ? (
              <SteelAddPanel
                catalog={steelCatalog}
                draft={steelDraft}
                setDraft={setSteelDraft}
                onPlace={placeSteelObj}
                onCancel={() => setSteelDraft(null)}
                disabled={!!steelLoadError}
              />
            ) : null}

            {/* ===== 複製：平行 ===== */}
            {currentTool === 'dup-translate' ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold">平行複製</div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">ΔX(mm)</div>
                    <input className="w-full rounded border px-2 py-1 text-xs" type="number" step="1" value={dupMove.x} onChange={(e) => setDupMove((d) => ({ ...d, x: e.target.value }))} />
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">ΔY(mm)</div>
                    <input className="w-full rounded border px-2 py-1 text-xs" type="number" step="1" value={dupMove.y} onChange={(e) => setDupMove((d) => ({ ...d, y: e.target.value }))} />
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">ΔZ(mm)</div>
                    <input className="w-full rounded border px-2 py-1 text-xs" type="number" step="1" value={dupMove.z} onChange={(e) => setDupMove((d) => ({ ...d, z: e.target.value }))} />
                  </div>
                </div>

                <button
                  className={`w-full rounded border px-2 py-1 text-xs hover:bg-gray-50 ${expandedShapeSelection.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                  type="button"
                  onClick={() => {
                    if (expandedShapeSelection.length === 0) return;
                    duplicateTranslate(dupMoveN.x, dupMoveN.y, dupMoveN.z);
                  }}
                >
                  複製
                </button>

                <button className="w-full rounded border px-2 py-1 text-xs hover:bg-gray-50" type="button" onClick={() => setDupMove({ x: '0', y: '0', z: '0' })}>
                  リセット
                </button>
              </div>
            ) : null}

            {/* ===== 複製：回転 ===== */}
            {currentTool === 'dup-rotate' ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold">回転複製</div>

                <div className="text-[11px] text-gray-500">軸</div>
                <div className="flex gap-2">
                  <button className={`flex-1 rounded border px-2 py-1 text-xs ${dupRotAxis === 'x' ? AXIS_ACTIVE : AXIS_INACTIVE}`} onClick={() => setDupRotAxis('x')} type="button">
                    X
                  </button>
                  <button className={`flex-1 rounded border px-2 py-1 text-xs ${dupRotAxis === 'y' ? AXIS_ACTIVE : AXIS_INACTIVE}`} onClick={() => setDupRotAxis('y')} type="button">
                    Y
                  </button>
                  <button className={`flex-1 rounded border px-2 py-1 text-xs ${dupRotAxis === 'z' ? AXIS_ACTIVE : AXIS_INACTIVE}`} onClick={() => setDupRotAxis('z')} type="button">
                    Z
                  </button>
                </div>

                <div>
                  <div className="text-[10px] text-gray-500 mb-1">角度（度）</div>
                  <input className="w-full rounded border px-2 py-1 text-xs" type="number" step="1" value={dupRotDeg} onChange={(e) => setDupRotDeg(e.target.value)} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" type="button" onClick={() => setDupRotDeg('90')}>
                    90°
                  </button>
                  <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" type="button" onClick={() => setDupRotDeg('45')}>
                    45°
                  </button>
                  <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" type="button" onClick={() => setDupRotDeg('180')}>
                    180°
                  </button>
                  <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" type="button" onClick={() => setDupRotDeg('-90')}>
                    -90°
                  </button>
                </div>

                <button
                  className={`w-full rounded border px-2 py-1 text-xs hover:bg-gray-50 ${expandedShapeSelection.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                  type="button"
                  onClick={() => {
                    if (expandedShapeSelection.length === 0) return;
                    duplicateRotate(dupRotAxis, dupRotDegN);
                  }}
                >
                  複製
                </button>
              </div>
            ) : null}

            {/* ===== 複製：ミラー ===== */}
            {currentTool === 'dup-mirror' ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold">ミラー複製</div>
                <div className="text-[11px] text-gray-500">軸</div>
                <div className="flex gap-2">
                  {['x', 'y', 'z'].map((ax) => (
                    <button key={ax} className={`flex-1 rounded border px-2 py-1 text-xs ${dupMirrorAxis === ax ? AXIS_ACTIVE : AXIS_INACTIVE}`} onClick={() => setDupMirrorAxis(ax)} type="button">
                      {ax.toUpperCase()}
                    </button>
                  ))}
                </div>
                <button
                  className={`w-full rounded border px-2 py-1 text-xs hover:bg-gray-50 ${expandedShapeSelection.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                  type="button"
                  onClick={() => {
                    if (expandedShapeSelection.length === 0) return;
                    duplicateMirror(dupMirrorAxis);
                  }}
                >
                  複製
                </button>
              </div>
            ) : null}

            {/* ===== 回転ツール ===== */}
            {currentTool === 'rotate' ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold">回転</div>

                <div className="text-[11px] text-gray-500">ワンタッチ（確定回転）</div>
                <div className="flex flex-wrap gap-2">
                  <QuickBtn deg={-90} />
                  <QuickBtn deg={-45} />
                  <QuickBtn deg={180} />
                  <QuickBtn deg={45} />
                  <QuickBtn deg={90} />
                </div>

                <div className="mt-2 text-[11px] text-gray-500">軸</div>
                <div className="flex gap-2">
                  <button className={`flex-1 rounded border px-2 py-1 text-xs ${rotAxis === 'x' ? AXIS_ACTIVE : AXIS_INACTIVE}`} onClick={() => setRotAxis('x')} type="button">
                    X
                  </button>
                  <button className={`flex-1 rounded border px-2 py-1 text-xs ${rotAxis === 'y' ? AXIS_ACTIVE : AXIS_INACTIVE}`} onClick={() => setRotAxis('y')} type="button">
                    Y
                  </button>
                  <button className={`flex-1 rounded border px-2 py-1 text-xs ${rotAxis === 'z' ? AXIS_ACTIVE : AXIS_INACTIVE}`} onClick={() => setRotAxis('z')} type="button">
                    Z
                  </button>
                </div>

                <div>
                  <div className="text-[10px] text-gray-500 mb-1">角度（度）</div>
                  <input className="w-full rounded border px-2 py-1 text-xs" type="number" step="1" value={rotAngleDeg} onChange={(e) => setRotAngleDeg(e.target.value)} />
                </div>

                <div className="flex gap-2">
                  <button
                    className={`flex-1 rounded border px-2 py-1 text-xs hover:bg-gray-50 ${expandedShapeSelection.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                    onClick={() => {
                      if (expandedShapeSelection.length === 0) return;
                      rebuildRotBase();
                      commitRotate(rotAngleDegN);
                    }}
                    type="button"
                  >
                    確定
                  </button>
                  <button className="flex-1 rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={() => setRotAngleDeg('0')} type="button">
                    リセット
                  </button>
                </div>
              </div>
            ) : null}

            {/* ===== 平行移動 ===== */}
            {currentTool === 'pan' ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold">平行移動（まとめて移動）</div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">ΔX</div>
                    <input className="w-full rounded border px-2 py-1 text-xs" type="number" step="10" value={moveDelta.x} onChange={(e) => setMoveDelta((d) => ({ ...d, x: e.target.value }))} />
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">ΔY</div>
                    <input className="w-full rounded border px-2 py-1 text-xs" type="number" step="10" value={moveDelta.y} onChange={(e) => setMoveDelta((d) => ({ ...d, y: e.target.value }))} />
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">ΔZ</div>
                    <input className="w-full rounded border px-2 py-1 text-xs" type="number" step="10" value={moveDelta.z} onChange={(e) => setMoveDelta((d) => ({ ...d, z: e.target.value }))} />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    className={`flex-1 rounded border px-2 py-1 text-xs hover:bg-gray-50 ${expandedShapeSelection.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                    onClick={() => {
                      if (expandedShapeSelection.length === 0) return;
                      rebuildPanBase();
                      commitPanDelta(moveDeltaN);
                    }}
                    type="button"
                  >
                    確定
                  </button>
                  <button className="flex-1 rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={() => setMoveDelta({ x: '0', y: '0', z: '0' })} type="button">
                    リセット
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t p-2 text-[11px] text-gray-500">
            {currentTool === 'sketch2d' ? 'スケッチ中：面を選択 → 作図' : null}
            {currentTool === 'extrude' ? '押出し中：面を選択 → 閉領域を選択 → 長さ' : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
