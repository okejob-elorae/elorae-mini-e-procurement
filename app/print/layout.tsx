'use client';

import './print.css';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

/**
 * Minimal layout for print-only pages.
 * - No sidebar, header, or FAB
 * - Forces light mode for consistent print output
 * - Requires auth; redirects to login if unauthenticated
 */
export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="light min-h-screen bg-white text-black" suppressHydrationWarning>
      <div className="min-h-screen p-6 print:p-0">
        {children}
      </div>
    </div>
  );
}
