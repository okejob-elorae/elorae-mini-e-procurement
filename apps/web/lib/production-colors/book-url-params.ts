export function parseBookSearchParams(
  sp: Record<string, string | string[] | undefined>
): {
  section?: number;
  page?: number;
  jumpTcx?: string;
} {
  const get = (key: string) => {
    const v = sp[key];
    return typeof v === "string" ? v : undefined;
  };

  const sectionRaw = get("section");
  const pageRaw = get("page");
  const jumpTcx = get("tcx")?.trim() || get("jump")?.trim();

  const section =
    sectionRaw && /^\d+$/.test(sectionRaw)
      ? parseInt(sectionRaw, 10)
      : undefined;
  const page =
    pageRaw && /^\d+$/.test(pageRaw) ? parseInt(pageRaw, 10) : undefined;

  return { section, page, jumpTcx };
}
