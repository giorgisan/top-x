export default async function handler(req: any, res: any) {
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  const r = await fetch(`${baseUrl}/api/fetchTweets`);
  const j = await r.json().catch(() => ({}));
  res.status(200).json({ message: 'Cron triggered', result: j });
}
