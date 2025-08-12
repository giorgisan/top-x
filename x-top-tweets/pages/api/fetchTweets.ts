import { exec } from 'child_process';
import { createClient } from '@/lib/supabase';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default async function handler(req, res) {
  const supabase = createClient();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const since = yesterday.toISOString().split('T')[0];
  const until = new Date().toISOString().split('T')[0];

  try {
    const { stdout } = await execAsync(`npx snscrape --jsonl twitter-search "lang:sl since:${since} until:${until}"`);
    const tweets = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
    
    for (const t of tweets) {
      await supabase.from('tweets').upsert({
        id: t.id,
        text: t.content,
        url: t.url,
        likes: t.likeCount,
        retweets: t.retweetCount,
        date: t.date
      });
    }

    res.status(200).json({ success: true, count: tweets.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Scraping failed' });
  }
}