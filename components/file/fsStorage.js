// file: components/file/fsStorage.js
'use client';

const LS_KEY = 'cadsite_fs_v1';

function safeParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadFS() {
  if (typeof window === 'undefined') return { folders: [] };
  const raw = window.localStorage.getItem(LS_KEY);
  const data = safeParse(raw, { folders: [] });
  if (!data?.folders) return { folders: [] };
  return data;
}

/**
 * 保存結果を返す（本番での切り分け用）
 * ok=false のとき reason に例外名/メッセージが入る
 */
export function saveFS(next) {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window' };

  try {
    const json = JSON.stringify(next);
    window.localStorage.setItem(LS_KEY, json);

    // 念のため読み戻しチェック（まれな失敗検知）
    const check = window.localStorage.getItem(LS_KEY);
    if (!check) return { ok: false, reason: 'write-but-empty' };

    return { ok: true };
  } catch (e) {
    console.error('[saveFS] failed:', e);
    const reason = String(e?.name || e?.message || e);
    return { ok: false, reason };
  }
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function cloneDeep(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj ?? null));
}

// BufferGeometry 等が混ざると JSON化で落ちるので除去
export function sanitizeObjectsForSave(objects) {
  const strip = (o) => {
    const base = { ...o };
    delete base.__geometry;

    if (base.type === 'fused' && Array.isArray(base.sources)) {
      base.sources = base.sources.map((s) => {
        const ss = { ...s };
        delete ss.__geometry;
        return ss;
      });
    }

    return base;
  };

  return (objects ?? []).map(strip);
}

export function createFolder(fs, name) {
  const next = cloneDeep(fs);
  next.folders = next.folders ?? [];
  const folder = { id: uid('folder'), name: String(name || '新規フォルダ'), files: [] };
  next.folders.unshift(folder);
  return next;
}

export function renameFolder(fs, folderId, name) {
  const next = cloneDeep(fs);
  const f = (next.folders ?? []).find((x) => x.id === folderId);
  if (f) f.name = String(name || f.name || 'フォルダ');
  return next;
}

export function deleteFolder(fs, folderId) {
  const next = cloneDeep(fs);
  next.folders = (next.folders ?? []).filter((x) => x.id !== folderId);
  return next;
}

export function createFileInFolder(fs, folderId, fileName, payload) {
  const next = cloneDeep(fs);
  const f = (next.folders ?? []).find((x) => x.id === folderId);
  if (!f) return next;

  f.files = f.files ?? [];
  f.files.unshift({
    id: uid('file'),
    name: String(fileName || '新規ファイル'),
    savedAt: Date.now(),
    payload, // { objects: [...] }
  });
  return next;
}

export function overwriteFile(fs, folderId, fileId, fileName, payload) {
  const next = cloneDeep(fs);
  const f = (next.folders ?? []).find((x) => x.id === folderId);
  if (!f) return next;

  const file = (f.files ?? []).find((x) => x.id === fileId);
  if (!file) return next;

  file.name = String(fileName || file.name || 'ファイル');
  file.savedAt = Date.now();
  file.payload = payload;
  return next;
}

export function deleteFile(fs, folderId, fileId) {
  const next = cloneDeep(fs);
  const f = (next.folders ?? []).find((x) => x.id === folderId);
  if (!f) return next;

  f.files = (f.files ?? []).filter((x) => x.id !== fileId);
  return next;
}

export async function loadFSFromServer() {
  const res = await fetch('/api/cadfs', { method: 'GET', cache: 'no-store' });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.reason || 'server load failed');
  return j.data ?? { folders: [] };
}

export async function saveFSToServer(next) {
  const res = await fetch('/api/cadfs', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: next }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.reason || 'server save failed');
  return true;
}