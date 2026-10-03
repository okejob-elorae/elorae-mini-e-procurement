"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, MessageCircle, PencilLine, Store, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { batalkanPesananSayaAction } from "../actions";
import { PANJANG_ALASAN_BATAL_MAKS } from "@/lib/field-sales/ganti-pesanan";
import type {
  BarisDetailPesananSaya,
  CatatanKredit,
  KeadaanPesanan,
  LangkahLinimasa,
} from "@/lib/field-sales/pwa-queries";
import { formatIDR } from "@/lib/sales-orders/format";
import { cn } from "@/lib/utils";
import { NADA_KEADAAN } from "../PesananSayaClient";
import { LencanaJarakJauh } from "./LencanaJarakJauh";
import { BuktiTerimaPengiriman, type KirimanTampil } from "./BuktiTerimaPengiriman";

import { TautanKembali } from "@/app/pwa/TautanKembali";
/** Langkah linimasa dengan waktu yang sudah diformat server (dibagi per jenis, supaya `docNo`/`alasan` tetap terbaca). */
type WaktuTeks<T> = T extends unknown ? Omit<T, "waktu"> & { waktu: string } : never;
type LangkahTampil = WaktuTeks<LangkahLinimasa>;

export type DetailPesananView = {
  id: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  orderType: "PUTUS" | "KONSI";
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  keadaan: KeadaanPesanan;
  /** Sudah diformat di server. */
  dibuat: string;
  note: string | null;
  rejectReason: string | null;
  closeReason: string | null;
  subtotal: number | null;
  potonganBaris: number | null;
  orderDiscountAmount: number | null;
  appliedOrderPromoName: string | null;
  total: number | null;
  jumlahPcs: number;
  kreditDitahan: boolean;
  /** Pesanan jarak jauh (WA/TELEPON/LAINNYA); null = diambil saat kunjungan. */
  remoteChannel?: string | null;
  kreditCatatan: CatatanKredit | null;
  baris: BarisDetailPesananSaya[];
  linimasa: LangkahTampil[];
  /** Dibatalkan salesman sendiri (status REJECTED, bukan ditolak kantor). */
  dibatalkan?: boolean;
  /** Pesanan lama yang digantikan pesanan ini. */
  menggantikan?: { id: string; orderNo: string } | null;
  /** Pesanan baru yang menggantikan pesanan ini. */
  digantiDengan?: { id: string; orderNo: string } | null;
};

/** Kotak keterangan di bawah judul: apa yang sedang terjadi pada pesanan ini. */
const NADA_KOTAK = {
  tunggu: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  buruk: "bg-destructive/10 text-red-800 dark:text-red-300",
  jalan: "bg-primary/15 text-foreground",
  selesai: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  diam: "bg-muted text-muted-foreground",
} as const;

/** Lencana "Dibatalkan": abu-abu, bukan merah — keputusan salesman sendiri, bukan penolakan kantor. */
const NADA_DIBATALKAN = "bg-muted text-muted-foreground";

export function DetailPesananClient({
  pesanan: p,
  kiriman = [],
  alamatUbah = null,
  bisaBatal = false,
  salinanWa = null,
}: {
  pesanan: DetailPesananView;
  /** Pengiriman + bukti terimanya (PUTUS saja); tanggalnya sudah diformat server. */
  kiriman?: KirimanTampil[];
  /** Alamat katalog untuk mengubah pesanan (hanya selagi menunggu); null = tidak bisa diubah. */
  alamatUbah?: string | null;
  /** Pesanan masih menunggu dan milik Anda: boleh dibatalkan. */
  bisaBatal?: boolean;
  /** Salinan pesanan untuk toko lewat WhatsApp; null untuk pesanan yang ditolak/dibatalkan. */
  salinanWa?: { tautan: string; adaNomor: boolean } | null;
}) {
  const t = useTranslations("pwa.pesananSaya");
  const td = useTranslations("pwa.pesananSaya.detail");
  const tUbah = useTranslations("pwa.ubahPesanan");
  const putusDisetujui = p.orderType === "PUTUS" && p.status === "APPROVED";
  const alasanTolak = p.rejectReason?.trim();
  const alasanTutup = p.closeReason?.trim();
  const langkahBerikut =
    p.keadaan === "MENUNGGU"
      ? td("stepNextApproval")
      : p.keadaan === "BELUM_DIKIRIM" || p.keadaan === "DIKIRIM_SEBAGIAN"
        ? td("stepNextDelivery")
        : null;

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/orders" />
      </Button>

      <header className="space-y-2">
        <p className="font-mono text-xs text-muted-foreground">{p.orderNo}</p>
        <h1 className="text-2xl font-bold leading-tight">{p.storeName}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("border-transparent", p.dibatalkan ? NADA_DIBATALKAN : NADA_KEADAAN[p.keadaan])}>
            {p.dibatalkan ? tUbah("lencanaDibatalkan") : t(`keadaan.${p.keadaan}`)}
          </Badge>
          <Badge variant="outline">{t(`type.${p.orderType}`)}</Badge>
          <LencanaJarakJauh saluran={p.remoteChannel} />
        </div>
        <TautanGanti menggantikan={p.menggantikan ?? null} digantiDengan={p.digantiDengan ?? null} />
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <span>{td("created", { date: p.dibuat })}</span>
          <Link
            href={`/pwa/stores/${p.storeId}`}
            className="inline-flex min-h-11 items-center gap-1 font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4"
          >
            <Store className="h-3.5 w-3.5" aria-hidden />
            {td("openStore")}
          </Link>
        </p>
      </header>

      <Keterangan p={p} alasanTolak={alasanTolak} alasanTutup={alasanTutup} />

      {salinanWa || alamatUbah || bisaBatal ? (
        <section aria-label={tUbah("tindakanLabel")} className="flex flex-col gap-2">
          {salinanWa ? (
            <div className="flex flex-col gap-1">
              <Button asChild>
                <a href={salinanWa.tautan} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  {tUbah("waKirim")}
                </a>
              </Button>
              {!salinanWa.adaNomor ? <p className="text-xs text-muted-foreground">{tUbah("waTanpaNomor")}</p> : null}
            </div>
          ) : null}
          {alamatUbah || bisaBatal ? (
            <div className="grid grid-cols-2 gap-2">
              {alamatUbah ? (
                <Button asChild variant="outline">
                  <Link href={alamatUbah}>
                    <PencilLine className="h-4 w-4" aria-hidden />
                    {tUbah("tombolUbah")}
                  </Link>
                </Button>
              ) : null}
              {bisaBatal ? <TombolBatal orderId={p.id} orderNo={p.orderNo} /> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="beranda-kartu beranda-kartu-daftar">
        <h2 className="beranda-judul px-4 pt-4">{td("linesTitle", { count: p.baris.length })}</h2>
        <ul className="mt-1 divide-y">
          {p.baris.map((b) => (
            <BarisBarang key={b.id} b={b} putusDisetujui={putusDisetujui} />
          ))}
        </ul>
      </section>

      {/* Konsi yang ditolak tidak pernah diberi nilai — kartunya tidak punya isi yang benar. */}
      {p.total === null && p.status === "REJECTED" ? null : (
      <section className="beranda-kartu">
        <h2 className="beranda-judul">{td("totalsTitle")}</h2>
        {p.total === null ? (
          <p className="mt-2 text-sm text-muted-foreground">{td("konsiHidden")}</p>
        ) : (
          <dl className="mt-2 space-y-1 text-sm">
            {p.subtotal !== null ? <BarisNilai label={td("subtotal")} nilai={formatIDR(p.subtotal)} /> : null}
            {p.potonganBaris ? <BarisNilai label={td("lineDiscount")} nilai={`−${formatIDR(p.potonganBaris)}`} /> : null}
            {p.orderDiscountAmount ? (
              <BarisNilai
                label={p.appliedOrderPromoName ? td("orderDiscountPromo", { name: p.appliedOrderPromoName }) : td("orderDiscount")}
                nilai={`−${formatIDR(p.orderDiscountAmount)}`}
              />
            ) : null}
            <div className="flex items-baseline justify-between gap-3 border-t pt-2">
              <dt className="font-semibold">{td("total")}</dt>
              <dd className={cn("text-lg font-bold tabular-nums", p.status === "REJECTED" && "text-muted-foreground line-through")}>
                {formatIDR(p.total)}
              </dd>
            </div>
          </dl>
        )}
      </section>
      )}

      {p.kreditCatatan ? <KartuKredit catatan={p.kreditCatatan} /> : null}

      <section className="beranda-kartu">
        <h2 className="beranda-judul">{td("timelineTitle")}</h2>
        <ol className="mt-3 space-y-3">
          {p.linimasa.map((l, i) => (
            <li key={`${l.jenis}-${i}`} className="flex gap-3">
              <span
                className={cn(
                  "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                  l.jenis === "DITOLAK"
                    ? "bg-destructive"
                    : l.jenis === "DITUTUP" || l.jenis === "DIBATALKAN"
                      ? "bg-muted-foreground"
                      : "bg-primary",
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {l.jenis === "DIKIRIM"
                    ? td("step.DIKIRIM", { docNo: l.docNo })
                    : l.jenis === "DIBATALKAN"
                      ? tUbah("langkahDibatalkan")
                      : td(`step.${l.jenis}`)}
                </span>
                <span className="block text-xs text-muted-foreground">{l.waktu}</span>
                {l.jenis === "DIKIRIM" ? (
                  <span className="block text-xs tabular-nums">{td("stepDelivery", { pcs: l.pcs, value: formatIDR(l.nilai) })}</span>
                ) : null}
                {(l.jenis === "DITOLAK" || l.jenis === "DITUTUP" || l.jenis === "DIBATALKAN") && l.alasan?.trim() ? (
                  <span className="block text-xs">{td("stepReason", { reason: l.alasan.trim() })}</span>
                ) : null}
              </span>
            </li>
          ))}
          {langkahBerikut ? (
            <li className="flex gap-3 text-muted-foreground">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-muted-foreground/50" aria-hidden />
              <span className="text-sm">{langkahBerikut}</span>
            </li>
          ) : null}
        </ol>
      </section>

      <BuktiTerimaPengiriman orderId={p.id} storeName={p.storeName} kiriman={kiriman} />

      {p.note?.trim() ? (
        <section className="beranda-kartu">
          <h2 className="beranda-judul">{td("noteTitle")}</h2>
          <p className="mt-2 whitespace-pre-line text-sm">{p.note.trim()}</p>
        </section>
      ) : null}
    </div>
  );
}

function Keterangan({
  p,
  alasanTolak,
  alasanTutup,
}: {
  p: DetailPesananView;
  alasanTolak: string | undefined;
  alasanTutup: string | undefined;
}) {
  const td = useTranslations("pwa.pesananSaya.detail");
  const kotak = (nada: keyof typeof NADA_KOTAK, isi: React.ReactNode) => (
    <div className={cn("space-y-1 rounded-lg px-3 py-2 text-sm leading-relaxed", NADA_KOTAK[nada])}>{isi}</div>
  );

  switch (p.keadaan) {
    case "MENUNGGU":
      return kotak(
        "tunggu",
        <>
          <p>{td("noticePending")}</p>
          {p.kreditDitahan ? <p className="font-medium">{td("noticeCreditHeld")}</p> : null}
        </>,
      );
    case "DITOLAK":
      if (p.dibatalkan) return <KeteranganDibatalkan p={p} alasan={alasanTolak} />;
      return kotak(
        "buruk",
        <>
          <p className="font-semibold">{td("noticeRejected")}</p>
          <p>{alasanTolak ? alasanTolak : td("noticeRejectedNoReason")}</p>
        </>,
      );
    case "BELUM_DIKIRIM":
      return kotak("jalan", <p>{td("noticeWaitingDelivery")}</p>);
    case "DIKIRIM_SEBAGIAN":
      return kotak("jalan", <p>{td("noticePartial")}</p>);
    case "DITUTUP":
      return kotak(
        "diam",
        <>
          <p className="font-medium">{td("noticeClosed")}</p>
          {alasanTutup ? <p>{alasanTutup}</p> : null}
        </>,
      );
    case "KONSI_DISETUJUI":
      return kotak("selesai", <p>{td("noticeKonsi")}</p>);
    default:
      return null;
  }
}

function BarisBarang({ b, putusDisetujui }: { b: BarisDetailPesananSaya; putusDisetujui: boolean }) {
  const td = useTranslations("pwa.pesananSaya.detail");
  const tBonus = useTranslations("promoBonus");
  // Pembagian kirim/batal hanya bermakna untuk PUTUS yang sudah disetujui; konsi tidak punya kiriman.
  const bagian = putusDisetujui
    ? [
        b.deliveredQty > 0 ? { kunci: "delivered", qty: b.deliveredQty, nada: "text-emerald-700 dark:text-emerald-400" } : null,
        b.outstanding > 0 ? { kunci: "outstanding", qty: b.outstanding, nada: "text-primary" } : null,
        b.cancelledQty > 0 ? { kunci: "cancelled", qty: b.cancelledQty, nada: "text-muted-foreground" } : null,
      ].filter((x): x is { kunci: "delivered" | "outstanding" | "cancelled"; qty: number; nada: string } => x !== null)
    : [];

  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-medium leading-tight">{b.productName}</span>
          {b.variantLabel || b.variantSku ? (
            <span className="block text-xs text-muted-foreground">{b.variantLabel ?? b.variantSku}</span>
          ) : null}
          {b.isBonus ? (
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                {tBonus("lencana")}
              </Badge>
              {b.bonusPromoName ? <span className="text-xs text-muted-foreground">{b.bonusPromoName}</span> : null}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular-nums">{td("qty", { qty: b.qty })}</span>
          {b.lineTotal !== null ? <span className="block text-xs tabular-nums text-muted-foreground">{formatIDR(b.lineTotal)}</span> : null}
        </span>
      </div>

      {b.unitPrice !== null ? (
        <p className="text-xs tabular-nums text-muted-foreground">{td("perPcs", { price: formatIDR(b.unitPrice) })}</p>
      ) : null}

      {bagian.length > 0 ? (
        <p className="flex flex-wrap gap-x-3 text-xs font-medium tabular-nums">
          {bagian.map((x) => (
            <span key={x.kunci} className={x.nada}>
              {td(x.kunci, { qty: x.qty })}
            </span>
          ))}
        </p>
      ) : null}

      {b.discountAmount && b.appliedPromoName ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {td("linePromo", { name: b.appliedPromoName, amount: formatIDR(b.discountAmount) })}
        </p>
      ) : null}

      {b.banding ? (
        <div className="space-y-0.5 rounded-md border px-3 py-2 text-xs">
          <p className="font-semibold">{td("appealTitle")}</p>
          <p className="tabular-nums">{td("appealRequested", { price: formatIDR(b.banding.requestedUnitPrice) })}</p>
          {b.banding.appealReason?.trim() ? <p className="text-muted-foreground">{td("appealReason", { reason: b.banding.appealReason.trim() })}</p> : null}
          <p
            className={cn(
              "font-medium",
              b.banding.hasil === "MENUNGGU" && "text-amber-800 dark:text-amber-300",
              b.banding.hasil === "SESUAI" && "text-emerald-700 dark:text-emerald-400",
              b.banding.hasil === "BERBEDA" && "text-primary",
              b.banding.hasil === "BATAL" && "text-muted-foreground",
            )}
          >
            {td(`appeal.${b.banding.hasil}`, { price: formatIDR(b.banding.hargaAkhir ?? 0) })}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function BarisNilai({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{nilai}</dd>
    </div>
  );
}

function KartuKredit({ catatan }: { catatan: CatatanKredit }) {
  const td = useTranslations("pwa.pesananSaya.detail");
  return (
    <section className="beranda-kartu">
      <div className="flex items-center justify-between gap-2">
        <h2 className="beranda-judul">{td("creditTitle")}</h2>
        {catatan.jenis === "terstruktur" && catatan.tingkat ? (
          <Badge
            variant="outline"
            className={cn(
              "border-transparent",
              catatan.tingkat === "AMAN" ? NADA_KOTAK.selesai : catatan.tingkat === "PERINGATAN" ? NADA_KOTAK.tunggu : NADA_KOTAK.buruk,
            )}
          >
            {td(`creditLevel.${catatan.tingkat}`)}
          </Badge>
        ) : null}
      </div>
      {catatan.jenis === "teks" ? (
        <p className="mt-2 whitespace-pre-line text-sm">{catatan.teks}</p>
      ) : (
        <div className="mt-2 space-y-1 text-sm">
          {catatan.alasan.length === 0 ? <p className="text-muted-foreground">{td("creditNone")}</p> : null}
          {catatan.alasan.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5">
              {catatan.alasan.map((a, i) => (
                <li key={`${a.kode}-${i}`}>
                  {a.kode === "LEWAT_JANJI"
                    ? td("creditReason.LEWAT_JANJI", { count: a.faktur, value: formatIDR(a.nilai) })
                    : a.kode === "MELEBIHI_BATAS_NILAI"
                      ? td("creditReason.MELEBIHI_BATAS_NILAI", { value: formatIDR(a.sisaSesudah), limit: formatIDR(a.batas) })
                      : td("creditReason.MELEBIHI_BATAS_FAKTUR", { count: a.faktur, limit: a.batas })}
                </li>
              ))}
            </ul>
          ) : null}
          {catatan.keadaan ? (
            <p className="text-xs text-muted-foreground">
              {td("creditState", { value: formatIDR(catatan.keadaan.sisa), count: catatan.keadaan.fakturTerbuka })}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** "Menggantikan …" / "Diganti dengan …": pesanan yang diubah salesman berpasangan, keduanya bisa dibuka. */
function TautanGanti({
  menggantikan,
  digantiDengan,
}: {
  menggantikan: { id: string; orderNo: string } | null;
  digantiDengan: { id: string; orderNo: string } | null;
}) {
  const tUbah = useTranslations("pwa.ubahPesanan");
  if (!menggantikan && !digantiDengan) return null;
  const tautan = (o: { id: string; orderNo: string }) => (
    <Link
      href={`/pwa/orders/${o.id}`}
      className="inline-flex min-h-11 items-center font-mono font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4"
    >
      {o.orderNo}
    </Link>
  );
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
      {menggantikan ? (
        <>
          <span>{tUbah("menggantikan")}</span>
          {tautan(menggantikan)}
        </>
      ) : null}
      {digantiDengan ? (
        <>
          <span>{tUbah("digantiDengan")}</span>
          {tautan(digantiDengan)}
        </>
      ) : null}
    </p>
  );
}

function KeteranganDibatalkan({ p, alasan }: { p: DetailPesananView; alasan: string | undefined }) {
  const tUbah = useTranslations("pwa.ubahPesanan");
  return (
    <div className={cn("space-y-1 rounded-lg px-3 py-2 text-sm leading-relaxed", NADA_KOTAK.diam)}>
      <p className="font-semibold text-foreground">
        {p.digantiDengan ? tUbah("keteranganDiganti", { orderNo: p.digantiDengan.orderNo }) : tUbah("keteranganDibatalkan")}
      </p>
      {!p.digantiDengan && alasan ? <p>{tUbah("alasanDibatalkan", { alasan })}</p> : null}
    </div>
  );
}

/** Batalkan pesanan sendiri — alasan wajib; kantor membacanya di pesanan itu. */
function TombolBatal({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  const tUbah = useTranslations("pwa.ubahPesanan");
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [sibuk, mulai] = useTransition();
  const bersih = alasan.trim();

  const kirim = () => {
    if (!bersih) return;
    mulai(async () => {
      try {
        const r = await batalkanPesananSayaAction(orderId, bersih);
        if (r.ok) {
          toast.success(tUbah("batalBerhasil", { orderNo: r.orderNo }));
          setBuka(false);
          setAlasan("");
          router.refresh();
          return;
        }
        toast.error(tUbah(`batalGagal.${r.code}`));
        if (r.code === "SUDAH_DIPUTUSKAN") {
          setBuka(false);
          router.refresh();
        }
      } catch {
        toast.error(tUbah("batalGagal.GAGAL"));
      }
    });
  };

  return (
    <>
      <Button type="button" variant="outline" className="text-destructive" onClick={() => setBuka(true)}>
        <XCircle className="h-4 w-4" aria-hidden />
        {tUbah("tombolBatal")}
      </Button>
      <AlertDialog open={buka} onOpenChange={(v) => !sibuk && setBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tUbah("dialogJudul", { orderNo })}</AlertDialogTitle>
            <AlertDialogDescription>{tUbah("dialogIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`alasan-batal-${orderId}`} className="text-sm font-medium">
              {tUbah("alasanLabel")}
            </label>
            <Textarea
              id={`alasan-batal-${orderId}`}
              value={alasan}
              maxLength={PANJANG_ALASAN_BATAL_MAKS}
              rows={3}
              placeholder={tUbah("alasanContoh")}
              onChange={(e) => setAlasan(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{tUbah("dialogKembali")}</AlertDialogCancel>
            {/* Tombol biasa, bukan AlertDialogAction: dialog tetap terbuka sampai server menjawab. */}
            <Button type="button" variant="destructive" disabled={!bersih || sibuk} onClick={kirim}>
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {sibuk ? tUbah("dialogMembatalkan") : tUbah("dialogYa")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
