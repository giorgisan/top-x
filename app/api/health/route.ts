import { supabase } from '../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const report: any = {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: !!url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: !!anon
    }
  };

  try {
    const db = supabase();
    const { count, error } = await db
      .from('tweets')
      .select('*', { count: 'exact', head: true });

    report.db = { ok: !error, count, error: error?.message || null };

    const q = new URL(req.url).searchParams;
    if (q.get('test') === '1') {
      const { error: insErr } = await db.from('tweets').upsert({
        id: Date.now(), text: 'TEST', url: 'https://x.com/', likes: 0, retweets: 0,
        date: new Date().toISOString(), category: 'Test', snippet: 'Test', score: 0
      });
      report.insert = { ok: !insErr, error: insErr?.message || null };
    }

    return new Response(JSON.stringify({ ok: true, report }, null, 2), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e: any) {
    report.error = String(e?.message || e);
    return new Response(JSON.stringify({ ok: false, report }, null, 2), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
