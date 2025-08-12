import * as cheerio from 'cheerio';
import { createClient } from '../../lib/supabase';

type ScrapedTweet = {
  id: string;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  date: string;
};

export const config = {
  maxDuration: 60
};

export default async function handler(req: any, res: any) {
  try {
    const supabase = createClient();

    // datum od–do (včeraj)
    const d = new Date();
    const until = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() - 1);
    const since = d.toISOString().slice(0, 10);

    // Nitter search za slovenske tvite včeraj
    const query = encodeURIComponent(`lang:sl since:${since} until:${until}`);
    const url = `https://nitter.net/search?f=tweets&q=${query}`;

    const html = await fetch(url, {
      headers: {
        // basic headers to look like a browser
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
      }
    }).then(r => r.text());

    const $ = cheerio.load(html);
    const items: ScrapedTweet[] = [];

    $('.timeline .timeline-item').each((_, el) => {
      const $el = $(el);

      // url & id
      const linkEl = $el.find('.tweet-date a').attr('href'); // e.g. /user/status/123...
      if (!linkEl) return;
      const url = `https://x.com${linkEl.replace('/i/web', '')}`;
      const id = (linkEl.split('/status/')[1] || '').split(/[?/]/)[0];
      if (!id) return;

      // text
      const text = $el.find('.tweet-content').text().trim();

      // stats – heuristika (Nitter ima ikone + številke)
      const statText = (sel: string) => {
        const t = $el.find(sel).first().text().trim().replace(/\D+/g, '');
        return Number(t || 0);
      };
      const likes = statText('.icon-heart + .tweet-stat');
      const retweets = statText('.icon-retweet + .tweet-stat');

      // date
      const dateAttr = $el.find('.tweet-date a').attr('title') || '';
      const date = dateAttr ? new Date(dateAttr).toISOString() : new Date().toISOString();

      items.push({ id, text, url, likes, retweets, date });
    });

    // upsert v Supabase
    for (const t of items) {
      await supabase.from('tweets').upsert({
        id: Number(t.id),
        text: t.text,
        url: t.url,
        likes: t.likes,
        retweets: t.retweets,
        date: t.date
      });
    }

    res.status(200).json({ ok: true, count: items.length, since, until });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || 'failed' });
  }
}
