import { NextRequest, NextResponse } from 'next/server';
import { deleteProductMemory } from '@checklist/core';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest) {
  const { importerKey, descriptionKey } = (await req.json()) as { importerKey: string; descriptionKey: string };
  if (!importerKey || !descriptionKey) return new NextResponse('missing keys', { status: 400 });
  deleteProductMemory(importerKey, descriptionKey);
  return NextResponse.json({ ok: true });
}
