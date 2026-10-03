"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList, Loader2, MapPin, MessageCircle, ShoppingCart, XCircle } from "lucide-react";
import { ubahPermintaanSpgAction, type HasilPermintaanSpg } from "@/app/actions/permintaan-spg";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { tulisSumberKeranjang } from "@/lib/field-sales/isi-keranjang-sumber";
import { dinamis } from "@/lib/i18n/dinamis";
import type { RincianPermintaanMasuk } from "@/lib/spg/permintaan-salesman";
import { cn } from "@/lib/utils";
import { nadaStatusPermintaan } from "../tampilan";

type Rincian = RincianPermintaanMasuk & { dibuatLabel: string; ditanganiLabel: string | null };

const KODE_GALAT = new Set([
  "VALIDATION",
  "UNAUTHORIZED",
  "TANPA_AKSES",
  "TIDAK_DITEMUKAN",
  "BUKAN_PEMEGANG",
  "STATUS_TIDAK_BOLEH",
  "ALASAN_WAJIB",
]);

/**
 * Rincian satu permintaan SPG untuk salesman pemegang toko: barang + alasan
 * tiap baris, catatan SPG, dan tiga jalan keluar — buatkan pesanan (katalog
 * dengan keranjang terisi), tandai selesai, atau tolak dengan alasan.
 *
 * Membuat pesanan TIDAK lewat aksi di sini: katalog yang mengisi keranjang dan
 * pesanan yang tercatat menautkan permintaan ini sendiri (DIPROSES + kabar ke
 * SPG). Pesanan tetap melewati penulis pesanan biasa — harga server, minimum,
 * kredit, persetujuan kantor.
 */
export function RincianPermintaanClient({
  rincian: r,
  bolehUbah,
  pesan,
}: {
  rincian: Rincian;
  bolehUbah: boolean;
  /** null = tidak bisa dibuatkan pesanan di sini (bukan pemegang, sudah ada pesanan, atau sudah selesai). */
  pesan: { diToko: boolean; jarakJauh: boolean } | null;
}) {
  const t = useTranslations("pwaPermintaanSpg");
  const td = dinamis(t);
  const tAlasan = dinamis(useTranslations("alasanPermintaanSpg"));
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [selesaiBuka, setSelesaiBuka] = useState(false);
  const [tolakBuka, setTolakBuka] = useState(false);
  const [catatan, setCatatan] = useState("");

  const isi = encodeURIComponent(tulisSumberKeranjang({ jenis: "permintaan", id: r.id }));
  const katalog = `/pwa/stores/${r.toko.id}/catalog?isi=${isi}`;
  const katalogJarakJauh = `/pwa/stores/${r.toko.id}/catalog?jarakJauh=LAINNYA&isi=${isi}`;

  const jalankan = (status: "SELESAI" | "DITOLAK", tutup: () => void) =>
    mulai(async () => {
      let hasil: HasilPermintaanSpg;
      try {
        hasil = await ubahPermintaanSpgAction({ requestId: r.id, status, note: catatan.trim() || undefined });
      } catch {
        toast.error(t("err.NETWORK"));
        return;
      }
      if (!hasil.ok) {
        toast.error(td(KODE_GALAT.has(hasil.code) ? `err.${hasil.code}` : "err.GENERIC"));
        router.refresh();
        return;
      }
      tutup();
      setCatatan("");
      toast.success(status === "SELESAI" ? t("detail.okDone") : t("detail.okRejected"));
      router.refresh();
    });

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/permintaan" />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{r.toko.nama}</h1>
        <p className="text-sm text-muted-foreground">{t("meta", { name: r.peminta, when: r.dibuatLabel })}</p>
        <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusPermintaan(r.status))}>
          {td(`status.${r.status}`)}
        </span>
      </header>

      {r.catatan ? (
        <section className="beranda-kartu space-y-1 text-sm">
          <p className="text-muted-foreground">{t("detail.spgNote")}</p>
          <p className="whitespace-pre-line">{r.catatan}</p>
        </section>
      ) : null}

      <section className="space-y-2" aria-labelledby="judul-baris-permintaan">
        <h2 id="judul-baris-permintaan" className="beranda-judul px-1">
          {t("detail.linesTitle", { count: r.baris.length, pcs: r.totalQty })}
        </h2>
        <ul className="beranda-kartu beranda-kartu-daftar divide-y">
          {r.baris.map((b) => (
            <li key={b.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium leading-tight">{b.productName}</p>
                {b.variantSku ? <p className="truncate text-xs text-muted-foreground">{b.variantSku}</p> : null}
                <Badge variant="outline" className="font-normal">
                  {tAlasan(b.alasan ?? "MANUAL")}
                </Badge>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{t("detail.qty", { n: b.qty })}</span>
            </li>
          ))}
        </ul>
      </section>

      {r.pesanan ? (
        <section className="beranda-kartu flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <ClipboardList className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-tight">{t("detail.orderTitle", { orderNo: r.pesanan.orderNo })}</p>
            <p className="text-xs text-muted-foreground">{td(`detail.orderStatus.${r.pesanan.status}`)}</p>
          </div>
          {r.pesanan.milikSaya ? (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href={`/pwa/orders/${r.pesanan.id}`}>{t("detail.openOrder")}</Link>
            </Button>
          ) : null}
        </section>
      ) : null}

      {r.status !== "BARU" && (r.ditangani.oleh || r.ditangani.catatan) ? (
        <section
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            r.status === "DITOLAK" ? "bg-destructive/10 text-destructive" : "bg-muted",
          )}
        >
          {r.status === "DITOLAK"
            ? t("detail.rejectedBy", { name: r.ditangani.oleh ?? "—", note: r.ditangani.catatan ?? "—" })
            : r.ditangani.catatan
              ? t("detail.noteBy", { name: r.ditangani.oleh ?? "—", note: r.ditangani.catatan })
              : t("detail.handledBy", { name: r.ditangani.oleh ?? "—" })}
          {r.ditanganiLabel ? <span className="block text-xs opacity-80">{r.ditanganiLabel}</span> : null}
        </section>
      ) : null}

      {pesan ? (
        <section className="space-y-2" aria-labelledby="judul-buat-pesanan">
          <h2 id="judul-buat-pesanan" className="beranda-judul px-1">
            {t("detail.orderAction")}
          </h2>
          {pesan.diToko ? (
            <Button asChild className="w-full" size="lg">
              <Link href={katalog}>
                <ShoppingCart className="h-4 w-4" aria-hidden />
                {t("detail.makeOrder")}
              </Link>
            </Button>
          ) : (
            <div className="beranda-kartu space-y-3">
              <p className="text-sm">{t("detail.notCheckedIn", { store: r.toko.nama })}</p>
              <Button asChild className="w-full">
                <Link href={`/pwa/stores/${r.toko.id}`}>
                  <MapPin className="h-4 w-4" aria-hidden />
                  {t("detail.openStore")}
                </Link>
              </Button>
              {pesan.jarakJauh ? (
                <>
                  <Button asChild variant="outline" className="w-full">
                    <Link href={katalogJarakJauh}>
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      {t("detail.remoteOrder")}
                    </Link>
                  </Button>
                  <p className="text-xs text-muted-foreground">{t("detail.remoteHint")}</p>
                </>
              ) : null}
            </div>
          )}
          <p className="px-1 text-xs text-muted-foreground">{t("detail.orderHint")}</p>
        </section>
      ) : null}

      {bolehUbah ? (
        <div className="space-y-2">
          <Button variant="outline" className="w-full" disabled={pending} onClick={() => setSelesaiBuka(true)}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t("detail.markDone")}
          </Button>
          <Button variant="outline" className="w-full text-destructive" disabled={pending} onClick={() => setTolakBuka(true)}>
            <XCircle className="h-4 w-4" aria-hidden />
            {t("detail.reject")}
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={selesaiBuka}
        onOpenChange={(v) => {
          if (pending) return;
          setSelesaiBuka(v);
          if (!v) setCatatan("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.doneTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.doneBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="permintaan-catatan-selesai">{t("detail.doneNoteLabel")}</Label>
            <Textarea
              id="permintaan-catatan-selesai"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value.slice(0, 500))}
              rows={2}
              disabled={pending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("detail.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                jalankan("SELESAI", () => setSelesaiBuka(false));
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("detail.confirmDone")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={tolakBuka}
        onOpenChange={(v) => {
          if (pending) return;
          setTolakBuka(v);
          if (!v) setCatatan("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.rejectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.rejectBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="permintaan-alasan-tolak">{t("detail.rejectReasonLabel")}</Label>
            <Textarea
              id="permintaan-alasan-tolak"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value.slice(0, 500))}
              rows={3}
              disabled={pending}
              placeholder={t("detail.rejectReasonPlaceholder")}
            />
          </div>
          <KeteranganKirim teks={!pending && catatan.trim() === "" ? t("detail.whyReason") : null} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("detail.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || catatan.trim() === ""}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                jalankan("DITOLAK", () => setTolakBuka(false));
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("detail.confirmReject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
