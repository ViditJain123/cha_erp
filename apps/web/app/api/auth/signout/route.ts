import { NextResponse } from 'next/server';
import { publicEnv } from '@checklist/config/env';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', publicEnv().NEXT_PUBLIC_APP_URL), {
    status: 303,
  });
}
