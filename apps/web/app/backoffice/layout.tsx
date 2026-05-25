import { BackofficeShell } from './BackofficeShell';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function BackofficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <BackofficeShell>{children}</BackofficeShell>;
}
