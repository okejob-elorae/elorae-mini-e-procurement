"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import type {
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
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/Pager";
import { formatDisplayDateTime } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { LencanaJarakJauh } from "@/app/pwa/orders/[id]/LencanaJarakJauh";
import { LencanaInden } from "./LencanaInden";

type StatusFilter = FieldSalesOrderStatusFilter | "ALL";

type Props = {
  orders: FieldSalesOrderListItem[];
  totalCount: number;
  search: string;
  status: StatusFilter;
  orderType: "ALL" | "PUTUS" | "KONSI";
  storeId: string;
  /** Saringan pre-order. */
  inden?: "ALL" | "INDEN" | "BIASA";
  /** Saringan status pengiriman (`?kirim=`); hanya pesanan PUTUS yang disetujui. */
  kirim?: FieldSalesDeliveryStatus | "ALL";
  storeOptions: { id: string; name: string }[];
  page: number;
  pageSize: number;
  /** Pesanan menunggu persetujuan yang kreditnya ditahan saat dibuat. */
  kreditDitahanIds?: string[];
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

const STATUS_KIRIM: FieldSalesDeliveryStatus[] = ["PENDING", "PARTIAL", "DELIVERED", "CLOSED"];

/* Sama dengan kartu Pengiriman di rincian: yang masih ditunggu menonjol, yang selesai tenang. */
const KELAS_LENCANA_KIRIM: Record<FieldSalesDeliveryStatus, string> = {
  PENDING: "border-sky-500/40 text-sky-700 dark:text-sky-300",
  PARTIAL: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  DELIVERED: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  CLOSED: "text-muted-foreground",
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

  /* Status pengiriman hanya ada pada pesanan yang disetujui: memilihnya ikut menyetel status Disetujui. */
  function pilihKirim(v: string) {
    if (v === "ALL") pushParams({ kirim: undefined });
    else pushParams({ kirim: v, status: "APPROVED" });
  }

  function pilihStatus(v: string) {
    // Status selain Disetujui tidak punya pengiriman — saringan pengiriman dilepas supaya daftar tidak kosong diam-diam.
    pushParams(v === "APPROVED" ? { status: v } : { status: v, kirim: undefined });
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

  const hasFilter =
    !!props.search ||
    props.status !== "ALL" ||
    props.orderType !== "ALL" ||
    props.storeId !== "ALL" ||
    inden !== "ALL" ||
    kirim !== "ALL";

  return (
    <div className="space-y-4">
      <PageHeader title={t("pageTitle")} />

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
                <SelectItem value="PENDING_APPROVAL">{t("statusPending")}</SelectItem>
                <SelectItem value="APPROVED">{t("statusApproved")}</SelectItem>
                <SelectItem value="REJECTED">{t("saring.ditolakKantor")}</SelectItem>
                <SelectItem value="CANCELLED">{t("batal.lencana")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-44">
            <label className="text-xs text-muted-foreground mb-1 block">{t("saring.pengiriman")}</label>
            <Select value={kirim} onValueChange={pilihKirim}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("saring.pengiriman")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("statusAll")}</SelectItem>
                {STATUS_KIRIM.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`delivery.status.${s}`)}
                  </SelectItem>
                ))}
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
      </Card>

      <Card>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="whitespace-normal py-8 text-center text-muted-foreground">
                  {hasFilter ? (
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
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    startTransition(() => router.push(`/backoffice/field-sales-orders/${o.id}`))
                  }
                >
                  <TableCell className="font-mono text-sm">{o.orderNo}</TableCell>
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
                      {/* Pengiriman hanya bermakna untuk PUTUS yang disetujui. */}
                      {o.status === "APPROVED" && o.orderType === "PUTUS" && o.deliveryStatus && (
                        <Badge variant="outline" className={KELAS_LENCANA_KIRIM[o.deliveryStatus]}>
                          {t(`delivery.status.${o.deliveryStatus}`)}
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
