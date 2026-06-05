/** Derive plan category code from Item Category master (max 50 chars). */
export function planCodeFromItemCategory(category: {
  code: string | null;
  name: string;
}): string {
  const code = category.code?.trim();
  if (code) return code.slice(0, 50);
  const slug = category.name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (slug || "CAT").slice(0, 50);
}
