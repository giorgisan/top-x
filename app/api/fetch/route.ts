import { parse } from 'node-html-parser';
import { supabase } from '../../../lib/supabase';
import { categorize, makeSnippet } from '../../../lib/categorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TopTweet = {
  id: string;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  dateISO: string;
  category: string;
  snippet: string;
  score: number;
};

const NITTERS = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.fdn.fr',
  'https://nitter.poast.org',
  'https://nitter.moomoo.me'
];

function proxy(u: string) {
  const url = new URL(u);
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}

async function fetchHtml(url: string): Promise<{ html: string; used: string }> {
  const targets = [proxy(url), url]; // najprej prek proxyja, nato direktno
  let lastErr: any = null;
  for (const u of targets) {
    try {
      const res = await fetch(u, {
        headers: {
          'user-agent': 'Mozilla/5.0',
          'accept-language': 'sl-SI,sl;q=0.9,en;q=0.8'
        },
        cache: 'no-store'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (!html || html.length < 200) throw new Error('empty html');
      return { html, used: u };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('fetch failed');
}

export async function GET() {
  try {
    const db = supabase();

    // včeraj
    const now = new Date();
    const until = now.toISOString().slice(0, 10);
    now.setDate(now.getDate() - 1);
    const since = now.toISOString().slice(0, 10);

    // query z in brez lang:sl (ker včasih nič ne vrne)
    const q1 = encodeURIComponent(`lang:sl src:tweet since:${since} until:${until}`);
    const q2 = encodeURIComponent(`src:tweet since:${since} until:${until}`);
    const paths = [`/search?f=tweets&q=${q1}`, `/search?f=tweets&q=${q2}`];

    let items: TopTweet[] = [];
    let usedSource = '';
    let lastErr: any = null;

    outer: for (const base of NITTERS) {
      for (const path of paths) {
        try {
          const { html, used } = await fetchHtml(`${base}${path}`);
          usedSource = used;

          const root = parse(html);
          const els = root.querySelectorAll('.timeline .timeline-item');
          if (!els.length) throw new Error('no timeline items');

          for (const el of els) {
            const linkEl = el.querySelector('.tweet-date a');
            const href = linkEl?.getAttribute('href') ?? '';
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

            const category = categorize(text);
            const snippet = makeSnippet(text);
            const score = likes + retweets * 2;

            items.push({
              id,
              text,
              url: `https://x.com${href.replace('/i/web', '')}`,
              likes,
              retweets,
              dateISO,
              category,
              snippet,
              score
            });
          }

          if (items.length) break outer;
        } catch (e) {
          lastErr = e;
          continue;
        }
      }
    }

    if (!items.length) {
      return new Response(
        JSON.stringify({ ok: false, error: 'nitter_fetch_failed', detail: String(lastErr) }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }

    // upsert v Supabase
    let saved = 0;
    for (const t of items) {
      const { error } = await db.from('tweets').upsert({
        id: Number(t.id),
        text: t.text,
        url: t.url,
        likes: t.likes,
        retweets: t.retweets,
        date: t.dateISO,
        category: t.category,
        snippet: t.snippet,
        score: t.score
      });
      if (!error) saved++;
    }

    return new Response(
      JSON.stringify({ ok: true, saved, since, until, source: usedSource }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}
