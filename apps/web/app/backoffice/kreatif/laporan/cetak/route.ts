import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaTanggal, hariIniWib, urutkanRentang } from "@/lib/tanggal-isian";
import { htmlCetakRekap, labelPeriodeRekap } from "@/lib/creative/laporan-cetak";
import { dataRekap } from "@/lib/creative/laporan-queries";
import { bacaIdentitasKreatif } from "@/lib/creative/pengaturan";
import { susunRekap } from "@/lib/creative/rekap";

export const dynamic = "force-dynamic";

const KEPALA = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
} as const;

function halamanPesan(judul: string, isi: string, kembaliHref: string, status: number): Response {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<title>${esc(judul)}</title>
<style>body{margin:0;padding:32px 20px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111827;background:#fff}
main{max-width:32rem;margin:0 auto}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px;color:#4b5563}
a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid #e5e7eb;border-radius:8px;color:#111827;text-decoration:none;font-weight:600}</style>
</head><body><main><h1>${esc(judul)}</h1><p>${esc(isi)}</p><a href="${esc(kembaliHref)}">← Kembali</a></main></body></html>`;
  return new Response(html, { status, headers: KEPALA });
}

/**
 * Rekap KOL versi cetak / PDF — `?dari=YYYY-MM-DD&sampai=YYYY-MM-DD`
 * (hari WIB, inklusif). Terbuka di tab baru dan langsung masuk jendela cetak;
 * `?pratinjau=1` hanya menampilkannya. Izinnya sama dengan layar Laporan
 * (`creative:view`).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return halamanPesan("Perlu masuk", "Masuk dulu untuk membuka rekap.", "/login", 401);
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_VIEW)) {
    return halamanPesan("Tidak punya izin", "Anda tidak punya izin melihat laporan Kreatif.", "/backoffice", 403);
  }

  const sp = req.nextUrl.searchParams;
  const hariIni = hariIniWib();
  const dari = sp.get("dari") ?? "";
  const sampai = sp.get("sampai") ?? dari;
  if (!bacaTanggal(dari) || !bacaTanggal(sampai)) {
    return halamanPesan("Periode tidak sah", "Pilih periode rekap dari layar Laporan lalu tekan Cetak / PDF lagi.", "/backoffice/kreatif/laporan?tab=rekap", 400);
  }
  const rentang = urutkanRentang(dari, sampai);
  const akhir = rentang.sampai > hariIni ? hariIni : rentang.sampai;
  const periode = { dari: rentang.dari > akhir ? akhir : rentang.dari, sampai: akhir };

  const [data, identitas] = await Promise.all([
    dataRekap({ dari: periode.dari, sampai: periode.sampai, userId: session.user.id }),
    bacaIdentitasKreatif(),
  ]);
  const kembali = `/backoffice/kreatif/laporan?${new URLSearchParams({ tab: "rekap", periode: "rentang", dari: periode.dari, sampai: periode.sampai }).toString()}`;
  const html = htmlCetakRekap({
    teks: susunRekap(data),
    brand: identitas.brand,
    periode: labelPeriodeRekap(periode),
    kembaliHref: kembali,
    cetakOtomatis: true,
  });
  return new Response(html, { status: 200, headers: KEPALA });
}
