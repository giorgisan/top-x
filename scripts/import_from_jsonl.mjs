import fs from 'node:fs';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';

/**
 * Branje JSONL, ki ga je ustvaril snscrape, normalizacija polj in upsert v Supabase.
 * Kličeš z: node scripts/import_from_jsonl.mjs scraped.jsonl
 */

const [,, inputPath] = process.argv;
if (!inputPath || !fs.existsSync(inputPath)) {
  console.log(JSON.stringify({ ok:false, error:'missing_jsonl', hint:'node scripts/import_from_jsonl.mjs scraped.jsonl' }));
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log(JSON.stringify({ ok:false, error:'missing_supabase_env' }));
  process.exit(0);
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function startOfUTCDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function isYesterdayUTC(dateISO) {
  const d = new Date(dateISO);
  const today0 = startOfUTCDay(new Date());
  const y0 = new Date(today0); y0.setUTCDate(y0.getUTCDate()-1);
  return d >= y0 && d < today0;
}

const categorize = (t) => {
  const s=(t||'').toLowerCase(), has=(...w)=>w.some(x=>s.includes(x));
  if (has('vlada','minister','parlament','referendum','volitve','poslanec','premier','golob','janša')) return 'Politika';
  if (has('olimpija','maribor','nzs','nogomet','košarka','kolesar','tour','tekma','gol','liga')) return 'Šport';
  if (has('delnica','borza','inflacija','banka','evro','gospodarstvo','proračun','davki','startup')) return 'Gospodarstvo';
  if (has('iphone','android','ai','umetna inteligenca','openai','google','apple','aplikacija','tehnologija')) return 'Tehnologija';
  if (has('neurje','vreme','poplava','sneg','vihar','nevihta','arso')) return 'Vreme';
  if (has('glasba','film','serija','koncert','festival','zabava')) return 'Zabava';
  return 'Družba';
};
const snippet = (t,n=180)=>{const s=(t||'').replace(/\s+/g,' ').trim();return s.length<=n?s:s.slice(0,n-1)+'…';};
const scoreOf = (pm) => {
  const l = pm?.likeCount || 0;
  const r = pm?.retweetCount || 0;
  const q = pm?.quoteCount || 0;
  const rp = pm?.replyCount || 0;
  return l + 2*r + 2*rp + q;
};

const seen = new Set();
let total=0, kept=0, saved=0;

const rl = readline.createInterface({
  input: fs.createReadStream(inputPath, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

const batch = [];
const BATCH_SIZE = 500;

async function flush() {
  if (!batch.length) return;
  const { error } = await db.from('tweets').upsert(batch);
  if (error) {
    console.log(JSON.stringify({ ok:false, stage:'upsert', error: String(error) }));
  } else {
    saved += batch.length;
  }
  batch.length = 0;
}

for await (const line of rl) {
  if (!line.trim()) continue;
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  total++;

  // Osnovna polja iz snscrape
  const id = Number(obj.id);
  if (!id || seen.has(id)) continue;
  seen.add(id);

  const dateISO = obj.date || obj.datetime || obj.created || null;
  if (!dateISO || !isYesterdayUTC(dateISO)) continue;

  const text = obj.content || obj.renderedContent || '';
  const url = obj.url || (obj.user?.username ? `https://x.com/${obj.user.username}/status/${obj.id}` : null);
  if (!url || !text) continue;

  const pm = {
    likeCount: obj.likeCount ?? 0,
    retweetCount: obj.retweetCount ?? 0,
    replyCount: obj.replyCount ?? 0,
    quoteCount: obj.quoteCount ?? 0
  };
  const score = scoreOf(pm);

  batch.push({
    id,
    text,
    url,
    likes: pm.likeCount,
    retweets: pm.retweetCount + pm.quoteCount,
    date: dateISO,
    category: categorize(text),
    snippet: snippet(text),
    score
  });

  kept++;
  if (batch.length >= BATCH_SIZE) await flush();
}
await flush();

console.log(JSON.stringify({
  ok:true,
  total_lines: total,
  unique_kept: kept,
  saved_rows: saved
}, null, 2));
