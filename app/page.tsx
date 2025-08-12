import { getTopTweets } from '../lib/getTopTweets';

export const revalidate = 3600; // refresh na 1h (ISR)

export default async function Page() {
  const tweets = await getTopTweets(20);

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
