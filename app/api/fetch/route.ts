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

// Fallback seznam javnih Nitter instanc (nekatere so včasih offline)
// Po potrebi lahko dodaš/odstraniš.
const NITTERS = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.fdn.fr',
  'https://nitter.poast.org',
  'https://nitter.moomoo.me',
];

function timeout(ms: number) {
  return new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), ms));
}

async function fetchFromAny(urls: string[]): Promise<{ html: string; instance: string }> {
  let lastErr: any = null;

  for (const base of urls) {
    const searchUrl = base;
    try {
      const controller = new AbortController();
      const p = fetch(searchUrl, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
          'accept-language': 'sl-SI,sl;q=0.9,en;q=0.8'
        },
        cache: 'no-store',
        signal: controller.signal
      });

      const res = (await Promise.race([p, timeout(12000)])) as Response;
      if (!res || !('ok' in res)) throw new Error('no response');
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const html = await res.text();
      // hiter sanity check
      if (!html || !html.includes('timeline')) throw new Error('unexpected html');
      return { html, instance: base };
    } catch (e) {
      lastErr = e;
      // poskusi naslednjo instanco
      continue;
    }
  }
  throw lastErr || new Error('all nitter instances failed');
}

export async function GET() {
  try {
    const db = supabase(); // Supabase klient

    // včeraj
    const now = new Date();
    const until = now.toISOString().slice(0, 10);
    now.setDate(now.getDate() - 1);
    const since = now.toISOString().slice(0, 10);

    const query = encodeURIComponent(`lang:sl since:${since} until:${until}`);
    const searchPath = `/search?f=tweets&q=${query}`;

    // poskusi več instanc
    let html = '';
    let usedInstance = '';
    try {
      const r = await fetchFromAny(NITTERS.map((b) => `${b}${searchPath}`));
      html = r.html;
      usedInstance = r.instance;
    } catch (err: any) {
      console.error('Nitter fetch error:', err);
      return new Response(
        JSON.stringify({ ok: false, error: 'nitter_fetch_failed', detail: String(err) }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }

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

    // upsert v Supabase
    try {
      for (const t of items) {
        await db.from('tweets').upsert({
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
      }
    } catch (e: any) {
      // tipični Supabase problemi: RLS, schema, ključi
      return new Response(
        JSON.stringify({ ok: false, error: 'supabase_upsert_failed', detail: String(e) }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, saved: items.length, since, until, nitter: usedInstance }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}
