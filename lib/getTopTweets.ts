import * as cheerio from 'cheerio';

export type TopTweet = {
  id: string;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  dateISO: string;
  score: number; // engagement score
};

/**
 * Scrape Nitter for Slovenian tweets from "yesterday" and return
 * top items by engagement (likes + retweets).
 * No API keys. Runs server-side only.
 */
export async function getTopTweets(limit = 20): Promise<TopTweet[]> {
  const now = new Date();
  const until = now.toISOString().slice(0, 10);
  now.setDate(now.getDate() - 1);
  const since = now.toISOString().slice(0, 10);

  const query = encodeURIComponent(`lang:sl since:${since} until:${until}`);
  const url = `https://nitter.net/search?f=tweets&q=${query}`;

  const html = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 Chrome/123 Safari/537.36'
    },
    cache: 'no-store'
  }).then(r => r.text());

  const $ = cheerio.load(html);
  const items: TopTweet[] = [];

  $('.timeline .timeline-item').each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find('.tweet-date a').attr('href');
    if (!linkEl) return;
    const id = (linkEl.split('/status/')[1] || '').split(/[?/]/)[0];
    if (!id) return;
    const tweetUrl = `https://x.com${linkEl.replace('/i/web', '')}`;
    const text = $el.find('.tweet-content').text().trim();

    const num = (sel: string) => {
      const raw = $el.find(sel).first().text().trim().replace(/[^0-9]/g, '');
      return Number(raw || 0);
    };
    const likes = num('.icon-heart + .tweet-stat');
    const retweets = num('.icon-retweet + .tweet-stat');

    const dateAttr = $el.find('.tweet-date a').attr('title') || '';
    const dateISO = dateAttr ? new Date(dateAttr).toISOString() : new Date().toISOString();
    const score = likes + retweets * 2; // simple weight

    items.push({ id, text, url: tweetUrl, likes, retweets, dateISO, score });
  });

  // Sort by score desc and slice
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, limit);
}
