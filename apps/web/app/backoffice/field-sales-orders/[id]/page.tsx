import { redirect, notFound } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { getFieldSalesOrderById, listKonsiSuggestions, type KonsiSuggestion } from "@/lib/field-sales/queries";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { muatPanelKredit, type PanelKredit } from "@/lib/field-sales/kredit-panel";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { FieldSalesOrderDetailClient } from "./FieldSalesOrderDetailClient";
import { muatTautanPesanan, penagihanSesuaiIzin, type FakturKreditTampil, type PiutangKiriman } from "./tautan-pesanan";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function FieldSalesOrderDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const order = await getFieldSalesOrderById(id);
  if (!order) notFound();

  const canApprove = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  );
  const canDeliver = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.FIELD_SALES_ORDERS_DELIVER,
  );

  /* Never-sent suggestions are konsi-only and only useful while the transfer is still decidable. */
  const wantsKonsiSuggestions =
    order.orderType === "KONSI" && order.status === "PENDING_APPROVAL" && canApprove;
  /**
   * Degrades to an empty panel rather than taking the page down with it. There is no `error.tsx`
   * under `app/`, so an unhandled throw from this optional convenience query would replace the
   * whole detail page — Approve and Reject included — with the framework error screen.
   */
  let konsiSuggestions: KonsiSuggestion[] = [];
  if (wantsKonsiSuggestions) {
    try {
      konsiSuggestions = await listKonsiSuggestions(id);
    } catch (e) {
      console.error("[field-sales-orders] listKonsiSuggestions failed", { orderId: id, error: e });
    }
  }

  /*
   * Panel kredit (PUTUS saja): catatan saat pesanan dibuat + tagihan toko sekarang.
   * Sama seperti saran konsinyasi: gagal memuatnya tidak boleh menjatuhkan halaman,
   * tapi pesanan yang DITAHAN tetap butuh centang di kartu persetujuan — jadi
   * status ditahan dibaca terpisah dan ikut dikirim walau panelnya gagal.
   */
  let kredit: PanelKredit | null = null;
  if (order.orderType === "PUTUS") {
    try {
      kredit = await muatPanelKredit(id);
    } catch (e) {
      console.error("[field-sales-orders] muatPanelKredit failed", { orderId: id, error: e });
    }
  }
  const kreditDitahan =
    kredit?.ditahan ??
    (order.orderType === "PUTUS" &&
      (await prisma.fieldSalesOrder.findUnique({ where: { id }, select: { kreditDitahan: true } }))?.kreditDitahan === true);

  /*
   * Tautan ke penagihan: keadaan piutang sesungguhnya untuk faktur di panel kredit dan untuk
   * piutang tiap nota pengiriman. Piutang nota hanya dibaca untuk yang boleh membaca piutang.
   * Gagal memuat tidak menjatuhkan halaman — panel kembali ke kolom lamanya.
   */
  const izin = session.user.permissions ?? [];
  const bolehBukaPiutang = bolehMembacaPiutang(izin);
  const bolehBukaFakturPajak = hasPermission(izin, PERMISSIONS.TAX_INVOICES_VIEW);
  let fakturKredit: FakturKreditTampil[] | null = null;
  let piutangKiriman: Record<string, PiutangKiriman> = {};
  try {
    const tautan = await muatTautanPesanan({
      faktur: kredit?.faktur ?? [],
      piutangNota: bolehBukaPiutang
        ? order.deliveries.flatMap((d) => (d.receivable ? [{ deliveryId: d.id, receivableId: d.receivable.id }] : []))
        : [],
    });
    fakturKredit = tautan.faktur;
    piutangKiriman = tautan.piutangKiriman;
  } catch (e) {
    console.error("[field-sales-orders] muatTautanPesanan failed", { orderId: id, error: e });
  }

  // Faktur pajak dan piutang nota tidak dikirim ke peramban yang tidak boleh membukanya — izin tidak melebar lewat halaman ini.
  const orderTampil = {
    ...order,
    deliveries: penagihanSesuaiIzin(order.deliveries, { piutang: bolehBukaPiutang, fakturPajak: bolehBukaFakturPajak }),
  };

  return (
    <FieldSalesOrderDetailClient
      order={orderTampil}
      canApprove={canApprove}
      canDeliver={canDeliver}
      konsiSuggestions={konsiSuggestions}
      kredit={kredit}
      fakturKredit={fakturKredit}
      kreditDitahan={kreditDitahan}
      piutangKiriman={piutangKiriman}
      bolehBukaPiutang={bolehBukaPiutang}
      bolehBukaFakturPajak={bolehBukaFakturPajak}
    />
  );
}
