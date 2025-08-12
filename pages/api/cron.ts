export default async function handler(req, res) {
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  await fetch(`${baseUrl}/api/fetchTweets`);
  res.status(200).json({ message: 'Cron triggered tweet fetch' });
}