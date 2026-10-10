import { asalPermintaan, tokenDariSegmen } from "@/lib/creative/kalender-langganan";
import { bukaLanggananKalender, isiLanggananKalender, pembatasBacaLangganan } from "@/lib/creative/kalender-langganan-queries";
import { catatPemakaianLangganan } from "@/lib/creative/kalender-langganan-writer";
import { bentukTokenSah, hashRahasia } from "@/lib/creative/pantau-token";

export const dynamic = "force-dynamic";

/*
 * GET /api/kreatif/kalender/<token> — Kalender Kreatif sebagai berkas iCalendar
 * untuk Google Calendar / Apple Calendar. Di luar NextAuth (allow-list
 * `proxy.ts`): yang membaca adalah server Google, bukan orang yang masuk.
 * Tokennya sendiri adalah kuncinya; izin pemiliknya dibaca ulang setiap kali.
 *
 * Setiap kegagalan token = 404 tanpa keterangan, supaya tautan yang dicabut
 * tidak bisa dibedakan dari yang tidak pernah ada.
 */

const KEPALA_PRIBADI = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
} as const;

function jawabTeks(status: number, teks: string, lain: Record<string, string> = {}): Response {
  return new Response(teks, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...KEPALA_PRIBADI, ...lain },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token: segmen } = await ctx.params;
  const token = tokenDariSegmen(segmen ?? "");
  if (!bentukTokenSah(token)) return jawabTeks(404, "Not found");
  if (!pembatasBacaLangganan.coba(hashRahasia(token))) return jawabTeks(429, "Too many requests", { "Retry-After": "3600" });
  try {
    const akses = await bukaLanggananKalender(token);
    if (!akses) return jawabTeks(404, "Not found");
    const asal = asalPermintaan((nama) => req.headers.get(nama), new URL(req.url).origin);
    const ics = await isiLanggananKalender({ userId: akses.userId, asal });
    // Tidak pernah melempar; tidak ditunggu supaya kalendernya tidak menunggu tulisan ini.
    void catatPemakaianLangganan(akses.feedId, akses.terakhirDibaca);
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="elorae-kreatif.ics"',
        "Cache-Control": "private, max-age=300",
        ...KEPALA_PRIBADI,
      },
    });
  } catch (e) {
    console.error("[kalender langganan] gagal menyusun kalender:", e);
    return jawabTeks(500, "Error");
  }
}
