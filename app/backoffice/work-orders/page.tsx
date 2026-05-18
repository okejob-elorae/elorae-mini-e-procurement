import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { WorkOrdersPageClient } from './WorkOrdersPageClient';

export const dynamic = 'force-dynamic';

export default async function WorkOrdersPage() {
  const session = await auth();
  if (!session) redirect('/login');

  return <WorkOrdersPageClient />;
}
