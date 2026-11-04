"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { hapusDrafSaldoAwalAction, postingSaldoAwalAction, simpanDrafSaldoAwalAction } from "@/app/actions/finance-saldo-awal";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { kunciGalatSaldoAwal, nilaiGalat } from "@/lib/finance/saldo-awal/galat";
import type { JenisSaldoAwal } from "@/lib/finance/saldo-awal/jenis";
import type { KeadaanJenisSaldoAwal } from "@/lib/finance/saldo-awal/queries";

export type KonteksSaldoAwal = {
  tanggalMulai: string | null;
  tanggalJurnal: string | null;
  /** Alasan saldo awal tidak bisa diubah sama sekali (tanggal mulai belum ada / periode ditutup). */
  terkunci: string | null;
  bolehMengelola: boolean;
};

type Props = {
  jenis: JenisSaldoAwal;
  konteks: KonteksSaldoAwal;
  keadaan: KeadaanJenisSaldoAwal;
  baris: unknown;
  catatan: string;
  /** Efek ke Ekuitas saldo awal menurut pratinjau layar (kredit positif). */
  ekuitas: number;
  /** Kekurangan pertama isian layar, bila ada — tombol Posting dimatikan dan alasannya ditulis. */
  alasanBelum: string | null;
  namaBerkas?: string | null;
  /** Piutang toko selalu dihitung ulang: tidak ada draf. */
  tanpaDraf?: boolean;
};

/**
 * Tombol Simpan draf / Posting / Buang draf, sama untuk setiap jenis. Tombol
 * yang mati selalu disertai alasannya.
 */
export function AksiSaldoAwal(p: Props) {
  const t = useTranslations("saldoAwal");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [konfirmasi, setKonfirmasi] = useState<"posting" | "buang" | null>(null);

  const alasan = !p.konteks.bolehMengelola ? t("alasan.tanpaIzin") : (p.konteks.terkunci ?? p.alasanBelum);
  const sudahDiposting = p.keadaan.posting !== null;

  const gagal = (r: { kode: string; baris?: number; peran?: string; periode?: string; rincian?: string }) =>
    toast.error(t(kunciGalatSaldoAwal(r.kode), nilaiGalat(r)));

  const simpan = () =>
    mulai(async () => {
      const r = await simpanDrafSaldoAwalAction({ jenis: p.jenis, baris: p.baris, catatan: p.catatan, namaBerkas: p.namaBerkas ?? null });
      if (!r.ok) return void gagal(r);
      toast.success(t("sukses.draf"));
      router.refresh();
    });

  const posting = () =>
    mulai(async () => {
      const r = await postingSaldoAwalAction({ jenis: p.jenis, baris: p.baris, catatan: p.catatan, namaBerkas: p.namaBerkas ?? null });
      setKonfirmasi(null);
      if (!r.ok) return void gagal(r);
      toast.success(t("sukses.posting"));
      router.refresh();
    });

  const buang = () =>
    mulai(async () => {
      const r = await hapusDrafSaldoAwalAction({ jenis: p.jenis });
      setKonfirmasi(null);
      if (!r.ok) return void gagal(r);
      toast.success(t("sukses.buang"));
      router.refresh();
    });

  if (!p.konteks.bolehMengelola) return <p className="text-sm text-muted-foreground">{t("alasan.tanpaIzin")}</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setKonfirmasi("posting")} disabled={pending || alasan !== null}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {sudahDiposting ? t("aksi.postingUlang") : t("aksi.posting")}
        </Button>
        {!p.tanpaDraf ? (
          <Button variant="outline" onClick={simpan} disabled={pending || p.konteks.terkunci !== null}>
            <Save className="h-4 w-4" aria-hidden />
            {t("aksi.simpanDraf")}
          </Button>
        ) : null}
        {p.keadaan.draf ? (
          <Button variant="ghost" onClick={() => setKonfirmasi("buang")} disabled={pending}>
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
            {t("aksi.buangDraf")}
          </Button>
        ) : null}
      </div>
      {alasan && !pending ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {alasan}
        </p>
      ) : null}

      <AlertDialog open={konfirmasi === "posting"} onOpenChange={(o) => !o && setKonfirmasi(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasi.judulPosting", { jenis: t(`jenis.${p.jenis}`) })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("konfirmasi.isi", {
                tanggal: p.konteks.tanggalJurnal ? formatDisplayDate(parseDateOnly(p.konteks.tanggalJurnal), locale) : "—",
                nilai: formatRupiah(Math.abs(p.ekuitas)),
                sisi: p.ekuitas < 0 ? t("sisi.debit") : t("sisi.kredit"),
              })}
              {sudahDiposting ? ` ${t("konfirmasi.ulang")}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("aksi.batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                posting();
              }}
            >
              {pending ? t("aksi.memproses") : sudahDiposting ? t("aksi.postingUlang") : t("aksi.posting")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={konfirmasi === "buang"} onOpenChange={(o) => !o && setKonfirmasi(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasi.judulBuang")}</AlertDialogTitle>
            <AlertDialogDescription>{t("konfirmasi.isiBuang")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("aksi.batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                buang();
              }}
            >
              {t("aksi.buangDraf")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
