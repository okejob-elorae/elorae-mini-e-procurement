'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PrintLayoutProps {
  /** Main title shown in the print header */
  title: string;
  /** Optional subtitle (e.g. document type or product name) */
  subtitle?: string;
  /** Document number (e.g. WO-001, PO-002) */
  docNumber?: string;
  /** Date string; defaults to current date when printing */
  date?: string;
  /** URL for logo image (e.g. /logo.png). Optional. */
  logoSrc?: string;
  /** Alt text for logo */
  logoAlt?: string;
  /** Extra class for the print-only header container */
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps content that should be printed with a consistent header (logo, title, doc number, date).
 * The header is hidden on screen and only shown when printing (@media print).
 * Use with global print styles in globals.css for page numbers and hiding app chrome.
 */
export function PrintLayout({
  title,
  subtitle,
  docNumber,
  date,
  logoSrc,
  logoAlt = 'Logo',
  className,
  children,
}: PrintLayoutProps) {
  const displayDate = date ?? (typeof window !== 'undefined' ? new Date().toLocaleDateString() : '');

  return (
    <>
      {/* Print-only header: visible only when printing */}
      <header
        className={cn(
          'hidden print:block print:mb-6 print:pb-4 print:border-b-2 print:border-gray-400',
          className
        )}
        aria-hidden
      >
        <div className="print:flex print:items-center print:justify-between print:gap-4">
          <div className="print:flex print:items-center print:gap-3">
            {logoSrc && (
              <img
                src={logoSrc}
                alt={logoAlt}
                className="print:h-10 print:w-auto print:object-contain"
              />
            )}
            <div>
              <h1 className="print:text-xl print:font-bold print:text-black print:m-0 print:leading-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="print:text-sm print:text-gray-700 print:mt-1 print:m-0 print:font-medium">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <div className="print:text-right print:text-sm print:text-gray-700 print:font-medium">
            {docNumber && <p className="print:m-0">{docNumber}</p>}
            <p className="print:m-0 print:mt-1">{displayDate}</p>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
