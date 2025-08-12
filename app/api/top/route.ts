import { parse } from 'node-html-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TopTweet = {
  id: string;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  dateISO: string;
  score: number;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || 20);

    const now = new Date();
    const until = now.toISOString().slice(0, 10);
    now.setDate(now.getDate() - 1);
    const since = now.toISOString().slice(0, 10);

    const query = encodeURIComponent(`lang:sl since:${since} until:${until}`);
    const url = `https://nitter.net/search?f=tweets&q=${query}`;

    const html = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/123 Safari/537.36' },
      cache: 'no-store'
    }).then(r => r.text());

    const root = parse(html);
    const timeline = root.querySelectorAll('.timeline .timeline-item');
    const items: TopTweet[] = [];

    for (const el of timeline) {
      const linkEl = el.querySelector('.tweet-date a');
      const href = linkEl?.getAttribute('href') ?? null;
      if (!href) continue;

      const id = (href.split('/status/')[1] || '').split(/[?/]/)[0];
      if (!id) continue;

      const tweetUrl = `https://x.com${href.replace('/i/web', '')}`;
      const text = (el.querySelector('.tweet-content')?.text || '').trim();

      const numberFrom = (selector: string) => {
        const raw = el.querySelector(selector)?.text?.trim().replace(/[^0-9]/g, '') ?? '0';
        return Number(raw || 0);
      };
      const likes = numberFrom('.icon-heart + .tweet-stat');
      const retweets = numberFrom('.icon-retweet + .tweet-stat');

      // ✅ varno branje atributa (linkEl je lahko null)
      const dateAttr = linkEl?.getAttribute('title') ?? '';
      const dateISO = dateAttr ? new Date(dateAttr).toISOString() : new Date().toISOString();

      const score = likes + retweets * 2;
      items.push({ id, text, url: tweetUrl, likes, retweets, dateISO, score });
    }

    items.sort((a, b) => b.score - a.score);
    const data = items.slice(0, limit);

    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'failed' }), { status: 500 });
  }
}
