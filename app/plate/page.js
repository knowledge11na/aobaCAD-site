// file: app/plate/page.js
'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import SketchCanvas2D from '@/components/plate/SketchCanvas2D';
import PlatePreview3D from '@/components/plate/PlatePreview3D';
import PlateFileModal from '@/components/plate/PlateFileModal';

export default function PlatePage() {
  const [thickness, setThickness] = useState(9);

  const [profile, setProfile] = useState({
    outer: [],
    holes: [],
  });

  const [fileModal, setFileModal] = useState({ open: false, mode: 'save' });

  const handleChange = useCallback((data) => {
    if (!data?.profile) return;

    setProfile({
      outer: Array.isArray(data.profile.outer) ? data.profile.outer : [],
      holes: Array.isArray(data.profile.holes) ? data.profile.holes : [],
    });
  }, []);

  const canExtrude = useMemo(() => {
    return Array.isArray(profile.outer) && profile.outer.length >= 3;
  }, [profile]);

  function getCurrentPayloadForSave() {
    return {
      thickness: Number(thickness) || 0,
      profile: {
        outer: Array.isArray(profile?.outer) ? profile.outer : [],
        holes: Array.isArray(profile?.holes) ? profile.holes : [],
      },
      meta: {
        savedFrom: 'plate',
        version: 2,
      },
    };
  }

  function applyOpenedPayload(payload) {
    const t = Number(payload?.thickness);
    const p = payload?.profile ?? { outer: [], holes: [] };

    if (Number.isFinite(t)) setThickness(t);

    setProfile({
      outer: Array.isArray(p?.outer) ? p.outer : [],
      holes: Array.isArray(p?.holes) ? p.holes : [],
    });
  }

  return (
    <div className="space-y-4 overflow-hidden">
      <PlateFileModal
        open={fileModal.open}
        mode={fileModal.mode}
        onClose={() => setFileModal((prev) => ({ ...prev, open: false }))}
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
              {canExtrude
                ? `3D化OK（外形あり / 穴数 ${profile.holes.length}）`
                : 'まず外形を1つ閉じてください'}
            </div>
          </div>

          <SketchCanvas2D
            outer={profile.outer}
            holes={profile.holes}
            onChange={handleChange}
          />
        </div>

        <div className="rounded-xl border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">3Dプレビュー（押し出し）</div>
            <div className={`text-xs ${canExtrude ? 'text-green-700' : 'text-gray-500'}`}>
              {canExtrude ? '表示中' : '外形が未確定'}
            </div>
          </div>

          <PlatePreview3D
            outer={profile.outer}
            holes={profile.holes}
            thickness={thickness}
          />

          <div className="text-xs text-gray-600">
            ・1個目の閉じた輪郭 = 外形<br />
            ・2個目以降の閉じた輪郭 = 穴<br />
            ・四角穴も丸穴も「閉じた輪郭」を追加すればOK
          </div>
        </div>
      </div>
    </div>
  );
}