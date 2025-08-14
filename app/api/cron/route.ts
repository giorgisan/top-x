import { NextResponse } from 'next/server';
import { saveTopTweets } from '@/lib/fetchTweets';

export async function GET() {
  try {
    await saveTopTweets();
    return NextResponse.json({ ok: true, message: 'Cron executed successfully' });
  } catch (error) {
    console.error('Cron job failed:', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
