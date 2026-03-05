// file: app/plate/page.js
'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import SketchCanvas2D from '@/components/plate/SketchCanvas2D';

export default function PlatePage() {
  const [sketch, setSketch] = useState({ lines: [] });

  const handleChange = useCallback((data) => {
    setSketch(data);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">切板製作（スケッチ：スナップ＆長さ指定）</h1>
        <Link className="text-sm text-blue-600 hover:underline" href="/">
          ← ホーム
        </Link>
      </div>

      <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-700">
        端点/中点スナップ、長さ・角度の数値入力（Enterで確定、Escでキャンセル）。
      </div>

      <SketchCanvas2D onChange={handleChange} />

      <div className="rounded-xl border p-3 text-xs text-gray-600">
        <div className="font-semibold mb-1">今の状態（デバッグ）</div>
        線分数：{sketch.lines.length}
      </div>
    </div>
  );
}