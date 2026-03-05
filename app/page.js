// file: app/page.js
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">3DCADサイト（初期セットアップ）</h1>

      <p className="text-sm text-gray-600">
        まずは「3D表示」「鋼材テンプレ（仮）」「材質（仮）」「材料取り」「切板製作」の入口を用意しました。
      </p>

      <div className="grid gap-3 sm:grid-cols-5">
        <Link className="rounded-xl border p-4 hover:bg-gray-50" href="/editor">
          <div className="font-semibold">3Dエディタ</div>
          <div className="text-sm text-gray-600">まずは3D表示・操作</div>
        </Link>

        <Link className="rounded-xl border p-4 hover:bg-gray-50" href="/library">
          <div className="font-semibold">鋼材テンプレ</div>
          <div className="text-sm text-gray-600">H鋼/チャンネルなどを保存</div>
        </Link>

        <Link className="rounded-xl border p-4 hover:bg-gray-50" href="/materials">
          <div className="font-semibold">材質管理</div>
          <div className="text-sm text-gray-600">単位重量を登録</div>
        </Link>

        <Link className="rounded-xl border p-4 hover:bg-gray-50" href="/cutting">
          <div className="font-semibold">材料取り</div>
          <div className="text-sm text-gray-600">定尺から最適な切断表を作成</div>
        </Link>

        <Link className="rounded-xl border p-4 hover:bg-gray-50" href="/plate">
          <div className="font-semibold">切板製作</div>
          <div className="text-sm text-gray-600">2D作図 → 板厚で3D化</div>
        </Link>
      </div>

      <div className="rounded-xl bg-gray-50 p-4 text-sm">
        <div className="font-semibold mb-1">次にやること（予定）</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>鋼材テンプレ保存を IndexedDB（ブラウザ保存）に変更</li>
          <li>材質の単位重量 → 重さ計算（穴/切欠き考慮あり/なし）</li>
          <li>3D上で立方体/直方体/円柱/円錐テンプレ作成 → 編集</li>
          <li>切板製作：2Dの押し出し形状を保存・呼び出し（将来）</li>
          <li>材料取り：鋼材テンプレと連動（将来）</li>
        </ul>
      </div>
    </div>
  );
}