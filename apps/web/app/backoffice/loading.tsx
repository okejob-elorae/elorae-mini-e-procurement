/**
 * Skeleton shown inside the shell while a backoffice page loads.
 *
 * The sidebar and header stay put (the layout persists across pages), so a
 * menu click answers at once with the shape of a list page — title, filter
 * row, table — instead of the old full-screen blurred spinner that hid the
 * whole app. The shape is generic on purpose: most backoffice pages are this
 * list pattern, and a skeleton that is roughly right beats a spinner that
 * says nothing about what is coming.
 */
export default function BackofficeLoading() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Memuat halaman…</span>

      <div className="space-y-2" aria-hidden>
        <div className="skeleton-block h-7 w-56 rounded-md" />
        <div className="skeleton-block h-4 w-80 max-w-full rounded-md" />
      </div>

      <div className="flex flex-wrap gap-3" aria-hidden>
        <div className="skeleton-block h-9 w-72 max-w-full rounded-md" />
        <div className="skeleton-block h-9 w-40 rounded-md" />
        <div className="skeleton-block h-9 w-40 rounded-md" />
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm" aria-hidden>
        <div className="skeleton-block mb-5 h-5 w-40 rounded-md" />
        <div className="space-y-3">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="skeleton-block h-4 w-28 rounded" />
              <div className="skeleton-block h-4 flex-1 rounded" />
              <div className="skeleton-block hidden h-4 w-24 rounded sm:block" />
              <div className="skeleton-block h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
