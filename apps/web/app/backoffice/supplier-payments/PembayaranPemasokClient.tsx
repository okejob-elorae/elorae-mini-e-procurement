"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, ChevronDown, DollarSign, Hourglass, Plus, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import { getPOById, setPOPaidAt } from "@/app/actions/purchase-orders";
import { logPrint } from "@/app/actions/audit";
import { useSupplierPaymentJournalFailureMessage } from "@/hooks/use-supplier-payment-journal-failure-message";
import { LABEL_CETAK_FAKTUR_PO, buildPOPrintHtml, labelStatusCetakPo } from "@/lib/print/po-html";
import { buildPOPaymentReceiptHtml } from "@/lib/print/po-payment-receipt-html";
import { variantDetailForSku } from "@/lib/items/variants";
import { labelPemasok } from "@/lib/suppliers/label-pemasok";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";
import type { BarisRegister, HalamanPembayaran, RegisterUtang } from "@/lib/purchasing/pembayaran-queries";
import { KonfirmasiBayarDialog } from "./KonfirmasiBayarDialog";

export type SaringanPembayaranPemasok = {
  tab: "po" | "pembayaran";
  pemasok: string;
  dari: string;
  sampai: string;
  status: string;
  cari: string;
  halaman: number;
};

type Props = {
  saringan: SaringanPembayaranPemasok;
  pemasok: Array<{ id: string; kode: string; nama: string; disetujui: boolean }>;
  register: RegisterUtang | null;
  pembayaran: HalamanPembayaran | null;
  gagal: boolean;
  akses: { bayar: boolean; tandaiLunas: boolean };
};

const ALAMAT = "/backoffice/supplier-payments";
const SEMUA = "__semua__";

function cetakDiIframe(html: string, judul: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "position:absolute;width:0;height:0;border:0;visibility:hidden;");
  iframe.setAttribute("title", judul);
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => iframe.contentWindow?.print(), 350);
  }
  setTimeout(() => document.body.removeChild(iframe), 1000);
}

export function PembayaranPemasokClient({ saringan, pemasok, register, pembayaran, gagal, akses }: Props) {
  const t = useTranslations("supplierPayments");
  const td = useTranslations("supplierPayments.dokumen");
  const tPO = useTranslations("purchaseOrders");
  const locale = useLocale();
  const router = useRouter();
  const journalFailureMessage = useSupplierPaymentJournalFailureMessage();
  const [pindah, mulaiPindah] = useTransition();
  const [cari, setCari] = useState(saringan.cari);
  const [sibukPo, setSibukPo] = useState<string | null>(null);
  const [konfirmasi, setKonfirmasi] = useState<{ po: BarisRegister; arah: "bayar" | "batal" } | null>(null);

  const pergi = (ubah: Partial<SaringanPembayaranPemasok>) => {
    const s = { ...saringan, halaman: 1, ...ubah };
    const q = new URLSearchParams();
    if (s.tab !== "po") q.set("tab", s.tab);
    if (s.pemasok) q.set("pemasok", s.pemasok);
    if (s.dari) q.set("dari", s.dari);
    if (s.sampai) q.set("sampai", s.sampai);
    if (s.status) q.set("status", s.status);
    if (s.cari) q.set("cari", s.cari);
    if (s.halaman > 1) q.set("halaman", String(s.halaman));
    const qs = q.toString();
    mulaiPindah(() => router.replace(qs ? `${ALAMAT}?${qs}` : ALAMAT, { scroll: false }));
  };

  // Jeda mengetik sebelum kata kunci dikirim.
  useEffect(() => {
    const k = cari.trim();
    if (k === saringan.cari) return;
    const id = window.setTimeout(() => pergi({ cari: k }), 350);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pergi membaca saringan terbaru
  }, [cari]);

  const opsiPemasok = [
    { value: SEMUA, label: t("allSuppliers") },
    ...pemasok.map((p) => ({ value: p.id, label: `${labelPemasok({ code: p.kode, name: p.nama })}${p.disetujui ? "" : ` · ${t("belumDisetujui")}`}` })),
  ];

  const handleTandai = async (po: BarisRegister, paidAt: Date | null) => {
    const bayar = paidAt != null;
    setSibukPo(po.id);
    try {
      const r = await setPOPaidAt(po.id, paidAt);
      // Penolakan dulu: ia juga membawa `changed: false`, tapi PO-nya TIDAK sudah dalam keadaan yang diminta.
      if (r.refusal === "TANGGAL_TIDAK_SAH") toast.error(t("konfirmasi.tanggalSalah"));
      else if (r.refusal === "ADA_PEMBAYARAN_DOKUMEN") toast.warning(td("toggleDitolak"), { duration: 12000 });
      else if (r.refusal === "STANDING_PAYMENT_JOURNAL") toast.warning(t("standingPayment.markRefusedRegister"), { duration: 12000 });
      else if (r.refusal) toast.error(t(`markRefused.${r.refusal}`), { duration: 12000 });
      else if (!r.changed) toast.info(t(bayar ? "noop.alreadyPaid" : "noop.alreadyUnpaid"), { duration: 10000 });
      else if (r.journalFailure) {
        const f = r.journalFailure;
        toast.warning(journalFailureMessage(f.code, f.role, f.direction), { duration: 12000 });
      } else toast.success(bayar ? t("markedPaid") : t("markedUnpaid"));
      router.refresh();
    } catch {
      toast.error(t("actionFailed"));
    } finally {
      setSibukPo(null);
      setKonfirmasi(null);
    }
  };

  const cetakFaktur = async (poId: string) => {
    try {
      const po = await getPOById(poId);
      if (!po) return void toast.error(t("poNotFound"));
      await logPrint("PurchaseOrderInvoice", poId);
      const s = po.supplier as { name: string; code?: string; address?: string | null };
      cetakDiIframe(
        buildPOPrintHtml({
          docNumber: po.docNumber,
          issuedAt: po.createdAt,
          supplierName: s.name,
          supplierAddress: s.address ?? null,
          supplierCode: s.code?.trim() ? s.code : null,
          status: labelStatusCetakPo(po.status),
          etaDate: po.etaDate,
          paymentDueDate: po.paymentDueDate,
          currency: po.currency ?? "IDR",
          subtotal: Number(po.totalAmount ?? 0),
          taxAmount: Number(po.taxAmount ?? 0),
          grandTotal: Number(po.grandTotal ?? 0),
          notes: po.notes ?? null,
          terms: po.terms ?? null,
          lines: (po.items ?? []).map((item) => ({
            itemName: item.item?.nameId ?? item.item?.nameEn ?? item.item?.sku ?? "",
            itemSku: item.item?.sku,
            variantSku: item.variantSku ?? null,
            variantDetail: variantDetailForSku(item.item?.variants, item.variantSku ?? null),
            lineNotes: item.notes?.trim() ? String(item.notes).trim() : null,
            qty: Number(item.qty ?? 0),
            uomCode: item.item?.uom?.code ?? "",
            price: Number(item.price ?? 0),
            amount: Number(item.qty ?? 0) * Number(item.price ?? 0),
          })),
          labels: LABEL_CETAK_FAKTUR_PO,
        }),
        t("printInvoice"),
      );
    } catch {
      toast.error(t("printFailed"));
    }
  };

  const cetakKuitansi = async (poId: string) => {
    try {
      const po = await getPOById(poId);
      if (!po) return void toast.error(t("poNotFound"));
      if (!po.paidAt) return void toast.error(t("receiptNeedsPaid"));
      await logPrint("PurchaseOrderPaymentReceipt", poId);
      const s = po.supplier as { name: string; code: string; address?: string | null };
      cetakDiIframe(
        buildPOPaymentReceiptHtml({
          receiptNumber: `PR-${po.docNumber.replace(/\//g, "-")}`,
          poDocNumber: po.docNumber,
          supplierName: s.name,
          supplierCode: s.code ?? "",
          supplierAddress: s.address ?? null,
          paidAt: po.paidAt,
          printedAt: new Date(),
          currency: po.currency ?? "IDR",
          amountPaid: Number(po.utang?.utang ?? po.grandTotal ?? 0),
        }),
        t("printReceipt"),
      );
    } catch {
      toast.error(t("printFailed"));
    }
  };

  const tabKelas = (aktif: boolean) =>
    cn(
      "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      aktif ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judulHalaman")}
        actions={
          <>
            <Link href={`${ALAMAT}/umur-hutang`}>
              <Button variant="outline">
                <CalendarClock className="mr-2 h-4 w-4" />
                {td("umurHutang")}
              </Button>
            </Link>
            {akses.bayar && (
              <Link href={`${ALAMAT}/baru${saringan.pemasok ? `?pemasok=${encodeURIComponent(saringan.pemasok)}` : ""}`}>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  {td("bayarPemasok")}
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="inline-flex rounded-lg bg-muted p-1" role="tablist">
        <button type="button" role="tab" aria-selected={saringan.tab === "po"} className={tabKelas(saringan.tab === "po")} onClick={() => pergi({ tab: "po", status: "", dari: "", sampai: "" })}>
          {td("tabPo")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={saringan.tab === "pembayaran"}
          className={tabKelas(saringan.tab === "pembayaran")}
          onClick={() => pergi({ tab: "pembayaran", status: "", dari: "", sampai: "" })}
        >
          {td("tabPembayaran")}
        </button>
      </div>

      <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-end">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder={saringan.tab === "po" ? td("cariPo") : td("cariPembayaran")}
            aria-label={saringan.tab === "po" ? td("cariPo") : td("cariPembayaran")}
            className="pl-9"
          />
        </div>
        <SearchableCombobox
          options={opsiPemasok}
          value={saringan.pemasok || SEMUA}
          onValueChange={(v) => pergi({ pemasok: v === SEMUA ? "" : v })}
          placeholder={t("allSuppliers")}
          searchPlaceholder={t("cariPemasok")}
          triggerClassName="w-full sm:w-[240px]"
        />
        <div className="w-full sm:w-[240px]">
          <RentangTanggalInput
            dari={saringan.dari}
            sampai={saringan.sampai}
            onChange={(r) => pergi({ dari: r.dari, sampai: r.sampai })}
            placeholder={saringan.tab === "po" ? t("dueRangeLabel") : td("rentangBayar")}
            aria-label={saringan.tab === "po" ? t("dueRangeLabel") : td("rentangBayar")}
          />
        </div>
        <Select value={saringan.status || SEMUA} onValueChange={(v) => pergi({ status: v === SEMUA ? "" : v })}>
          <SelectTrigger className="w-full sm:w-[170px]" aria-label={t("paymentStatusLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("filterAll")}</SelectItem>
            {saringan.tab === "po" ? (
              <>
                <SelectItem value="belum">{t("unpaid")}</SelectItem>
                <SelectItem value="lunas">{t("paid")}</SelectItem>
              </>
            ) : (
              <>
                <SelectItem value="POSTED">{td("statusBerlaku")}</SelectItem>
                <SelectItem value="CANCELLED">{td("statusBatal")}</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      {gagal && <p className="text-sm text-destructive">{t("loadFailed")}</p>}

      {saringan.tab === "po" && register && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KartuAngka ikon={DollarSign} judul={t("utangDiterimaJudul")} nilai={formatRupiah(register.ringkasan.utangDiterima)} catatan={t("poCount", { count: register.ringkasan.jumlahPoUtang })} />
            <KartuAngka ikon={Hourglass} judul={t("komitmenJudul")} nilai={formatRupiah(register.ringkasan.komitmen)} catatan={t("poCount", { count: register.ringkasan.jumlahPoKomitmen })} />
            <KartuAngka judul={t("unpaid")} nilai={String(register.ringkasan.belumDibayar)} catatan={td("poTersaring")} />
            <KartuAngka judul={t("paid")} nilai={String(register.ringkasan.sudahDibayar)} catatan={td("poTersaring")} />
          </div>

          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                {t("listTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className={cn("pb-6", pindah && "opacity-60")}>
              {register.baris.length === 0 ? (
                <EmptyState icon={Wallet} title={t("noPOsMatchFilters")} />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{td("kolomPo")}</TableHead>
                          <TableHead>{td("kolomPemasok")}</TableHead>
                          <TableHead className="text-right">{t("colTotal")}</TableHead>
                          <TableHead className="hidden 2xl:table-cell">{t("colDue")}</TableHead>
                          <TableHead>{td("kolomStatus")}</TableHead>
                          <TableHead className="w-12">
                            <span className="sr-only">{t("colActions")}</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {register.baris.map((po) => {
                          const tolakTombol = po.adaPembayaranDokumen ? td("toggleDitolakSingkat") : po.paymentJournalStandingWhileUnpaid ? t("standingPayment.markBlockedRegister") : null;
                          return (
                            <TableRow key={po.id}>
                              <TableCell className="align-top">
                                <Link href={`/backoffice/purchase-orders/${po.id}`} className={TAUTAN_DOKUMEN}>
                                  {po.nomor}
                                </Link>
                              </TableCell>
                              <TableCell className="align-top whitespace-normal">
                                <p className="font-medium">{po.pemasok.nama}</p>
                                <p className="text-xs text-muted-foreground">{po.pemasok.kode}</p>
                              </TableCell>
                              <TableCell className="align-top text-right">
                                <p className="tabular-nums">{formatRupiah(po.grandTotal)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {po.lunasPada
                                    ? tPO("ringkasan.nilaiAkhirSingkat", { nilai: formatRupiah(po.utang) })
                                    : t("utangSingkatDiterima", { nilai: formatRupiah(po.utangDiterima) })}
                                </p>
                                {!po.lunasPada && po.sisaBukuBesar != null && (
                                  <p className="text-xs text-muted-foreground">{td("sisaBukuBesar", { nilai: formatRupiah(po.sisaBukuBesar) })}</p>
                                )}
                              </TableCell>
                              <TableCell className="hidden align-top 2xl:table-cell">{po.jatuhTempo ? labelTanggal(po.jatuhTempo, locale) : "–"}</TableCell>
                              <TableCell className="align-top">
                                <div className="flex flex-col items-start gap-1">
                                  {po.lunasPada ? (
                                    <StatusPill tone="settled" detail={labelTanggal(po.lunasPada, locale)}>
                                      {t("paid")}
                                    </StatusPill>
                                  ) : (
                                    <StatusPill tone="waiting" detail={po.jatuhTempo ? td("jatuhTempoPada", { tanggal: labelTanggal(po.jatuhTempo, locale) }) : undefined}>
                                      {t("unpaid")}
                                    </StatusPill>
                                  )}
                                  {po.adaPembayaranDokumen && <span className="text-xs text-muted-foreground">{td("adaPembayaranSebagian")}</span>}
                                </div>
                              </TableCell>
                              <TableCell className="align-top">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="gap-1" disabled={sibukPo === po.id} aria-label={t("colActions")}>
                                      {t("colActions")}
                                      <ChevronDown className="h-3 w-3 opacity-60" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="max-w-[280px]">
                                    <DropdownMenuItem asChild>
                                      <Link href={`/backoffice/purchase-orders/${po.id}`}>{t("viewPO")}</Link>
                                    </DropdownMenuItem>
                                    {akses.bayar && !po.lunasPada && po.adaPenerimaan && (
                                      <DropdownMenuItem asChild>
                                        <Link href={`${ALAMAT}/baru?pemasok=${encodeURIComponent(po.pemasok.id)}&po=${encodeURIComponent(po.id)}`}>{td("bayarPo")}</Link>
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => void cetakFaktur(po.id)}>{t("printInvoice")}</DropdownMenuItem>
                                    {po.lunasPada && <DropdownMenuItem onSelect={() => void cetakKuitansi(po.id)}>{t("printReceipt")}</DropdownMenuItem>}
                                    {akses.tandaiLunas && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          disabled={tolakTombol != null}
                                          onSelect={() => setKonfirmasi({ po, arah: po.lunasPada ? "batal" : "bayar" })}
                                        >
                                          {po.lunasPada ? t("unmark") : t("markPaid")}
                                        </DropdownMenuItem>
                                        {tolakTombol && <p className="px-2 pb-1.5 text-xs text-muted-foreground">{tolakTombol}</p>}
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination
                    page={register.halaman}
                    totalPages={Math.max(1, Math.ceil(register.total / register.ukuran))}
                    onPageChange={(h) => pergi({ halaman: h })}
                    totalCount={register.total}
                    pageSize={register.ukuran}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {saringan.tab === "pembayaran" && pembayaran && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KartuAngka ikon={DollarSign} judul={td("ringkasBruto")} nilai={formatRupiah(pembayaran.ringkasan.bruto)} catatan={td("jumlahPembayaran", { count: pembayaran.ringkasan.jumlahBerlaku })} />
            <KartuAngka judul={td("ringkasPotong")} nilai={formatRupiah(pembayaran.ringkasan.potong)} />
            <KartuAngka judul={td("ringkasNeto")} nilai={formatRupiah(pembayaran.ringkasan.neto)} />
            <KartuAngka judul={td("ringkasJumlah")} nilai={String(pembayaran.total)} catatan={td("termasukBatal")} />
          </div>
          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                {td("daftarJudul")}
              </CardTitle>
            </CardHeader>
            <CardContent className={cn("pb-6", pindah && "opacity-60")}>
              {pembayaran.baris.length === 0 ? (
                <EmptyState icon={Wallet} title={td("kosongJudul")} description={akses.bayar ? td("kosongIsi") : undefined} />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{td("kolomNomor")}</TableHead>
                          <TableHead>{td("kolomPemasok")}</TableHead>
                          <TableHead className="hidden 2xl:table-cell">{td("kolomDokumen")}</TableHead>
                          <TableHead className="text-right">{td("kolomBruto")}</TableHead>
                          <TableHead className="hidden text-right 2xl:table-cell">{td("kolomPotong")}</TableHead>
                          <TableHead className="text-right">{td("kolomNeto")}</TableHead>
                          <TableHead>{td("kolomStatus")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pembayaran.baris.map((b) => (
                          <TableRow key={b.id}>
                            <TableCell className="align-top">
                              <Link href={`${ALAMAT}/${b.id}`} className={TAUTAN_DOKUMEN}>
                                {b.nomor}
                              </Link>
                              <p className="text-xs text-muted-foreground">{labelTanggal(b.tanggal, locale)}</p>
                            </TableCell>
                            <TableCell className="align-top whitespace-normal">
                              <p className="font-medium">{b.pemasok.nama}</p>
                              <p className="text-xs text-muted-foreground">{td(`cara.${b.cara}` as never)}{b.referensi ? ` · ${b.referensi}` : ""}</p>
                            </TableCell>
                            <TableCell className="hidden align-top whitespace-normal 2xl:table-cell">
                              <p className="text-sm">{b.dokumen.join(", ") || "–"}</p>
                              {b.jumlahDokumen > b.dokumen.length && <p className="text-xs text-muted-foreground">{td("dokumenLain", { count: b.jumlahDokumen - b.dokumen.length })}</p>}
                            </TableCell>
                            <TableCell className="align-top text-right tabular-nums">{formatRupiah(b.bruto)}</TableCell>
                            <TableCell className="hidden align-top text-right tabular-nums 2xl:table-cell">{b.potong > 0 ? formatRupiah(b.potong) : "–"}</TableCell>
                            <TableCell className="align-top text-right tabular-nums">{formatRupiah(b.neto)}</TableCell>
                            <TableCell className="align-top">
                              <div className="flex flex-col items-start gap-1">
                                {b.status === "CANCELLED" ? <StatusPill tone="inactive">{td("statusBatal")}</StatusPill> : <StatusPill tone="settled">{td("statusBerlaku")}</StatusPill>}
                                {b.cerminTandaiLunas && <span className="text-xs text-muted-foreground">{td("dariTandaiLunas")}</span>}
                                {b.status === "POSTED" && b.uangMukaSisa > 0 && <span className="text-xs text-muted-foreground">{td("uangMukaSisa", { nilai: formatRupiah(b.uangMukaSisa) })}</span>}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination
                    page={pembayaran.halaman}
                    totalPages={Math.max(1, Math.ceil(pembayaran.total / pembayaran.ukuran))}
                    onPageChange={(h) => pergi({ halaman: h })}
                    totalCount={pembayaran.total}
                    pageSize={pembayaran.ukuran}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <KonfirmasiBayarDialog
        open={konfirmasi !== null}
        onOpenChange={(buka) => !buka && setKonfirmasi(null)}
        arah={konfirmasi?.arah ?? "bayar"}
        po={
          konfirmasi
            ? {
                docNumber: konfirmasi.po.nomor,
                supplierName: konfirmasi.po.pemasok.nama,
                grandTotal: konfirmasi.po.grandTotal,
                utangDiterima: konfirmasi.po.utangDiterima,
                komitmen: konfirmasi.po.komitmen,
                adaPenerimaan: konfirmasi.po.adaPenerimaan,
              }
            : null
        }
        sibuk={konfirmasi != null && sibukPo === konfirmasi.po.id}
        onKonfirmasi={(paidAt) => {
          if (!konfirmasi) return;
          if (konfirmasi.arah === "bayar" && paidAt == null) return;
          void handleTandai(konfirmasi.po, konfirmasi.arah === "bayar" ? paidAt : null);
        }}
      />
    </div>
  );
}

function KartuAngka({ ikon: Ikon, judul, nilai, catatan }: { ikon?: typeof DollarSign; judul: string; nilai: string; catatan?: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {Ikon && <Ikon className="h-4 w-4" />}
          {judul}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-xl font-bold tabular-nums sm:text-2xl">{nilai}</p>
        {catatan && <p className="text-xs text-muted-foreground">{catatan}</p>}
      </CardContent>
    </Card>
  );
}
