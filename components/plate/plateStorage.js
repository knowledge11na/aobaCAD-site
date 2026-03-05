// file: components/plate/plateStorage.js
'use client';

const LS_KEY = 'cadsite_plate_fs_v1';

function safeParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadPlateFS() {
  if (typeof window === 'undefined') return { folders: [] };
  const raw = window.localStorage.getItem(LS_KEY);
  const data = safeParse(raw, { folders: [] });
  if (!data?.folders) return { folders: [] };
  return data;
}

export function savePlateFS(next) {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window' };

  try {
    const json = JSON.stringify(next);
    window.localStorage.setItem(LS_KEY, json);

    const check = window.localStorage.getItem(LS_KEY);
    if (!check) return { ok: false, reason: 'write-but-empty' };

    return { ok: true };
  } catch (e) {
    console.error('[savePlateFS] failed:', e);
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

export function createPlateFolder(fs, name) {
  const next = cloneDeep(fs);
  next.folders = next.folders ?? [];
  const folder = { id: uid('folder'), name: String(name || '新規フォルダ'), files: [] };
  next.folders.unshift(folder);
  return next;
}

export function renamePlateFolder(fs, folderId, name) {
  const next = cloneDeep(fs);
  const f = (next.folders ?? []).find((x) => x.id === folderId);
  if (f) f.name = String(name || f.name || 'フォルダ');
  return next;
}

export function deletePlateFolder(fs, folderId) {
  const next = cloneDeep(fs);
  next.folders = (next.folders ?? []).filter((x) => x.id !== folderId);
  return next;
}

export function createPlateFileInFolder(fs, folderId, fileName, payload) {
  const next = cloneDeep(fs);
  const f = (next.folders ?? []).find((x) => x.id === folderId);
  if (!f) return next;

  f.files = f.files ?? [];
  f.files.unshift({
    id: uid('file'),
    name: String(fileName || '新規ファイル'),
    savedAt: Date.now(),
    payload, // { thickness, profile:{points,closed}, meta? }
  });
  return next;
}

export function overwritePlateFile(fs, folderId, fileId, fileName, payload) {
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

export function deletePlateFile(fs, folderId, fileId) {
  const next = cloneDeep(fs);
  const f = (next.folders ?? []).find((x) => x.id === folderId);
  if (!f) return next;

  f.files = (f.files ?? []).filter((x) => x.id !== fileId);
  return next;
}