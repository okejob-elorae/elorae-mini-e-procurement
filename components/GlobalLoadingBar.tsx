'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const BAR_DURATION_MS = 500;

export function GlobalLoadingBar() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const prevPathname = useRef<string | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevPathname.current !== null && prevPathname.current !== pathname) {
      setVisible(true);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(() => {
        setVisible(false);
        hideTimeout.current = null;
      }, BAR_DURATION_MS);
    }
    prevPathname.current = pathname;
    return () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      className="fixed left-0 right-0 top-0 z-9999 h-1 overflow-hidden bg-primary/20"
      role="progressbar"
      aria-label="Page loading"
      aria-valuetext="Loading"
    >
      <div
        className="h-full w-1/3 bg-primary"
        style={{
          animation: 'global-loading-bar 0.8s ease-in-out infinite',
        }}
      />
    </div>
  );
}
