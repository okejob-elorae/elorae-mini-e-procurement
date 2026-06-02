import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { ForecastImportPageClient } from './ForecastImportPageClient';

export const dynamic = 'force-dynamic';

export default async function ForecastImportPage() {
  const session = await auth();
  if (!session) redirect('/login');
  if (!hasPermission(session.user.permissions, PERMISSIONS.FORECAST_MANAGE)) {
    redirect('/backoffice/forecast');
  }

  return <ForecastImportPageClient />;
}
