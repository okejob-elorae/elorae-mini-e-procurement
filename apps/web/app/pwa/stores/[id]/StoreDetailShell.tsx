"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  Clock,
  MapPin,
  MessageCircle,
  Phone,
  ShoppingBag,
  User as UserIcon,
} from "lucide-react";
import { CheckInButton } from "./CheckInButton";
import { CheckOutButton } from "./CheckOutButton";
import { VisitPhotoCapture } from "./VisitPhotoCapture";
import { StoreEditForm } from "./StoreEditForm";
import { StoreChangePendingCard } from "./StoreChangePendingCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { nomorTelepon, tautanWhatsApp } from "@/lib/salesman/dasbor";
import { SaranPesanan, type SaranPesananProps } from "./SaranPesanan";
import { TombolPesananJarakJauh } from "./TombolPesananJarakJauh";
import { AksiKunjungan } from "./AksiKunjungan";
import { RingkasanToko, type RingkasanTokoView } from "./RingkasanToko";
import { formatRupiah } from "@/lib/format/rupiah";

import { TautanKembali } from "@/app/pwa/TautanKembali";
type StoreProps = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: "PUTUS" | "KONSI";
  paymentTempo: number;
  marginPercent: number | null;
  lat: number | null;
  lng: number | null;
};

type ActiveProps = {
  id: string;
  storeId: string;
  storeName: string;
  checkinOutOfRadius: boolean;
  checkinDistanceMeters: number | null;
  /** Jam check-in (WIB), diformat di server. */
  sejakLabel: string;
} | null;

type HistoryRow = {
  id: string;
  /** Sudah diformat di server (hindari hydration error Safari). */
  checkinLabel: string;
  checkoutLabel: string | null;
  checkinLat: number;
  checkinLng: number;
  autoClosed: boolean;
  userLabel: string;
};

type SyncedPhoto = { id: string; url: string; caption: string | null; capturedAtIso: string };

type ChangeFields = {
  name: string; address: string; phone: string | null; contactName: string | null; lat: number | null; lng: number | null;
};

type PendingProps = { proposed: ChangeFields; old: ChangeFields; requestedByLabel: string } | null;

type OrderRow = {
  id: string;
  orderNo: string;
  orderType: "PUTUS" | "KONSI";
  status: "PENDING_APPROVAL" | "APPROVED";
  total: number | null;
  /** Sudah diformat di server. */
  createdLabel: string;
};

type Props = {
  saran: SaranPesananProps;
  /** null untuk SPG — kartu ringkasan hanya untuk salesman keliling. */
  ringkasan: RingkasanTokoView | null;
  store: StoreProps;
  active: ActiveProps;
  activePhotos: SyncedPhoto[];
  history: HistoryRow[];
  pending: PendingProps;
  orders: OrderRow[];
  /** Kartu "Stok di toko ini" (toko konsinyasi) — dirakit di page.tsx, null kalau tidak berlaku. */
  /** Aturan pemilik mengizinkan pesanan lewat WA/telepon untuk toko ini (dinilai di server). */
  bolehJarakJauh?: boolean;
  /** Tombol tautan portal toko — hanya untuk pemegang toko (dinilai di server). */
  portalToko?: React.ReactNode;
  /** Tombol pre-order (inden) — hanya ada selama jendela pre-order buka (dinilai di server). */
  preorder?: React.ReactNode;
  /** Kartu "Catatan toko" — dirakit di page.tsx; null bila tidak boleh dilihat. */
  catatanToko?: React.ReactNode;
  stokDiToko?: React.ReactNode;
  /** Kartu "Yang perlu ditawarkan" (salesman keliling) — dirakit di page.tsx, null untuk SPG. */
  saranTawar?: React.ReactNode;
  /**
   * SPG di toko tetapnya (dinilai di server dari `ambilTokoTetap`). SPG tidak
   * mengambil pesanan lapangan dan tidak menagih: ubin pesanan, saran pesanan,
   * katalog pesanan, dan riwayat pesanan disembunyikan; pekerjaan display
   * (daftar periksa, panduan, harga pesaing), foto, dan catatan toko tetap.
   */
  spg?: boolean;
};

const ORDER_STATUS_LABEL: Record<"PENDING_APPROVAL" | "APPROVED", "statusPending" | "statusApproved"> = {
  PENDING_APPROVAL: "statusPending",
  APPROVED: "statusApproved",
};

export function StoreDetailShell({ store, active, activePhotos, history, pending, orders, saran, ringkasan, bolehJarakJauh, portalToko, preorder, catatanToko, stokDiToko, saranTawar, spg = false }: Props) {
  const t = useTranslations("pwa.checkIn");
  const tBadge = useTranslations("stores.badge");
  const tFso = useTranslations("fieldSalesOrders");
  const tKunjungan = useTranslations("pwa.kunjunganBerjalan");

  const activeAtThisStore = active && active.storeId === store.id;
  const activeAtOtherStore = active && active.storeId !== store.id;
  const mapsUrl = store.lat !== null && store.lng !== null
    ? `https://www.google.com/maps?q=${store.lat},${store.lng}`
    : null;
  // Nomor HP mendapat WhatsApp DAN telepon; telepon rumah hanya telepon.
  const waUrl = tautanWhatsApp(store.phone, "");
  const telUrl = nomorTelepon(store.phone);
  // Katalog tetap bisa dilihat tanpa check-in (hanya baca) — untuk menjawab
  // pertanyaan toko lewat telepon. Selama kunjungan, "Buat pesanan" yang dipakai.
  const tampilKatalog = !activeAtThisStore && !spg;
  const aksiCepat: Array<{ kunci: string; href: string; label: string; ikon: typeof Phone; luar: boolean }> = [
    ...(telUrl ? [{ kunci: "telepon", href: `tel:${telUrl}`, label: tKunjungan("telepon"), ikon: Phone, luar: true }] : []),
    ...(waUrl ? [{ kunci: "wa", href: waUrl, label: "WhatsApp", ikon: MessageCircle, luar: true }] : []),
    ...(mapsUrl ? [{ kunci: "peta", href: mapsUrl, label: tKunjungan("petaSingkat"), ikon: MapPin, luar: true }] : []),
    ...(tampilKatalog
      ? [{ kunci: "katalog", href: `/pwa/stores/${store.id}/catalog`, label: tKunjungan("katalogSingkat"), ikon: ShoppingBag, luar: false }]
      : []),
  ];

  return (
    <div className="p-4 space-y-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan={spg ? "/pwa/spg/lainnya" : "/pwa/stores"} />
        </Button>
      </header>

      {/* Kepala toko: siapa, di mana, dan cara menghubunginya — dulu kartu
          kontak dan tombol peta ada di dasar halaman, di bawah semua kartu. */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold leading-tight">{store.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{store.code}</span>
            <span className="opacity-60">·</span>
            <Badge variant={store.termsType === "PUTUS" ? "outline" : "secondary"}>
              {store.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
            </Badge>
          </div>
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">{store.address}</span>
          </p>
          {store.contactName ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserIcon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">{store.contactName}</span>
            </p>
          ) : null}
        </div>
        {/* Satu baris ubin ikon (maks. empat) — tombol berlabel panjang terbungkus
            jadi dua baris di HP 375 px. */}
        {aksiCepat.length > 0 ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${aksiCepat.length}, minmax(0, 1fr))` }}>
            {aksiCepat.map(({ kunci, href, label, ikon: Ikon, luar }) => {
              const isi = (
                <>
                  <Ikon className="h-5 w-5" aria-hidden />
                  <span className="max-w-full truncate">{label}</span>
                </>
              );
              const kelas =
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border bg-background px-1 py-2 text-xs font-medium transition-colors hover:bg-muted active:bg-muted";
              return luar ? (
                <a key={kunci} href={href} className={kelas} {...(kunci === "telepon" ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
                  {isi}
                </a>
              ) : (
                <Link key={kunci} href={href} className={kelas}>
                  {isi}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>

      {activeAtThisStore ? (
        /* Kunjungan berjalan PALING ATAS: saat berdiri di toko, yang dicari
           adalah tombolnya, bukan riwayat. Check-out sengaja di AKHIR blok ini —
           sesudah foto dan ubah data — bukan di tengah halaman. */
        <section className="beranda-kartu space-y-3" style={{ borderColor: "var(--primary)", borderWidth: 2 }}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="beranda-judul">{tKunjungan("judul")}</h2>
            <span className="text-sm text-muted-foreground">{tKunjungan("sejak", { jam: active.sejakLabel })}</span>
          </div>
          {active.checkinOutOfRadius && (
            <Alert className="border-amber-500/50 text-amber-700 [&>svg]:text-amber-600">
              <AlertDescription className="text-amber-700">
                {t("outOfRadiusWarn", { meters: active.checkinDistanceMeters ?? "?" })}
              </AlertDescription>
            </Alert>
          )}
          <AksiKunjungan storeId={store.id} termsType={store.termsType} preorder={preorder} spg={spg} />
        </section>
      ) : (
        <div className="space-y-2">
          <CheckInButton
            storeId={store.id}
            storeName={store.name}
            fotoKunjungan
            autoCloseStoreName={activeAtOtherStore ? active.storeName : null}
          />
          {/* Jalan lain untuk memesan, sebagai ubin di bawah check-in — dulu dua
              tombol selebar layar yang menyaingi tombol check-in. */}
          {bolehJarakJauh || portalToko ? (
            <div className={bolehJarakJauh && portalToko ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
              {bolehJarakJauh ? <TombolPesananJarakJauh storeId={store.id} /> : null}
              {portalToko}
            </div>
          ) : null}
        </div>
      )}

      {/* Yang perlu diketahui sebelum atau selama di toko — tagihan, yang biasa
          dibeli, kapan terakhir dipesan dan didatangi. */}
      {ringkasan ? <RingkasanToko r={ringkasan} /> : null}

      {/* Catatan toko tepat di bawah ringkasan: "pemilik hanya ada sore hari"
          perlu terbaca sebelum masuk, bukan sesudah menggulir ke bawah. */}
      {catatanToko}

      {spg ? null : <SaranPesanan storeId={store.id} saran={saran} bolehPesan={!!activeAtThisStore} />}

      {stokDiToko}

      {saranTawar}

      {activeAtThisStore ? (
        <>
          <VisitPhotoCapture visitId={active.id} storeId={store.id} synced={activePhotos} />
          {pending ? (
            <StoreChangePendingCard pending={pending} />
          ) : (
            <StoreEditForm
              store={{
                id: store.id,
                name: store.name,
                address: store.address,
                phone: store.phone,
                contactName: store.contactName,
                lat: store.lat,
                lng: store.lng,
              }}
              visitId={active.id}
            />
          )}
          <CheckOutButton visitId={active.id} />
        </>
      ) : null}

      {/* Riwayat kunjungan dan pesanan dilipat: kunjungan dan pesanan TERAKHIR
          sudah ada di ringkasan toko di atas; daftar lengkapnya jarang dibuka. */}
      <details className="group pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
          <Clock className="h-4 w-4" aria-hidden />
          <span className="flex-1">{t("history")} ({history.length})</span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="pt-1">
        {history.length === 0 ? (
          <Card className="gap-0 py-0">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              {t("historyEmpty")}
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <CardContent className="p-0 divide-y">
              {history.map(v => (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{v.checkinLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    → {v.checkoutLabel ?? t("stillOpen")}
                  </span>
                  {v.autoClosed && (
                    <Badge variant="secondary">{t("autoClosedBadge")}</Badge>
                  )}
                  <a
                    href={`https://www.google.com/maps?q=${v.checkinLat},${v.checkinLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("viewCoords")}
                    className="ml-auto inline-flex items-center text-muted-foreground hover:underline"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                  </a>
                  <span className="text-xs text-muted-foreground">{v.userLabel}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        </div>
      </details>

      {spg ? null : (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ShoppingBag className="h-4 w-4" aria-hidden />
            <span className="flex-1">{t("ordersTitle")} ({orders.length})</span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="pt-1">
          {orders.length === 0 ? (
            <Card className="gap-0 py-0">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                {t("ordersEmpty")}
              </CardContent>
            </Card>
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <CardContent className="p-0 divide-y">
                {orders.map(o => (
                  <div key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
                    <span className="font-mono text-xs">{o.orderNo}</span>
                    <Badge variant={o.orderType === "PUTUS" ? "outline" : "secondary"}>
                      {o.orderType === "KONSI" ? tFso("typeKonsi") : tFso("typePutus")}
                    </Badge>
                    <Badge variant="outline">{tFso(ORDER_STATUS_LABEL[o.status])}</Badge>
                    <span className="text-xs text-muted-foreground">{o.createdLabel}</span>
                    {o.total !== null && (
                      <span className="ml-auto tabular-nums font-medium">{formatRupiah(o.total)}</span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          </div>
        </details>
      )}
    </div>
  );
}
