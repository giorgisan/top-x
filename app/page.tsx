import { headers } from 'next/headers';

export const dynamic = 'force-dynamic'; // ne generiraj statično
export const revalidate = 0;

type TopTweet = {
  id: string;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  dateISO: string;
  score: number;
};

export default async function Page() {
  const h = headers();
  const host = h.get('host') || 'localhost:3000';
  const protocol = process.env.VERCEL ? 'https' : 'http';
  const res = await fetch(`${protocol}://${host}/api/top`, { cache: 'no-store' });
  const json = await res.json();
  const tweets: TopTweet[] = json?.data || [];

  return (
    <main className="container">
      <div className="header">
        <h1 style={{fontWeight:700, fontSize:28}}>Top tviti včeraj 🇸🇮</h1>
        <small className="muted">prototip · brez X API</small>
      </div>

      <p className="muted" style={{marginBottom:16}}>Zajem: Nitter iskanje <code>lang:sl</code> za pretekli dan · razvrstitev po všečkih in retvitih.</p>

      <div className="grid">
        {tweets.map(t => (
          <article className="card" key={t.id}>
            <p style={{whiteSpace:'pre-wrap'}}>{t.text}</p>
            <div className="badge">❤️ {t.likes} · 🔁 {t.retweets}</div>
            <a href={t.url} target="_blank" rel="noreferrer">Odpri tvit</a>
          </article>
        ))}
        {!tweets.length && <div className="card loading">Ni rezultatov. Poskusi kasneje.</div>}
      </div>
    </main>
  );
}
