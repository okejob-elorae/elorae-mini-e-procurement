import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { formatDisplayDateTime } from "@/lib/date-only";
import { alamatPesanan, bacaBatas, bacaTab, BATAS_BAWAAN, pesananSaya, TAB_PESANAN } from "@/lib/field-sales/pwa-queries";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { PesananSayaClient } from "./PesananSayaClient";

export const dynamic = "force-dynamic";

/**
 * Pesanan saya — daftar pesanan milik salesman yang masuk, per tab keadaan.
 * Tab dibaca dari `?status=` supaya angka di kartu beranda bisa menaut langsung
 * ke tab yang sama.
 */
export default async function PesananSayaPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; batas?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const sp = await searchParams;
  const tab = bacaTab(sp.status);
  const batas = bacaBatas(sp.batas);
  const data = await pesananSaya(session.user.id, { status: tab, batas });

  return (
    <PesananSayaClient
      tab={tab}
      // Alamat dirakit di server: komponen klien hanya mengimpor TIPE dari
      // pwa-queries, supaya Prisma tidak ikut terbawa ke bundel HP.
      tabs={TAB_PESANAN.map((k) => ({ kunci: k, jumlah: data.jumlah[k], href: alamatPesanan(k) }))}
      lebihHref={data.adaLagi ? alamatPesanan(tab, batas + BATAS_BAWAAN) : null}
      baris={data.baris.map((b) => ({
        id: b.id,
        orderNo: b.orderNo,
        storeName: b.storeName,
        orderType: b.orderType,
        keadaan: b.keadaan,
        total: b.total,
        /*
         * Tanggal diformat di server: format tanggal di klien bisa berbeda antara
         * Node dan Safari (hydration error). Bahasa aplikasi hanya diketahui klien
         * (localStorage), jadi server memakai bentuk Indonesia seperti layar HP lain.
         */
        tanggal: formatDisplayDateTime(b.createdAt),
        jumlahBaris: b.jumlahBaris,
        jumlahPcs: b.jumlahPcs,
        adaBanding: b.adaBanding,
        remoteChannel: b.remoteChannel,
        // Pre-order: nama jendelanya untuk lencana "Inden · …"; "" = jendela tidak ditemukan.
        indenNama: b.inden ? (b.inden.name ?? "") : null,
        // Tanda "ditahan" hanya berarti selama pesanan masih menunggu keputusan.
        kreditDitahan: b.kreditDitahan && b.status === "PENDING_APPROVAL",
        ditolak: b.status === "REJECTED",
        rejectReason: b.rejectReason,
        dibatalkan: b.dibatalkan,
        menggantikanNo: b.menggantikan?.orderNo ?? null,
        digantiDenganNo: b.digantiDengan?.orderNo ?? null,
      }))}
    />
  );
}
