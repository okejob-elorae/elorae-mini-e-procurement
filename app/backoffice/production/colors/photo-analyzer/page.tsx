import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PhotoAnalyzerPageClient } from './PhotoAnalyzerPageClient';

export const dynamic = 'force-dynamic';

export default async function PhotoAnalyzerPage() {
  const session = await auth();
  if (!session) redirect('/login');

  return <PhotoAnalyzerPageClient />;
}
