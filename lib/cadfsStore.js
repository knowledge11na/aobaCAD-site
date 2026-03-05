// file: lib/cadfsStore.js
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE_PATH = path.join(DATA_DIR, 'cadsite_fs.json');

const EMPTY = { folders: [] };

export async function readCadFS() {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.folders)) return EMPTY;
    return data;
  } catch {
    return EMPTY;
  }
}

export async function writeCadFS(next) {
  if (!next || typeof next !== 'object' || !Array.isArray(next.folders)) {
    throw new Error('invalid payload');
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(next, null, 2), 'utf8');
  return true;
}