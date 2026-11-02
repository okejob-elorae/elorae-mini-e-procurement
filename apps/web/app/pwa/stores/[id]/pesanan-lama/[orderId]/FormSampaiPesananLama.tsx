"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCheck, Loader2, MapPin, Minus, PackageCheck, Plus } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { konfirmasiSampaiPesananLamaAction } from "@/app/actions/field-sales-orders-konsi-lama";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { PerluCheckIn } from "@/app/pwa/spg/terima/PerluCheckIn";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { BatasWaktuHabis, denganBatasWaktu } from "@/lib/pwa/offline/batas-waktu";
import { cn } from "@/lib/utils";

/** Satu baris pesanan lama di HP — nama, varian, dan sisa saja; tidak ada harga. */
export type BarisSampaiHp = { lineId: string; productName: string; variantSku: string; sisa: number };

export type PesananLamaHp = {
  orderId: string;
  orderNo: string;
  disetujuiLabel: string;
  baris: BarisSampaiHp[];
  /** Tanggal opname toko yang dilakukan SESUDAH pesanan ini disetujui, bila ada. */
  opnameTokoSesudah?: string | null;
};

/**
 * Kenapa pengguna ini tidak bisa mengonfirmasi pesanan ini (`peranPenerimaLama`): toko ber-SPG
 * dikonfirmasi SPG-nya; toko tanpa SPG hanya oleh salesman pemegangnya.
 */
export type PenghalangSampai = "TOKO_BER_SPG" | "BUKAN_PEMEGANG";

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "VALIDATION",
  "TIDAK_DITEMUKAN",
  "BUKAN_PENERIMA",
  "TANPA_KUNJUNGAN",
  "JUMLAH_TIDAK_VALID",
  "LEBIH_DARI_SISA",
  "KOSONG",
  "STOK_GUDANG_KURANG",
  "CADANGAN_BERUBAH",
  "BARIS_GUDANG_HILANG",
  "KUNCI_DIPAKAI",
]);
/** Pesanan ini sudah tidak bisa dikonfirmasi dari layar ini — kembali. */
const KODE_KEMBALI = new Set(["TIDAK_DITEMUKAN", "BUKAN_PENERIMA"]);
const angka = (s: string | undefined) => (s === undefined || s === "" ? null : Number(s));

/**
 * SPG (atau salesman pemegang toko tanpa SPG) menghitung barang pesanan konsinyasi LAMA yang
 * BENAR-BENAR ada di toko dan mengonfirmasinya. Isian awal = sisa yang belum dikonfirmasi (kasus
 * paling umum: semuanya sudah lama sampai); setiap baris yang kurang ditandai — sisanya tetap
 * menunggu, tidak pernah menjadi barang hilang. Lebih dari sisa tidak bisa disimpan.
 *
 * Hanya saat ada sinyal: konfirmasi ini memindahkan stok gudang, jadi tidak diantrekan di HP.
 * Kirim ulang memakai kunci yang sama, sehingga jawaban yang hilang di jalan tidak dicatat dua kali.
 */
export function FormSampaiPesananLama({
  pesanan,
  peran,
  sudahCheckIn,
  kembaliKe,
  penghalang = null,
}: {
  pesanan: PesananLamaHp | null;
  /** SPG check-in dari berandanya; salesman check-in dari halaman toko (`kembaliKe`). */
  peran: "SPG" | "SALESMAN";
  sudahCheckIn: boolean;
  /** Layar asal (daftar Terima kiriman SPG, atau halaman toko salesman). */
  kembaliKe: string;
  /** Kenapa pengguna ini tidak bisa mengonfirmasi; null = bisa. Server yang menilainya, dengan aturan penulisnya. */
  penghalang?: PenghalangSampai | null;
}) {
  const t = useTranslations("pwa.pesananLama");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kunci] = useState(newLocalId);
  const [ada, setAda] = useState<Record<string, string>>(() =>
    Object.fromEntries((pesanan?.baris ?? []).map((b) => [b.lineId, String(b.sisa)])),
  );
  const [catatan, setCatatan] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);

  const kembali = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <TautanKembali cadangan={kembaliKe} />
    </Button>
  );

  if (!pesanan) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <section className="beranda-kartu space-y-3">
          <h1 className="text-lg font-semibold leading-tight">{t("tidakDitemukanJudul")}</h1>
          <p className="text-sm text-muted-foreground">{t("tidakDitemukanIsi")}</p>
          <Button asChild className="w-full">
            <Link href={kembaliKe}>{t("kembaliKeDaftar")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  const baris = pesanan.baris;
  const semuaSah = baris.every((b) => {
    const n = angka(ada[b.lineId]);
    return n !== null && Number.isInteger(n) && n >= 0;
  });
  const adaLebih = baris.some((b) => (angka(ada[b.lineId]) ?? 0) > b.sisa);
  const totalSisa = baris.reduce((n, b) => n + b.sisa, 0);
  const totalAda = baris.reduce((n, b) => n + Math.max(0, angka(ada[b.lineId]) ?? 0), 0);
  const tetapMenunggu = Math.max(0, totalSisa - totalAda);
  // Kekurangan PERTAMA menurut urutan isian — kalimat di bawah tombol simpan.
  const kurang = penghalang
    ? td(`penghalang.${penghalang}`)
    : !sudahCheckIn
      ? t("perluCheckIn")
      : !semuaSah
        ? t("perluIsiSemua")
        : adaLebih
          ? t("lebihDariSisa")
          : totalAda === 0
            ? t("perluLebihDariNol")
            : null;

  const ubah = (lineId: string, nilai: string) => setAda((lama) => ({ ...lama, [lineId]: nilai }));
  const semuaAda = () => setAda(Object.fromEntries(baris.map((b) => [b.lineId, String(b.sisa)])));

  const simpan = () => {
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof konfirmasiSampaiPesananLamaAction>>;
      try {
        res = await denganBatasWaktu(
          konfirmasiSampaiPesananLamaAction({
            orderId: pesanan.orderId,
            baris: baris.map((b) => ({ lineId: b.lineId, qty: Number(ada[b.lineId]) })),
            idempotencyKey: kunci,
            note: catatan.trim() || undefined,
          }),
        );
      } catch (err) {
        // Tanpa jawaban: aman dikirim lagi — kuncinya sama, server mencatatnya sekali.
        toast.error(td(err instanceof TypeError || err instanceof BatasWaktuHabis ? "err.NETWORK" : "err.GENERIC"));
        return;
      }
      setKonfirmasi(false);
      if (!res.ok) {
        toast.error(td(KODE_GALAT.has(res.code) ? `err.${res.code}` : "err.GENERIC"));
        if (KODE_KEMBALI.has(res.code)) router.replace(kembaliKe);
        return;
      }
      toast.success(t("tersimpan", { pcs: res.pcs, orderNo: pesanan.orderNo }));
      router.replace(kembaliKe);
    });
  };

  return (
    <div className="space-y-4 p-4">
      {kembali}

      <header>
        <h1 className="min-w-0 break-all text-2xl font-bold">{t("judul")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("pesanan", { orderNo: pesanan.orderNo })} · {t("disetujui", { tanggal: pesanan.disetujuiLabel })}
        </p>
      </header>

      {!sudahCheckIn && !penghalang ? (
        peran === "SPG" ? (
          <PerluCheckIn judul={t("checkInJudul")} isi={t("checkInIsi")} tombol={t("checkInTombol")} />
        ) : (
          // Salesman check-in dari halaman toko (tombol Check-in di sana), bukan dari beranda SPG.
          <section className="beranda-kartu space-y-3" role="status">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <MapPin className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold leading-tight">{t("checkInJudul")}</h2>
                <p className="text-sm text-muted-foreground">{t("checkInIsiSalesman")}</p>
              </div>
            </div>
            <Button asChild className="w-full">
              <Link href={kembaliKe}>{t("checkInTombolSalesman")}</Link>
            </Button>
          </section>
        )
      ) : null}

      {pesanan.opnameTokoSesudah ? (
        // Sama dengan penerimaan kiriman: barang yang sudah ikut terhitung opname toko jangan dihitung lagi.
        <p role="note" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          {t("opnameTokoSesudah", { tanggal: pesanan.opnameTokoSesudah })}
        </p>
      ) : null}

      <section className="beranda-kartu space-y-3">
        <p className="text-sm">{t("penjelasan")}</p>
        <Button type="button" variant="outline" className="w-full" onClick={semuaAda} disabled={pending}>
          <CheckCheck className="h-4 w-4" aria-hidden />
          {t("semuaAda")}
        </Button>
      </section>

      <section className="space-y-2" aria-labelledby="judul-baris-lama">
        <h2 id="judul-baris-lama" className="beranda-judul px-1">
          {t("barisJudul", { count: baris.length })}
        </h2>
        <div className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {baris.map((b) => {
              const teks = ada[b.lineId] ?? "";
              const n = angka(teks);
              const lebih = n !== null && n > b.sisa;
              const sisaNanti = n === null ? null : b.sisa - n;
              return (
                <li
                  key={b.lineId}
                  className={cn("space-y-2 px-4 py-3", (lebih || n === null) && "bg-destructive/5", !lebih && sisaNanti !== null && sisaNanti > 0 && "bg-amber-500/10")}
                >
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{b.productName}</p>
                    {b.variantSku ? <p className="truncate text-xs text-muted-foreground">{b.variantSku}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 text-xs">
                      <span className="block text-muted-foreground">{t("sisa", { qty: b.sisa })}</span>
                      {n === null ? (
                        <span className="block font-medium text-destructive">{t("isiJumlah")}</span>
                      ) : lebih ? (
                        <span className="block font-semibold text-destructive">{t("lebihBaris")}</span>
                      ) : sisaNanti !== null && sisaNanti > 0 ? (
                        <span className="block font-medium text-amber-700 dark:text-amber-300">{t("tetapMenungguBaris", { n: sisaNanti })}</span>
                      ) : (
                        <span className="block text-emerald-700 dark:text-emerald-300">{t("semuaSampai")}</span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => ubah(b.lineId, String(Math.max(0, (n ?? 0) - 1)))}
                      disabled={pending || n === null || n <= 0}
                      aria-label={t("kurangi", { name: b.productName })}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      value={teks}
                      onChange={(e) => ubah(b.lineId, e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      aria-label={t("jumlahUntuk", { name: b.productName })}
                      aria-invalid={n === null || lebih || undefined}
                      disabled={pending}
                      className="w-20 text-center tabular-nums"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => ubah(b.lineId, String(Math.min(b.sisa, (n ?? 0) + 1)))}
                      disabled={pending || (n !== null && n >= b.sisa)}
                      aria-label={t("tambah", { name: b.productName })}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="beranda-kartu space-y-1 text-sm" aria-live="polite">
        <p className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("totalSisa")}</span>
          <span className="font-medium tabular-nums">{totalSisa}</span>
        </p>
        <p className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("totalAda")}</span>
          <span className="font-semibold tabular-nums">{totalAda}</span>
        </p>
        {tetapMenunggu > 0 && semuaSah && !adaLebih ? (
          <p className="pt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{t("tetapMenunggu", { pcs: tetapMenunggu })}</p>
        ) : null}
      </section>

      <div className="space-y-2">
        <Label htmlFor="sampai-lama-catatan">{t("catatanLabel")}</Label>
        <Textarea
          id="sampai-lama-catatan"
          value={catatan}
          onChange={(e) => setCatatan(e.target.value.slice(0, 500))}
          placeholder={t("catatanContoh")}
          rows={2}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Button className="w-full" size="lg" disabled={kurang !== null || pending} onClick={() => setKonfirmasi(true)}>
          <PackageCheck className="h-4 w-4" aria-hidden />
          {t("simpan")}
        </Button>
        <KeteranganKirim teks={kurang} />
      </div>

      <AlertDialog open={konfirmasi} onOpenChange={(o) => !pending && setKonfirmasi(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasiJudul")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{t("konfirmasiIsi", { pcs: totalAda, orderNo: pesanan.orderNo })}</p>
                {tetapMenunggu > 0 ? <p className="font-medium text-amber-700 dark:text-amber-300">{t("konfirmasiSisa", { pcs: tetapMenunggu })}</p> : null}
                <p>{t("konfirmasiFinal")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Dialog tetap terbuka selama menyimpan; ditutup oleh hasilnya.
                e.preventDefault();
                simpan();
              }}
              disabled={pending}
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t("menyimpan")}
                </>
              ) : (
                t("ok")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
