// scripts/import_from_jsonl.mjs
import fs from 'node:fs';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const file = process.argv[2] || 'scraped.jsonl';
if (!fs.existsSync(file)) {
  console.log(`Import: file "${file}" not found — nothing to do. Exit 0.`);
  process.exit(0);
}
const stat = fs.statSync(file);
if (stat.size === 0) {
  console.log(`Import: file "${file}" is empty — nothing to import. Exit 0.`);
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper: iz JSONL polja izluščimo, kar potrebujemo
function mapTweet(obj) {
  const id = Number(obj.id) || null;
  const url = obj.url || null;
  const text = (obj.content || obj.renderedContent || obj.fullText || '').toString();
  const likes = obj.likeCount ?? obj.likes ?? 0;
  const retweets = obj.retweetCount ?? obj.retweets ?? 0;
  const replies = obj.replyCount ?? 0;
  const score = Number(likes) + Number(retweets) * 2 + Number(replies);
  const date = obj.date ? new Date(obj.date).toISOString() : new Date().toISOString();

  return {
    id,
    text,
    url,
    likes: Number(likes) || 0,
    retweets: Number(retweets) || 0,
    score: Number(score) || 0,
    date,
    category: null,
    snippet: text.slice(0, 200)
  };
}

const stream = fs.createReadStream(file, { encoding: 'utf8' });
const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

let total = 0;
let batch = [];
const BATCH_SIZE = 100;

async function flush() {
  if (batch.length === 0) return;
  const { error } = await supabase.from('tweets').upsert(batch, { onConflict: 'id' });
  if (error) {
    console.error('Supabase upsert error:', error.message);
  } else {
    console.log(`Upserted ${batch.length} rows`);
  }
  batch = [];
}

for await (const line of rl) {
  if (!line.trim()) continue;
  try {
    const obj = JSON.parse(line);
    const row = mapTweet(obj);
    if (row.id) {
      batch.push(row);
      total++;
      if (batch.length >= BATCH_SIZE) await flush();
    }
  } catch (e) {
    // ignoriramo pokvarjene vrstice
  }
}
await flush();

console.log(`Import finished. Total rows considered: ${total}`);
process.exit(0);
