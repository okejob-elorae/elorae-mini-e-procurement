/**
 * Only shown between top-level areas (login → backoffice, backoffice → PWA).
 * Inside the backoffice, `app/backoffice/loading.tsx` shows a page skeleton
 * within the shell instead, so this no longer covers the whole app with a
 * blurred overlay on every menu click.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
      <div
        className="h-9 w-9 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden
      />
      <span className="sr-only">Memuat…</span>
    </div>
  );
}
