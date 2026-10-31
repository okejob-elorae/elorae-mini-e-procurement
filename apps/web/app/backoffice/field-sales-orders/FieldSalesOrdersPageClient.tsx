"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import type {
  DeliveryStatusFilter,
  FieldSalesDeliveryStatus,
  FieldSalesOrderListItem,
  FieldSalesOrderStatus,
  FieldSalesOrderStatusFilter,
} from "@/lib/field-sales/queries";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/Pager";
import { DELIVERY_BADGE_CLASS, DELIVERY_BADGE_VARIANT } from "./delivery-status-badge";
import { formatDisplayDateTime } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { LencanaJarakJauh } from "@/app/pwa/orders/[id]/LencanaJarakJauh";
import { LencanaInden } from "./LencanaInden";
import { useSorotBaris } from "@/components/gerak/useSorotBaris";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";

type StatusFilter = FieldSalesOrderStatusFilter | "ALL";

type Props = {
  orders: FieldSalesOrderListItem[];
  totalCount: number;
  search: string;
  status: StatusFilter;
  orderType: "ALL" | "PUTUS" | "KONSI";
  origin: "ALL" | "FIELD" | "ADMIN";
  storeId: string;
  deliveryStatus: DeliveryStatusFilter | "ALL";
  /** Saringan pre-order. */
  inden?: "ALL" | "INDEN" | "BIASA";
  /** Saringan status pengiriman (`?kirim=`); hanya pesanan PUTUS yang disetujui. */
  kirim?: FieldSalesDeliveryStatus | "ALL";
  storeOptions: { id: string; name: string }[];
  page: number;
  pageSize: number;
  /** Pesanan menunggu persetujuan yang kreditnya ditahan saat dibuat. */
  kreditDitahanIds?: string[];
  /** Saringan dari Kinerja sales lapangan (`?dari=&sampai=&salesman=`), tanggal sudah diformat. */
  saringKinerja?: { dari: string | null; sampai: string | null; sales: string | null } | null;
};

const STATUS_BADGE_VARIANT: Record<FieldSalesOrderStatus, "secondary" | "default" | "destructive"> = {
  PENDING_APPROVAL: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
};

const STATUS_LABEL_KEY: Record<FieldSalesOrderStatus, "statusPending" | "statusApproved" | "statusRejected"> = {
  PENDING_APPROVAL: "statusPending",
  APPROVED: "statusApproved",
  REJECTED: "statusRejected",
};


export function FieldSalesOrdersPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("fieldSalesOrders");
  const tInden = useTranslations("fieldSalesOrders.inden");
  const locale = useLocale();
  const inden = props.inden ?? "ALL";
  const kirim = props.kirim ?? "ALL";
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(props.search);
  const kreditDitahan = new Set(props.kreditDitahanIds ?? []);
  // Disetujui/ditolak di halaman rincian: saat kembali ke daftar, barisnya menyala sebentar.
  const { sorot } = useSorotBaris(
    "pesanan-lapangan",
    props.orders.map((o) => ({
      id: o.id,
      tanda: `${o.status}|${o.dibatalkan ? 1 : 0}|${o.deliveryStatus ?? ""}`,
    })),
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.search) pushParam("search", searchInput);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParam(key: string, value: string | undefined) {
    pushParams({ [key]: value });
  }

  /* Beberapa kunci dalam SATU dorongan — dua dorongan berturut-turut saling menimpa. */
  function pushParams(nilai: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(nilai)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    startTransition(() => router.push(`/backoffice/field-sales-orders?${params.toString()}`));
  }

  /*
   * Satu saringan pengiriman untuk dua alamat: `?deliveryStatus=` (dengan OPEN) dan `?kirim=`
   * (tautan Beranda). Memilih dari layar selalu menulis `deliveryStatus` dan melepas `kirim`.
   * Status pengiriman hanya ada pada pesanan yang disetujui: memilihnya ikut menyetel status Disetujui.
   */
  const deliveryValue = props.deliveryStatus !== "ALL" ? props.deliveryStatus : kirim;

  function pilihKirim(v: string) {
    if (v === "ALL") pushParams({ deliveryStatus: undefined, kirim: undefined });
    else pushParams({ deliveryStatus: v, kirim: undefined, status: "APPROVED" });
  }

  function pilihStatus(v: string) {
    // Status selain Disetujui tidak punya pengiriman — saringan pengiriman dilepas supaya daftar tidak kosong diam-diam.
    pushParams({
      status: v,
      deliveryStatus:
        (v === "ALL" || v === "APPROVED") && props.deliveryStatus !== "ALL" ? props.deliveryStatus : undefined,
      kirim: v === "APPROVED" && kirim !== "ALL" ? kirim : undefined,
    });
  }

  function reset() {
    setSearchInput("");
    startTransition(() => router.push("/backoffice/field-sales-orders"));
  }

  /*
   * The bare route defaults to PENDING_APPROVAL, which is itself a narrowing filter. Clearing
   * from the empty state has to land on every order, hence the explicit ALL sentinel.
   */
  function clearFilters() {
    setSearchInput("");
    startTransition(() => router.push("/backoffice/field-sales-orders?status=ALL"));
  }

  const saringKinerja = props.saringKinerja ?? null;
  const tanggalKinerja = saringKinerja
    ? saringKinerja.dari && saringKinerja.sampai
      ? saringKinerja.dari === saringKinerja.sampai
        ? saringKinerja.dari
        : `${saringKinerja.dari} – ${saringKinerja.sampai}`
      : saringKinerja.dari
        ? t("saring.sejak", { tanggal: saringKinerja.dari })
        : saringKinerja.sampai
          ? t("saring.sampai", { tanggal: saringKinerja.sampai })
          : null
    : null;

  /** Alamat tanpa saringan apa pun: status bawaan "menunggu persetujuan" dipilih server, bukan pengguna. */
  const saringanBawaan =
    !sp.get("status") &&
    !props.search &&
    props.orderType === "ALL" &&
    props.storeId === "ALL" &&
    props.origin === "ALL" &&
    props.deliveryStatus === "ALL" &&
    inden === "ALL" &&
    kirim === "ALL" &&
    !props.saringKinerja;

  const hasFilter =
    !!props.search ||
    props.status !== "ALL" ||
    props.orderType !== "ALL" ||
    props.origin !== "ALL" ||
    props.storeId !== "ALL" ||
    props.deliveryStatus !== "ALL" ||
    inden !== "ALL" ||
    kirim !== "ALL" ||
    !!saringKinerja;

  return (
    <div className="space-y-4">
      <PageHeader title={t("judulHalaman")} />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-[1_1_20rem]">
            <label className="text-xs text-muted-foreground mb-1 block">{t("searchLabel")}</label>
            <Input
              placeholder={t("search")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-52">
            <label className="text-xs text-muted-foreground mb-1 block">{t("status")}</label>
            <Select value={props.status} onValueChange={pilihStatus}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("statusAll")}</SelectItem>
                <SelectItem value="AKTIF">{t("saring.aktif")}</SelectItem>
                <SelectItem value="PENDING_APPROVAL">{t("statusPending")}</SelectItem>
                <SelectItem value="APPROVED">{t("statusApproved")}</SelectItem>
                <SelectItem value="REJECTED">{t("saring.ditolakKantor")}</SelectItem>
                <SelectItem value="CANCELLED">{t("batal.lencana")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-44">
            <label className="text-xs text-muted-foreground mb-1 block">{t("deliveryFilter")}</label>
            <Select value={deliveryValue} onValueChange={pilihKirim}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("deliveryFilter")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("deliveryFilterAll")}</SelectItem>
                <SelectItem value="OPEN">{t("deliveryFilterOpen")}</SelectItem>
                <SelectItem value="PENDING">{t("delivery.status.PENDING")}</SelectItem>
                <SelectItem value="PARTIAL">{t("delivery.status.PARTIAL")}</SelectItem>
                <SelectItem value="DELIVERED">{t("delivery.status.DELIVERED")}</SelectItem>
                <SelectItem value="CLOSED">{t("delivery.status.CLOSED")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-32">
            <label className="text-xs text-muted-foreground mb-1 block">{t("orderType")}</label>
            <Select value={props.orderType} onValueChange={(v) => pushParam("orderType", v === "ALL" ? undefined : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("orderType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("typeAll")}</SelectItem>
                <SelectItem value="PUTUS">{t("typePutus")}</SelectItem>
                <SelectItem value="KONSI">{t("typeKonsi")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-36">
            <label className="text-xs text-muted-foreground mb-1 block">{t("origin")}</label>
            <Select value={props.origin} onValueChange={(v) => pushParam("origin", v === "ALL" ? undefined : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("origin")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("originAll")}</SelectItem>
                <SelectItem value="FIELD">{t("originField")}</SelectItem>
                <SelectItem value="ADMIN">{t("originAdmin")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-36">
            <label className="text-xs text-muted-foreground mb-1 block">{tInden("saringan")}</label>
            <Select value={inden} onValueChange={(v) => pushParam("inden", v === "ALL" ? undefined : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tInden("saringan")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{tInden("saringanSemua")}</SelectItem>
                <SelectItem value="INDEN">{tInden("saringanInden")}</SelectItem>
                <SelectItem value="BIASA">{tInden("saringanBiasa")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Store and Reset wrap as one unit so Reset never ends up alone on a row. */}
          <div className="flex w-full items-end gap-3 sm:w-auto">
            <div className="min-w-0 flex-1 sm:w-52 sm:flex-none">
              <label className="text-xs text-muted-foreground mb-1 block">{t("storeFilter")}</label>
              <SearchableCombobox
                options={[
                  { value: "ALL", label: t("storeAll") },
                  ...props.storeOptions.map((s) => ({ value: s.id, label: s.name })),
                ]}
                value={props.storeId}
                onValueChange={(v) => pushParam("storeId", v === "ALL" ? undefined : v)}
                placeholder={t("storeAll")}
                searchPlaceholder={t("storeSearchPlaceholder")}
                emptyMessage={t("storeSearchEmpty")}
                triggerClassName="w-full"
              />
            </div>
            <Button variant="outline" onClick={reset} className="shrink-0">
              {t("reset")}
            </Button>
          </div>
        </div>
        {/* Dibawa dari Kinerja sales lapangan: isi daftar = angka kartu/baris di sana. */}
        {saringKinerja ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("saring.dariKinerja")}</span>
            {tanggalKinerja ? <Badge variant="secondary">{t("saring.dibuat", { tanggal: tanggalKinerja })}</Badge> : null}
            {saringKinerja.sales ? <Badge variant="secondary">{t("saring.sales", { nama: saringKinerja.sales })}</Badge> : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => pushParams({ dari: undefined, sampai: undefined, salesman: undefined })}
            >
              {t("saring.hapusKinerja")}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card>
        {/* Kartu berjudul seperti daftar lain di grup Penjualan (Pesanan marketplace, Pemenuhan). */}
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {t("daftarJudul")}
          </CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colOrderNo")}</TableHead>
              <TableHead className="hidden 2xl:table-cell">{t("colType")}</TableHead>
              <TableHead>{t("colStore")}</TableHead>
              <TableHead>{t("colSalesman")}</TableHead>
              <TableHead className="text-right">{t("colTotal")}</TableHead>
              <TableHead>{t("colCreated")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead>{t("colDelivery")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="baris-berurutan">
            {props.orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="whitespace-normal py-8 text-center text-muted-foreground">
                  {saringanBawaan ? (
                    // Dibuka tanpa saringan: bawaannya "menunggu persetujuan" — bukan saringan pengguna.
                    <div className="flex flex-col items-center gap-3">
                      <span>{t("kosongMenunggu")}</span>
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        {t("lihatSemuaPesanan")}
                      </Button>
                    </div>
                  ) : hasFilter ? (
                    <div className="flex flex-col items-center gap-3">
                      <span>{t("emptyFiltered")}</span>
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        {t("clearFilters")}
                      </Button>
                    </div>
                  ) : (
                    t("empty")
                  )}
                </TableCell>
              </TableRow>
            ) : (
              props.orders.map((o) => (
                <TableRow
                  key={o.id}
                  {...sorot(o.id)}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    startTransition(() => router.push(`/backoffice/field-sales-orders/${o.id}`))
                  }
                >
                  <TableCell className="font-mono text-sm">
                    {/* Tautan sungguhan: bisa difokus papan ketik dan dibuka di tab baru; baris tetap bisa diklik. */}
                    <Link
                      href={`/backoffice/field-sales-orders/${o.id}`}
                      className={TAUTAN_DOKUMEN}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {o.orderNo}
                    </Link>
                    {o.origin === "ADMIN" && (
                      <Badge variant="secondary" className="ml-2">
                        {t("originAdmin")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden 2xl:table-cell">
                    <Badge variant="outline">
                      {o.orderType === "KONSI" ? t("typeKonsi") : t("typePutus")}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-[9rem] max-w-[14rem] whitespace-normal">{o.storeName}</TableCell>
                  <TableCell className="min-w-[7rem] max-w-[10rem] whitespace-normal">{o.salesmanName}</TableCell>
                  <TableCell className="text-right">
                    {/* Pending/rejected KONSI has no finalized retail price — the writer keeps
                      * total at 0 until approve. Showing "Rp 0" reads as a real zero invoice. */}
                    {o.orderType === "KONSI" && o.status !== "APPROVED"
                      ? "—"
                      : formatRupiah(o.total)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDisplayDateTime(o.createdAt, locale)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Dibatalkan salesman sendiri: abu-abu, bukan merah "Ditolak" — kantor tidak memutuskan apa pun. */}
                      {o.dibatalkan ? (
                        <Badge variant="outline" className="bg-muted text-muted-foreground">
                          {t("batal.lencana")}
                        </Badge>
                      ) : (
                        <Badge variant={STATUS_BADGE_VARIANT[o.status]}>
                          {t(STATUS_LABEL_KEY[o.status])}
                        </Badge>
                      )}
                      {o.creditHoldAtCreate && (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                          {t("creditHoldBadge")}
                        </Badge>
                      )}
                      {kreditDitahan.has(o.id) && (
                        <Badge variant="outline" className="border-destructive/50 text-destructive">
                          {t("kredit.lencanaDaftar")}
                        </Badge>
                      )}
                      <LencanaJarakJauh saluran={o.remoteChannel} />
                      <LencanaInden preorder={o.preorder} />
                    </div>
                    {o.menggantikan || o.digantiDengan ? (
                      <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {o.menggantikan ? <TautanPasangan label={t("batal.menggantikan")} o={o.menggantikan} /> : null}
                        {o.digantiDengan ? <TautanPasangan label={t("batal.digantiDengan")} o={o.digantiDengan} /> : null}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {o.status === "APPROVED" ? (
                      <Badge
                        variant={DELIVERY_BADGE_VARIANT[o.deliveryStatus]}
                        className={DELIVERY_BADGE_CLASS[o.deliveryStatus]}
                      >
                        {t(`delivery.status.${o.deliveryStatus}`)}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Pager
        page={props.page}
        pageSize={props.pageSize}
        total={props.totalCount}
        onPageChange={(p) => {
          const params = new URLSearchParams(sp.toString());
          params.set("page", String(p));
          startTransition(() =>
            router.push(`/backoffice/field-sales-orders?${params.toString()}`),
          );
        }}
        onPageSizeChange={(size) => {
          const params = new URLSearchParams(sp.toString());
          params.set("pageSize", String(size));
          params.delete("page");
          startTransition(() =>
            router.push(`/backoffice/field-sales-orders?${params.toString()}`),
          );
        }}
      />
    </div>
  );
}

/** Tautan ke pesanan pasangannya; menghentikan klik baris (barisnya sendiri membuka detail pesanan ini). */
function TautanPasangan({ label, o }: { label: string; o: { id: string; orderNo: string } }) {
  return (
    <span>
      {label}{" "}
      <Link
        href={`/backoffice/field-sales-orders/${o.id}`}
        className="font-mono text-foreground underline underline-offset-2"
        onClick={(e) => e.stopPropagation()}
      >
        {o.orderNo}
      </Link>
    </span>
  );
}
