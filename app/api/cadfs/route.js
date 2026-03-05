// file: app/api/cadfs/route.js
import { NextResponse } from 'next/server';
import { readCadFS, writeCadFS } from '@/lib/cadfsStore';

export async function GET() {
  const data = await readCadFS();
  return NextResponse.json({ ok: true, data });
}

export async function PUT(req) {
  try {
    const body = await req.json();
    const data = body?.data ?? body; // {data: fs} でも fs直でもOK
    await writeCadFS(data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: String(e?.message ?? e) },
      { status: 400 }
    );
  }
}