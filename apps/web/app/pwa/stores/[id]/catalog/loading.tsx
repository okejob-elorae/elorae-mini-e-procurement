export default function Loading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-4">
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden
      />
      <p className="text-sm text-muted-foreground">Memuat katalog…</p>
    </div>
  );
}
