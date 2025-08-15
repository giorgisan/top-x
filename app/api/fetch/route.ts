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

// Nitter instance za iskanje (nekatere znajo biti začasno nedosegljive)
const NITTERS = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.fdn.fr',
  'https://nitter.poast.org',
  'https://nitter.moomoo.me'
];

function withProxy(u: string) {
  // r.jina.ai vrne HTML ciljne strani in pogosto obide blokade
  // primer: https://r.jina.ai/http://nitter.net/search?...  (opazno: http v notranjem URL)
  const url = new URL(u);
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}

function timeout(ms: number) {
  return new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), ms));
}

async function fetchHtml(url: string, useProxyFirst = true): Promise<{ html: string; used: string }> {
  const targets = [
    ...(useProxyFirst ? [withProxy(url)] : []),
    url
  ];

  let lastErr: any = null;
  for (const u of targets) {
    try {
      const p = fetch(u, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
          'accept-language': 'sl-SI,sl;q=0.9,en;q=0.8'
        },
        cache: 'no-store'
      });
      const res = (await Promise.race([p, timeout(15000)])) as Response;
      if (!res || !('ok' in res)) throw new Error('no response');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (!html || !html.toLowerCase().includes('timeline')) {
        // r.jina.ai včasih ne vsebuje "timeline" stringa, zato dovoli alternativni check
        if (!html.includes('tweet-content') && !html.includes('timeline-item'))
          throw new Error('unexpected html');
      }
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

    const query = encodeURIComponent(`lang:sl since:${since} until:${until}`);
    const path = `/search?f=tweets&q=${query}`;

    // poskusi zapored več instanc (vsako najprej prek proxyja)
    let html = '';
    let source = '';
    let lastErr: any = null;

    for (const base of NITTERS) {
      try {
        const r = await fetchHtml(`${base}${path}`, true);
        html = r.html;
        source = r.used;
        break;
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
    if (!html) {
      return new Response(
        JSON.stringify({ ok: false, error: 'nitter_fetch_failed', detail: String(lastErr) }),
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

    return new Response(
      JSON.stringify({ ok: true, saved: items.length, since, until, source }),
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
