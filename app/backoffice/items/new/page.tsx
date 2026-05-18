import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { NewItemPageClient } from './NewItemPageClient';

export const dynamic = 'force-dynamic';

export default async function NewItemPage() {
  const session = await auth();
  if (!session) redirect('/login');
  return <NewItemPageClient />;
}
