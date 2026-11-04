"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MessageCircle, Truck, UserRound, XCircle } from "lucide-react";
import { tandaiDikabariAction, tutupTitipanAction, type HasilTitipAksi } from "@/app/actions/spg-titip";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_ALASAN_TITIP, batasSimpanDari, pesanTitipTersedia } from "@/lib/spg/titip";
import type { RincianTitipHp } from "@/lib/spg/titip-queries";
import { cn } from "@/lib/utils";
import { nadaKelompokTitip } from "../tampilan";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

const KODE_GALAT = new Set(["FORBIDDEN", "NO_ASSIGNED_STORE", "VALIDATION", "TIDAK_DITEMUKAN", "SUDAH_DITUTUP", "BELUM_ADA", "SUDAH_BERUBAH", "ALASAN_WAJIB", "ALASAN_TERLALU_PANJANG"]);

/**
 * Satu titip pesan. "Kabari lewat WhatsApp" MEMBUKA WhatsApp dengan pesan
 * berbahasa Indonesia (tanpa harga) lalu menandai pembeli sudah dikabari —
 * barang disimpankan sampai hari ini + masa simpan. WhatsApp dibuka langsung
 * di ketukan (bukan sesudah menunggu server), supaya peramban tidak
 * menahannya sebagai jendela sembulan. Pesan untuk yang SUDAH dikabari
 * menyebut tanggal simpan yang sudah tercatat — kirim ulang tidak
 * memperpanjangnya.
 */
export function RincianTitipClient({
  rincian,
  minta = null,
}: {
  rincian: RincianTitipHp | null;
  /**
   * "Minta ke salesman" untuk titip pesan yang masih menunggu barangnya;
   * `dariKatalog` false = barang ditulis bebas, formulirnya terbuka kosong.
   */
  minta?: { alamat: string; dariKatalog: boolean } | null;
}) {
  const t = useTranslations("spgTitip");
  const td = dinamis(t);
  const bahasa = useLocale() === "en" ? "en" : "id";
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [selesaiBuka, setSelesaiBuka] = useState(false);
  const [batalBuka, setBatalBuka] = useState(false);
  const [alasan, setAlasan] = useState("");

  const kembali = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <TautanKembali cadangan="/pwa/spg/titip" />
    </Button>
  );

  if (!rincian) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <section className="beranda-kartu space-y-3">
          <h1 className="text-lg font-semibold leading-tight">{t("rincian.tidakAdaJudul")}</h1>
          <p className="text-sm text-muted-foreground">{t("rincian.tidakAdaIsi")}</p>
          <Button asChild className="w-full">
            <Link href="/pwa/spg/titip">{t("rincian.keDaftar")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  const terbuka = rincian.status === "MENUNGGU" || rincian.status === "TERSEDIA" || rincian.status === "DIKABARI";

  const jalankan = (aksi: () => Promise<HasilTitipAksi>, sukses: (r: Extract<HasilTitipAksi, { ok: true }>) => string, tutup?: () => void) =>
    mulai(async () => {
      let r: HasilTitipAksi;
      try {
        r = await aksi();
      } catch {
        toast.error(t("err.GENERIC"));
        return;
      }
      tutup?.();
      if (!r.ok) {
        toast.error(KODE_GALAT.has(r.code) ? td(`err.${r.code}`) : t("err.GENERIC"));
        router.refresh();
        return;
      }
      toast.success(sukses(r));
      router.refresh();
    });

  function kabari() {
    if (!rincian || !rincian.pesan.nomorWa) return;
    const sudah = rincian.status === "DIKABARI" && rincian.holdUntil;
    const sampai = sudah ? (rincian.holdUntil as string) : batasSimpanDari(new Date(), rincian.hariSimpan);
    const teks = pesanTitipTersedia({ ...rincian.pesan, sampai });
    window.open(`https://wa.me/${rincian.pesan.nomorWa}?text=${encodeURIComponent(teks)}`, "_blank", "noopener,noreferrer");
    if (sudah) return;
    const id = rincian.id;
    jalankan(
      () => tandaiDikabariAction({ requestId: id }),
      () => t("rincian.okDikabari"),
    );
  }

  const keteranganKabari = !rincian.pembeli.adaWa
    ? t("rincian.tanpaWa")
    : rincian.status === "MENUNGGU" && rincian.stok === 0
      ? t("rincian.belumAda")
      : null;

  return (
    <div className="space-y-4 p-4">
      {kembali}

      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="min-w-0 break-words text-2xl font-bold">{rincian.keterangan}</h1>
          <TombolBantuanHp judul={rincian.keterangan} />
        </div>
        <span
          className={cn(
            "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
            rincian.lewat ? "bg-destructive/10 text-destructive" : nadaKelompokTitip(rincian.kelompok, rincian.status),
          )}
        >
          {rincian.lewat ? t("lewatMasaSimpan") : rincian.kelompok === "tutup" ? td(`status.${rincian.status}`) : td(`kelompok.${rincian.kelompok}`)}
        </span>
      </header>

      <Link href={`/pwa/spg/pelanggan/${rincian.pembeli.id}`} className="beranda-kartu flex items-center gap-3 transition-colors hover:bg-muted/60">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <UserRound className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words font-medium leading-tight">{rincian.pembeli.nama}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">{rincian.pembeli.hp}</span>
        </span>
      </Link>

      <section className="beranda-kartu space-y-2 text-sm">
        {rincian.barang ? (
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("rincian.barang")}</span>
            <span className="min-w-0 break-words text-right">
              {rincian.barang.nama}
              <span className="block text-xs text-muted-foreground">{rincian.barang.varian ?? t("rincian.varianApaSaja")}</span>
            </span>
          </p>
        ) : (
          <p className="text-muted-foreground">{t("rincian.bebas")}</p>
        )}
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">{t("rincian.jumlah")}</span>
          <span className="text-right tabular-nums">{t("rincian.pcs", { n: rincian.qty })}</span>
        </p>
        {rincian.stok !== null && terbuka ? (
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("rincian.stokToko")}</span>
            <span className="text-right tabular-nums">{rincian.stok > 0 ? t("stokAda", { n: rincian.stok }) : t("stokBelum")}</span>
          </p>
        ) : null}
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">{t("rincian.dicatat")}</span>
          <span className="text-right">{rincian.dibuat[bahasa]}</span>
        </p>
        {rincian.dikabariPada ? (
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("rincian.dikabari")}</span>
            <span className="text-right">{rincian.dikabariPada[bahasa]}</span>
          </p>
        ) : null}
        {rincian.sampai ? (
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("rincian.disimpanSampai")}</span>
            <span className={cn("text-right", rincian.lewat && "font-semibold text-destructive")}>{rincian.sampai[bahasa]}</span>
          </p>
        ) : null}
        {rincian.ditutupPada ? (
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("rincian.ditutup")}</span>
            <span className="text-right">{rincian.ditutupPada[bahasa]}</span>
          </p>
        ) : null}
        {rincian.dariNota ? <p className="rounded-lg bg-muted px-3 py-2">{t("rincian.selesaiLewatNota", { docNo: rincian.dariNota })}</p> : null}
        {rincian.alasanTutup ? <p className="rounded-lg bg-muted px-3 py-2">{t("rincian.alasanTutup", { alasan: rincian.alasanTutup })}</p> : null}
        {rincian.dariDicari ? <p className="text-xs text-muted-foreground">{t("rincian.dariDicari")}</p> : null}
      </section>

      {terbuka ? (
        <div className="space-y-2">
          <Button type="button" size="lg" className="w-full" onClick={kabari} disabled={pending || !rincian.bolehKabari}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageCircle className="h-4 w-4" aria-hidden />}
            {rincian.status === "DIKABARI" ? t("rincian.kabariLagi") : t("rincian.kabari")}
          </Button>
          <KeteranganKirim teks={rincian.bolehKabari ? null : keteranganKabari} />
          {minta ? (
            <div className="space-y-1">
              <Button asChild variant="outline" size="lg" className="w-full">
                <Link href={minta.alamat}>
                  <Truck className="h-4 w-4" aria-hidden />
                  {t("minta.tombol")}
                </Link>
              </Button>
              {!minta.dariKatalog ? <p className="px-1 text-xs text-muted-foreground">{t("minta.tanpaBarang")}</p> : null}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal py-2" onClick={() => setSelesaiBuka(true)} disabled={pending}>
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              {t("rincian.sudahDiambil")}
            </Button>
            <Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal py-2" onClick={() => setBatalBuka(true)} disabled={pending}>
              <XCircle className="h-4 w-4 shrink-0" aria-hidden />
              {t("rincian.batalkan")}
            </Button>
          </div>
        </div>
      ) : null}

      <AlertDialog open={selesaiBuka} onOpenChange={(v) => !pending && setSelesaiBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rincian.selesaiJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rincian.selesaiIsi", { nama: rincian.pembeli.nama })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("rincian.jangan")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                jalankan(
                  () => tutupTitipanAction({ requestId: rincian.id, hasil: "SELESAI" }),
                  () => t("rincian.okSelesai"),
                  () => setSelesaiBuka(false),
                );
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("rincian.yaSelesai")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={batalBuka}
        onOpenChange={(v) => {
          if (pending) return;
          setBatalBuka(v);
          if (!v) setAlasan("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rincian.batalJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rincian.batalIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="titip-batal-alasan">{t("rincian.batalAlasan")}</Label>
            <Textarea
              id="titip-batal-alasan"
              value={alasan}
              rows={2}
              maxLength={BATAS_ALASAN_TITIP}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t("rincian.batalContoh")}
              disabled={pending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("rincian.jangan")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending || alasan.trim() === ""}
              onClick={(e) => {
                e.preventDefault();
                jalankan(
                  () => tutupTitipanAction({ requestId: rincian.id, hasil: "BATAL", alasan: alasan.trim() }),
                  () => t("rincian.okBatal"),
                  () => {
                    setBatalBuka(false);
                    setAlasan("");
                  },
                );
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("rincian.yaBatalkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
