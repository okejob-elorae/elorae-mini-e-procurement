/**
 * Server layout whose only job is to opt the finance print routes out of static
 * prerendering. Each of the three pages is a client component that reads its
 * filters with `useSearchParams()` and has no dynamic route segment, which is a
 * build error in a statically prerendered tree without a `<Suspense>` boundary.
 * The shared `app/print/layout.tsx` cannot carry this flag — it is a client
 * component, where route segment config is ignored. Mirrors how
 * `app/backoffice/layout.tsx` covers the backoffice pages.
 */
export const dynamic = "force-dynamic";

export default function PrintFinanceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
