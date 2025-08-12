import { createClient } from '@/lib/supabase';

export default async function Home() {
  const supabase = createClient();
  const { data: tweets } = await supabase.from('tweets').select('*').order('likes', { ascending: false }).limit(10);

  return (
    <main className="p-6 bg-black text-white min-h-screen">
      <h1 className="text-2xl font-bold mb-4">Top tviti preteklega dne 🇸🇮</h1>
      <div className="grid gap-4">
        {tweets?.map((tweet: any) => (
          <div key={tweet.id} className="border p-4 rounded-lg bg-gray-900">
            <p className="mb-2">{tweet.text}</p>
            <a href={tweet.url} target="_blank" className="text-blue-400">Poglej na X</a>
            <div className="text-sm mt-2 text-gray-400">❤️ {tweet.likes} 🔁 {tweet.retweets}</div>
          </div>
        ))}
      </div>
    </main>
  );
}