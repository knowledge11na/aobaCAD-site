// file: lib/cadfsStore.js
import { kv } from '@vercel/kv';

const KEY = 'cadsite:fs:v1';
const EMPTY = { folders: [] };

export async function readCadFS() {
  const data = await kv.get(KEY);
  if (!data || typeof data !== 'object' || !Array.isArray(data.folders)) return EMPTY;
  return data;
}

export async function writeCadFS(next) {
  if (!next || typeof next !== 'object' || !Array.isArray(next.folders)) {
    throw new Error('invalid payload');
  }
  await kv.set(KEY, next);
  return true;
}