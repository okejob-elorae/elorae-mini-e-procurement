"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import {
  barisPerubahan,
  labelKolomAudit,
  nilaiTampil,
} from "@/lib/audit/rincian-perubahan";
import { angkaUang, kolomUang, labelNilaiStatus } from "@/lib/audit/nilai-audit";
import { formatRupiah } from "@/lib/format/rupiah";
import { cn } from "@/lib/utils";

/**
 * Rincian perubahan satu baris log: tabel Kolom / Sebelum / Sesudah dengan
 * nama kolom berbahasa Indonesia — bukan JSON mentah. Kolom uang tampil
 * sebagai rupiah dan kode status sebagai labelnya (`lib/audit/nilai-audit.ts`);
 * `entityType` menentukan arti kode status (BELUM di termin KOL ≠ BELUM di pajak).
 */
export function RincianPerubahan({ changes, entityType }: { changes: unknown; entityType?: string | null }) {
  const tAudit = useTranslations("audit");
  const tAuditActions = useTranslations("auditActions");
  const rows = barisPerubahan(changes);
  if (rows.length === 0) return null;
  const adaSebelum = rows.some((r) => r.adaSebelum);

  return (
    <div className="overflow-x-auto rounded-md border bg-background">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">{tAudit("trail.detailField")}</th>
            {adaSebelum && <th className="px-3 py-2 font-medium">{tAudit("trail.detailBefore")}</th>}
            <th className="px-3 py-2 font-medium">
              {adaSebelum ? tAudit("trail.detailAfter") : tAudit("trail.detailValue")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.kunci}-${i}`} className={cn("border-b last:border-0", r.berubah && "bg-muted/40")}>
              <td className="px-3 py-1.5 align-top text-muted-foreground">
                {labelKolomAudit(tAuditActions, r.kunci)}
              </td>
              {adaSebelum && (
                <td className="px-3 py-1.5 align-top">
                  {r.adaSebelum ? (
                    <Nilai v={r.sebelum} kunci={r.kunci} entityType={entityType} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              )}
              <td className={cn("px-3 py-1.5 align-top", r.berubah && "font-medium")}>
                {r.adaSesudah ? (
                  <Nilai v={r.sesudah} kunci={r.kunci} entityType={entityType} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Nilai({ v, kunci, entityType }: { v: unknown; kunci: string; entityType?: string | null }) {
  const tAudit = useTranslations("audit");
  const tRoot = useTranslations();
  const locale = useLocale();
  const status = labelNilaiStatus(tRoot, entityType, kunci, v);
  if (status !== null) return <>{status}</>;
  const uang = kolomUang(kunci) ? angkaUang(v) : null;
  if (uang !== null) {
    // Rupiah utuh di layar; nilai persisnya (mis. DPP 2.512.886,5) tetap ada di tooltip.
    return (
      <span
        className="tabular-nums"
        title={Number.isInteger(uang) ? undefined : uang.toLocaleString(locale === "en" ? "en-GB" : "id-ID")}
      >
        {formatRupiah(uang)}
      </span>
    );
  }
  const n = nilaiTampil(v);
  switch (n.jenis) {
    case "kosong":
      return <span className="text-muted-foreground">—</span>;
    case "yaTidak":
      return <>{n.nilai ? tAudit("trail.yes") : tAudit("trail.no")}</>;
    case "angka":
      return (
        <span className="tabular-nums">
          {n.nilai.toLocaleString(locale === "en" ? "en-GB" : "id-ID")}
        </span>
      );
    case "tanggal":
      return <>{n.denganJam ? formatDisplayDateTime(n.teks, locale) : formatDisplayDate(n.teks, locale)}</>;
    case "id":
      // Id internal tidak menonjol: dipendekkan, utuhnya di tooltip.
      return (
        <span className="font-mono text-xs text-muted-foreground" title={n.teks}>
          {n.teks.slice(0, 8)}…
        </span>
      );
    case "daftar":
      return <span className="break-words">{n.isi.join(", ")}</span>;
    case "json":
      return <code className="break-all text-xs text-muted-foreground">{n.teks}</code>;
    default:
      return <span className="whitespace-pre-wrap break-words">{n.teks}</span>;
  }
}
