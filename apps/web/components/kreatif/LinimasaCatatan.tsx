"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { auditActionLabel, humanizeAuditCode } from "@/lib/audit/action-label";
import { formatDisplayDateTime } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { buatCatatanKolAction, linimasaKolAction } from "@/app/actions/kreatif-kol";
import type { ItemLinimasa } from "@/lib/creative/kol-queries";

const BATAS_CATATAN = 5000;

/**
 * Linimasa catatan manual (garis kiri warna aksen) dan riwayat otomatis (garis
 * abu, berlabel "otomatis"), terbaru di atas. Menulis catatan memulai ulang
 * jam follow-up KOL/kolaborasinya.
 */
export function LinimasaCatatan({
  kolId,
  kolaborasiId,
  bolehMengelola,
  awal,
}: {
  kolId: string | null;
  kolaborasiId: string | null;
  bolehMengelola: boolean;
  awal: ItemLinimasa[];
}) {
  const t = useTranslations("kreatifRuang");
  const tAudit = useTranslations("auditActions");
  const locale = useLocale();
  const [item, setItem] = useState(awal);
  const [awalTerakhir, setAwalTerakhir] = useState(awal);
  if (awal !== awalTerakhir) {
    setAwalTerakhir(awal);
    setItem(awal);
  }
  const [isi, setIsi] = useState("");
  const [menyimpan, startSimpan] = useTransition();

  const simpan = () => {
    const teks = isi.trim();
    if (!teks) return;
    startSimpan(async () => {
      const r = await buatCatatanKolAction({ kolId, kolaborasiId, isi: teks });
      if (!r.ok) {
        toast.error(t(`kol.err.${r.kode}` as never));
        return;
      }
      setIsi("");
      toast.success(t("kol.catatan.ok"));
      const baru = await linimasaKolAction({ kolId, kolaborasiId });
      if (baru.ok) setItem(baru.item);
    });
  };

  const namaTahap = (x: string) => (t.has(`tahap.${x}`) ? t(`tahap.${x}` as never) : humanizeAuditCode(x));
  const namaBidang = (x: string) => (t.has(`kol.bidang.${x}`) ? t(`kol.bidang.${x}` as never) : humanizeAuditCode(x));
  const angka = (n: number) => n.toLocaleString("id-ID");

  return (
    <div className="space-y-4">
      {bolehMengelola && (
        <div className="space-y-2">
          <Textarea
            value={isi}
            onChange={(e) => setIsi(e.target.value)}
            placeholder={t("kol.catatan.ph")}
            maxLength={BATAS_CATATAN}
            rows={3}
            aria-label={t("kol.catatan.judul")}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={simpan} disabled={menyimpan || !isi.trim()}>
              {menyimpan && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("kol.catatan.simpan")}
            </Button>
          </div>
        </div>
      )}

      {item.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("kol.catatan.kosong")}</p>
      ) : (
        <ol className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {item.map((x) => {
            const manual = x.jenis === "MANUAL";
            return (
              <li
                key={`${x.jenis}-${x.id}`}
                className={cn(
                  "rounded-md border-l-2 bg-muted/30 px-3 py-2 text-sm",
                  manual ? "border-l-primary" : "border-l-muted-foreground/30",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatDisplayDateTime(x.waktu, locale)}</span>
                  {x.oleh && <span>· {x.oleh}</span>}
                  {!manual && <span>· {t("kol.catatan.otomatis")}</span>}
                  {/* Di profil KOL, catatan milik sebuah kolaborasi menunjuk kolaborasinya. */}
                  {!kolaborasiId && x.docNo && manual && x.kolaborasiId ? (
                    <Link href={`/backoffice/kreatif/kolaborasi/${x.kolaborasiId}`} className="text-tautan hover:underline">
                      · {x.docNo}
                    </Link>
                  ) : !kolaborasiId && x.docNo ? (
                    <span>· {x.docNo}</span>
                  ) : null}
                </div>
                {manual ? (
                  <p className="mt-1 whitespace-pre-wrap break-words">{x.isi}</p>
                ) : (
                  <div className="mt-1 space-y-0.5">
                    <p className="font-medium">{auditActionLabel(tAudit, x.aksi, x.entityType)}</p>
                    {x.tahapDari && x.tahapKe && (
                      <p className="text-muted-foreground">
                        {t("kol.catatan.pindahTahap", { dari: namaTahap(x.tahapDari), ke: namaTahap(x.tahapKe) })}
                      </p>
                    )}
                    {x.template && <p className="text-muted-foreground">{t("kol.catatan.template", { nama: x.template })}</p>}
                    {x.sebab && <p className="text-muted-foreground">{t("kol.catatan.sebab", { sebab: x.sebab })}</p>}
                    {x.pengikut.map((p) => (
                      <p key={p.akun} className="text-muted-foreground tabular-nums">
                        {t("kol.catatan.pengikut", { akun: p.akun.replace(/^[A-Z]+:/, ""), dari: angka(p.dari), ke: angka(p.ke) })}
                      </p>
                    ))}
                    {x.kolomBerubah.length > 0 && (
                      <p className="text-muted-foreground">
                        {t("kol.catatan.kolomBerubah", { kolom: x.kolomBerubah.map(namaBidang).join(", ") })}
                      </p>
                    )}
                    {x.alasan && <p className="text-muted-foreground">{t("kol.catatan.alasan", { alasan: x.alasan })}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
