import { supabase } from '../lib/supabase';

export const dynamic = 'force-dynamic'; // ne prerenderiraj pri buildu
export const revalidate = 0;            // brez ISR cachinga

type Row = {
  id: number;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  date: string;
  category: string;
  snippet: string;
  score: number;
};

export default async function Page() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    return (
      <main className="container">
        <div className="header">
          <h1 style={{fontWeight:700, fontSize:28}}>Top tviti včeraj 🇸🇮</h1>
          <small className="muted">cron + Supabase</small>
        </div>
        <div className="card">
          Manjkajo environment spremenljivke v Vercel projektu:
          <ul style={{marginTop:8, lineHeight:1.5}}>
            <li><code>NEXT_PUBLIC_SUPABASE_URL</code></li>
            <li><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></li>
          </ul>
          Dodaj ju v <i>Project → Settings → Environment Variables (Production)</i> in redeploy.
        </div>
      </main>
    );
  }

  const db = supabase();

  // včeraj 00:00–24:00
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yStart = new Date(d.toDateString());
  const yEnd = new Date(yStart);
  yEnd.setDate(yEnd.getDate() + 1);

  const { data, error } = await db
    .from('tweets')
    .select('*')
    .gte('date', yStart.toISOString())
    .lt('date', yEnd.toISOString())
    .order('score', { ascending: false })
    .limit(100);

  const tweets = (data || []) as Row[];

  // grupiranje po kategoriji
  const groups = new Map<string, Row[]>();
  for (const t of tweets) {
    const k = t.category || 'Družba';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  const ordered = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);

  return (
    <main className="container">
      <div className="header">
        <h1 style={{fontWeight:700, fontSize:28}}>Top tviti včeraj 🇸🇮</h1>
        <small className="muted">cron + Supabase · kategorije brez AI</small>
      </div>

      {error && <div className="card">Napaka pri branju: {error.message}</div>}

      {!tweets.length && <div className="card">Ni podatkov — zaženi <code>/api/fetch</code> ali počakaj na cron.</div>}

      {ordered.map(([cat, rows]) => (
        <section key={cat} style={{marginBottom:24}}>
          <h2 style={{fontSize:18, fontWeight:700, margin:'6px 0 12px 0'}}>{cat} · {rows.length}</h2>
          <div className="grid">
            {rows.slice(0, 20).map(t => (
              <article className="card" key={t.id}>
                <p style={{whiteSpace:'pre-wrap', marginBottom:8}}>{t.snippet}</p>
                <div className="badge">❤️ {t.likes} · 🔁 {t.retweets} · ⚡ {t.score}</div>
                <a href={t.url} target="_blank" rel="noreferrer">Odpri tvit</a>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
