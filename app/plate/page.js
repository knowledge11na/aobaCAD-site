// file: app/plate/page.js
'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import SketchCanvas2D from '@/components/plate/SketchCanvas2D';
import PlatePreview3D from '@/components/plate/PlatePreview3D';
import PlateFileModal from '@/components/plate/PlateFileModal';

export default function PlatePage() {
  const [thickness, setThickness] = useState(9);
  const [profile, setProfile] = useState({ points: [], closed: false });

  const [fileModal, setFileModal] = useState({ open: false, mode: 'save' }); // 'save'|'open'

  const handleChange = useCallback((data) => {
    if (data?.profile) setProfile(data.profile);
  }, []);

  const canExtrude = profile.closed && profile.points.length >= 3;

  function getCurrentPayloadForSave() {
    // ✅ 切板の保存データ（必要なものだけ）
    return {
      thickness: Number(thickness) || 0,
      profile: {
        points: profile?.points ?? [],
        closed: !!profile?.closed,
      },
      meta: {
        savedFrom: 'plate',
        version: 1,
      },
    };
  }

  function applyOpenedPayload(payload) {
    const t = Number(payload?.thickness);
    const p = payload?.profile ?? { points: [], closed: false };

    if (Number.isFinite(t)) setThickness(t);
    setProfile({
      points: Array.isArray(p?.points) ? p.points : [],
      closed: !!p?.closed,
    });
  }

  return (
    <div className="space-y-4">
      <PlateFileModal
        open={fileModal.open}
        mode={fileModal.mode}
        onClose={() => setFileModal((p) => ({ ...p, open: false }))}
        getCurrentPayload={getCurrentPayloadForSave}
        onOpenPayload={applyOpenedPayload}
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">切板製作（2D輪郭 → 板厚で3D化）</h1>

          <button
            className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
            type="button"
            onClick={() => setFileModal({ open: true, mode: 'save' })}
            title="切板を保存（ブラウザ保存）"
          >
            保存
          </button>

          <button
            className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
            type="button"
            onClick={() => setFileModal({ open: true, mode: 'open' })}
            title="保存した切板を開く"
          >
            開く
          </button>
        </div>

        <Link className="text-sm text-blue-600 hover:underline" href="/">
          ← ホーム
        </Link>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold">2Dスケッチ</div>

            <label className="flex items-center gap-2 text-sm">
              板厚(mm)
              <input
                className="w-24 rounded-lg border px-2 py-1"
                type="number"
                value={thickness}
                min={0.1}
                step={0.1}
                onChange={(e) => setThickness(e.target.value)}
              />
            </label>

            <div className={`text-xs ${canExtrude ? 'text-green-700' : 'text-gray-500'}`}>
              {canExtrude ? '3D化OK（輪郭が閉じています）' : '輪郭が閉じていません（「閉じる」してね）'}
            </div>
          </div>

          <SketchCanvas2D onChange={handleChange} />
        </div>

        <div className="rounded-xl border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">3Dプレビュー（押し出し）</div>
            <div className={`text-xs ${canExtrude ? 'text-green-700' : 'text-gray-500'}`}>
              {canExtrude ? '表示中' : '輪郭が未確定'}
            </div>
          </div>

          <PlatePreview3D points={profile.points} closed={profile.closed} thickness={thickness} />

          <div className="text-xs text-gray-600">
            ・マウス：ドラッグ回転 / ホイール拡大縮小 / 右ドラッグ平行移動<br />
            ・次は「円で穴あけ（内側輪郭）」「線で切欠き」「寸法表示」に進められます
          </div>
        </div>
      </div>
    </div>
  );
}