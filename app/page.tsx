import nextDynamic from 'next/dynamic';
import { supabase } from '../lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ImportClient = nextDynamic(() => import('./import-client'), { ssr: false });

type Row = {
  id: number;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  date: string | null;
  category: string | null;
  snippet: string | null;
  score: number | null;
};

export default async function Page() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const header = (
    <div className="header">
      <h1 style={{ fontWeight: 700, fontSize: 28 }}>Top tviti včeraj 🇸🇮</h1>
      <small className="muted">cron + Supabase · kategorije brez AI</small>
    </div>
  );

  if (!url || !anon) {
    return (
      <main className="container">
        {header}
        <div className="card">
          Manjkajo environment spremenljivke v Vercelu:
          <ul style={{ marginTop: 8, lineHeight: 1.5 }}>
            <li><code>NEXT_PUBLIC_SUPABASE_URL</code></li>
            <li><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></li>
          </ul>
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

  // 1) poskusi prebrati včeraj
  let { data, error } = await db
    .from('tweets')
    .select('*')
    .gte('date', yStart.toISOString())
    .lt('date', yEnd.toISOString())
    .order('score', { ascending: false })
    .limit(100);

  // 2) fallback: če ni včeraj, pokaži zadnjih 50 po datumu
  if (!error && (!data || data.length === 0)) {
    const r = await db
      .from('tweets')
      .select('*')
      .order('date', { ascending: false, nullsFirst: false })
      .limit(50);
    data = r.data || [];
    error = r.error || null;
  }

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
      {header}

      {error && <div className="card">Napaka pri branju: {error.message}</div>}

      {!tweets.length && (
        <>
          <div className="card">Ni podatkov — poskusi “fallback” uvoz spodaj.</div>
          <ImportClient />
        </>
      )}

      {ordered.map(([cat, rows]) => (
        <section key={cat} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '6px 0 12px 0' }}>
            {cat} · {rows.length}
          </h2>
          <div className="grid">
            {rows.slice(0, 20).map((t) => (
              <article className="card" key={t.id}>
                <p style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{t.snippet || t.text}</p>
                <div className="badge">
                  ❤️ {t.likes ?? 0} · 🔁 {t.retweets ?? 0} · ⚡ {t.score ?? 0}
                </div>
                <a href={t.url} target="_blank" rel="noreferrer">Odpri tvit</a>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
