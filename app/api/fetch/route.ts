import { parse } from 'node-html-parser';
import { supabase } from '../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TopTweet = {
  id: string;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  dateISO: string;
};

export async function GET() {
  try {
    // včeraj
    const now = new Date();
    const until = now.toISOString().slice(0, 10);
    now.setDate(now.getDate() - 1);
    const since = now.toISOString().slice(0, 10);

    const query = encodeURIComponent(`lang:sl since:${since} until:${until}`);
    const nitterUrl = `https://nitter.net/search?f=tweets&q=${query}`;

    const html = await fetch(nitterUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/123 Safari/537.36' },
      cache: 'no-store'
    }).then(r => r.text());

    const root = parse(html);
    const els = root.querySelectorAll('.timeline .timeline-item');

    const items: TopTweet[] = [];
    for (const el of els) {
      const linkEl = el.querySelector('.tweet-date a');
      const href = linkEl?.getAttribute('href') ?? null;
      if (!href) continue;

      const id = (href.split('/status/')[1] || '').split(/[?/]/)[0];
      if (!id) continue;

      const text = (el.querySelector('.tweet-content')?.text || '').trim();
      const num = (sel: string) => {
        const raw = el.querySelector(sel)?.text?.trim().replace(/[^0-9]/g, '') ?? '0';
        return Number(raw || 0);
      };
      const likes = num('.icon-heart + .tweet-stat');
      const retweets = num('.icon-retweet + .tweet-stat');

      const dateAttr = linkEl?.getAttribute('title') ?? '';
      const dateISO = dateAttr ? new Date(dateAttr).toISOString() : new Date().toISOString();

      items.push({
        id,
        text,
        url: `https://x.com${href.replace('/i/web', '')}`,
        likes,
        retweets,
        dateISO
      });
    }

    // upsert v Supabase
    for (const t of items) {
      await supabase.from('tweets').upsert({
        id: Number(t.id),
        text: t.text,
        url: t.url,
        likes: t.likes,
        retweets: t.retweets,
        date: t.dateISO
      });
    }

    return new Response(JSON.stringify({ ok: true, saved: items.length, since, until }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'failed' }), { status: 500 });
  }
}
