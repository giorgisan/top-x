import { supabase } from '../../../lib/supabase';
import { categorize, makeSnippet } from '../../../lib/categorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InItem = {
  id: string;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  dateISO: string;
};

export async function POST(req: Request) {
  try {
    const db = supabase();
    const body = await req.json();
    const items = (body?.items || []) as InItem[];

    let saved = 0;
    for (const it of items) {
      const category = categorize(it.text);
      const snippet = makeSnippet(it.text);
      const score = (it.likes || 0) + (it.retweets || 0) * 2;

      const { error } = await db.from('tweets').upsert({
        id: Number(it.id),
        text: it.text,
        url: it.url,
        likes: it.likes,
        retweets: it.retweets,
        date: it.dateISO,
        category,
        snippet,
        score
      });
      if (!error) saved++;
    }

    return new Response(JSON.stringify({ ok: true, saved }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}
