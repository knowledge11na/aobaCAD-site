// file: components/file/FileManagerModal.js
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createFileInFolder,
  createFolder,
  deleteFile,
  deleteFolder,
  loadFS,
  overwriteFile,
  renameFolder,
  saveFS,
} from './fsStorage';

function fmt(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(
      d.getHours()
    ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export default function FileManagerModal({
  open,
  mode, // 'save' | 'open'
  onClose,
  getCurrentPayload, // () => { objects: [...] }
  onOpenPayload, // (payload) => void
}) {
  const [fs, setFS] = useState({ folders: [] });
  const [activeFolderId, setActiveFolderId] = useState(null);

  const [newFolderName, setNewFolderName] = useState('');
  const [fileName, setFileName] = useState('');

  // ✅ モーダル中は背景スクロール禁止
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const data = loadFS();
    setFS(data);

    const first = data?.folders?.[0]?.id ?? null;
    setActiveFolderId((prev) => prev ?? first);
  }, [open]);

  const folders = fs?.folders ?? [];
  const activeFolder = useMemo(
    () => folders.find((f) => f.id === activeFolderId) ?? folders[0] ?? null,
    [folders, activeFolderId]
  );
  const files = activeFolder?.files ?? [];

  function commit(next) {
    setFS(next);
    saveFS(next);
  }

  useEffect(() => {
    if (!open) return;
    if (folders.length > 0) return;

    const next = createFolder(fs, 'default');
    commit(next);
    setActiveFolderId(next.folders?.[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl overflow-hidden ring-1 ring-black/10">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-semibold">{mode === 'save' ? '保存' : '開く'}</div>
          <button className="rounded border px-3 py-1 text-sm hover:bg-gray-50" onClick={onClose} type="button">
            閉じる
          </button>
        </div>

        <div className="grid grid-cols-[260px_1fr] min-h-[420px]">
          {/* 左：フォルダ */}
          <div className="border-r p-3 space-y-3">
            <div className="text-xs font-semibold text-gray-600">フォルダ</div>

            <div className="space-y-1 max-h-[280px] overflow-auto">
              {folders.map((f) => {
                const active = f.id === (activeFolder?.id ?? null);
                return (
                  <button
                    key={f.id}
                    className={`w-full text-left rounded border px-2 py-2 text-sm ${
                      active ? 'bg-gray-100 border-gray-400' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => setActiveFolderId(f.id)}
                    type="button"
                    title="クリックで選択"
                  >
                    <div className="font-semibold truncate">📁 {f.name || 'フォルダ'}</div>
                    <div className="text-[11px] text-gray-500 truncate">files: {(f.files ?? []).length}</div>
                  </button>
                );
              })}
            </div>

            <div className="rounded border p-2 space-y-2">
              <div className="text-[11px] text-gray-600 font-semibold">新規フォルダ</div>
              <input
                className="w-full rounded border px-2 py-1 text-sm"
                placeholder="フォルダ名"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
              />
              <button
                className="w-full rounded border px-2 py-1 text-sm hover:bg-gray-50"
                type="button"
                onClick={() => {
                  const nm = (newFolderName || '新規フォルダ').trim();
                  const next = createFolder(fs, nm);
                  commit(next);
                  setNewFolderName('');
                  setActiveFolderId(next.folders?.[0]?.id ?? null);
                }}
              >
                フォルダ作成
              </button>
            </div>

            {activeFolder ? (
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded border px-2 py-1 text-sm hover:bg-gray-50"
                  type="button"
                  onClick={() => {
                    const nm = window.prompt('フォルダ名を入力', activeFolder.name || '');
                    if (nm == null) return;
                    const next = renameFolder(fs, activeFolder.id, nm.trim() || activeFolder.name);
                    commit(next);
                  }}
                >
                  名前変更
                </button>
                <button
                  className="flex-1 rounded border px-2 py-1 text-sm hover:bg-gray-50"
                  type="button"
                  onClick={() => {
                    if (!confirm('このフォルダを削除しますか？（中のファイルも消えます）')) return;
                    const next = deleteFolder(fs, activeFolder.id);
                    commit(next);
                    setActiveFolderId(next.folders?.[0]?.id ?? null);
                  }}
                >
                  削除
                </button>
              </div>
            ) : null}
          </div>

          {/* 右：ファイル */}
          <div className="p-3 space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-gray-600">ファイル（{activeFolder?.name || ''}）</div>
                <div className="text-[11px] text-gray-500">※ ブラウザ保存（localStorage）</div>
              </div>

              {mode === 'save' ? (
                <div className="flex gap-2 items-end">
                  <div>
                    <div className="text-[11px] text-gray-500 mb-1">ファイル名</div>
                    <input
                      className="w-56 rounded border px-2 py-1 text-sm"
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                      placeholder="例）架台_001"
                    />
                  </div>
                  <button
                    className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                    type="button"
                    onClick={() => {
                      if (!activeFolder) return;
                      const payload = getCurrentPayload?.();
                      if (!payload) return;

                      const nm = (fileName || '新規ファイル').trim();
                      const next = createFileInFolder(fs, activeFolder.id, nm, payload);
                      commit(next);
                      setFileName('');
                      alert('保存しました');
                    }}
                  >
                    新規保存
                  </button>
                </div>
              ) : null}
            </div>

            <div className="rounded border overflow-hidden">
              <div className="grid grid-cols-[1fr_160px_240px] bg-gray-50 border-b px-3 py-2 text-xs font-semibold text-gray-600">
                <div>名前</div>
                <div>更新</div>
                <div className="text-right">操作</div>
              </div>

              <div className="max-h-[320px] overflow-auto">
                {files.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500">このフォルダにはファイルがありません</div>
                ) : (
                  files.map((f) => (
                    <div key={f.id} className="grid grid-cols-[1fr_160px_240px] items-center px-3 py-2 border-b last:border-b-0">
                      <div className="truncate text-sm font-semibold">{f.name || 'file'}</div>
                      <div className="text-xs text-gray-500">{fmt(f.savedAt)}</div>
                      <div className="flex gap-2 justify-end">
                        {mode === 'open' ? (
                          <button
                            className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                            type="button"
                            onClick={() => {
                              if (!confirm(`「${f.name}」を開きますか？（現在の作業は上書きされません）`)) return;
                              onOpenPayload?.(f.payload);
                              onClose?.();
                            }}
                          >
                            開く
                          </button>
                        ) : null}

                        {mode === 'save' ? (
                          <button
                            className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                            type="button"
                            onClick={() => {
                              if (!activeFolder) return;
                              if (!confirm(`「${f.name}」に上書き保存しますか？`)) return;

                              const payload = getCurrentPayload?.();
                              if (!payload) return;

                              const nm = window.prompt('ファイル名（変更するなら入力）', f.name || '');
                              if (nm == null) return;

                              const next = overwriteFile(fs, activeFolder.id, f.id, nm.trim() || f.name, payload);
                              commit(next);
                              alert('上書き保存しました');
                            }}
                          >
                            上書き
                          </button>
                        ) : null}

                        <button
                          className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                          type="button"
                          onClick={() => {
                            if (!activeFolder) return;
                            if (!confirm(`「${f.name}」を削除しますか？`)) return;
                            const next = deleteFile(fs, activeFolder.id, f.id);
                            commit(next);
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                type="button"
                onClick={() => {
                  if (!confirm('保存データを全消去しますか？')) return;
                  const next = { folders: [] };
                  commit(next);
                  setActiveFolderId(null);
                }}
              >
                （危険）全消去
              </button>
            </div>
          </div>
        </div>

        <div className="border-t px-4 py-3 text-[11px] text-gray-500">
          今はブラウザ保存です。次の段階で「サーバに保存 → スマホで同じフォルダを見る」に拡張できます。
        </div>
      </div>
    </div>
  );
}