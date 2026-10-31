import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bacaSumberDokumen, jumlahAwal, type BarangLabel, type JumlahLabel } from "@/lib/items/label";
import { barangUntukLabel, isiLabelDariDokumen } from "@/lib/items/label-queries";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { LabelBarcodeClient, type DokumenLabelLayar } from "./LabelBarcodeClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ item?: string | string[]; dari?: string | string[] }>;
};

/**
 * Label barcode untuk ditempel di barang — dipindai SPG saat menjual. Dibuka
 * dari halaman barang (`?item=<id>`), dari dokumen kiriman
 * (`?dari=pengiriman:<id>` / `mutasi:<id>` / `konsi:<id>`, jumlah label =
 * jumlah barang di dokumen), atau langsung lalu mencari barangnya. Mencetak
 * terjadi di peramban; halaman ini hanya membaca. Izin: `items:view`.
 */
export default async function LabelBarcodePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.ITEMS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const sumber = bacaSumberDokumen(sp.dari);
  const itemIds = (Array.isArray(sp.item) ? sp.item : sp.item ? [sp.item] : [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 64)
    .slice(0, 20);

  const dariDokumen = sumber ? await isiLabelDariDokumen(sumber) : null;
  const dokumen: DokumenLabelLayar | null = dariDokumen
    ? {
        jenis: dariDokumen.sumber.jenis,
        nomor: dariDokumen.nomor,
        toko: dariDokumen.toko,
        totalDokumen: dariDokumen.totalDokumen,
        tanpaUkuran: dariDokumen.tanpaUkuran,
        dilewati: dariDokumen.dilewati,
      }
    : null;
  let barang: BarangLabel[] = dariDokumen?.barang ?? [];
  let jumlah: JumlahLabel = dariDokumen?.jumlah ?? {};

  const dariAlamat = itemIds.length > 0 ? await barangUntukLabel(itemIds) : [];
  for (const b of dariAlamat) {
    if (barang.some((x) => x.itemId === b.itemId)) continue;
    barang = [...barang, b];
    jumlah = { ...jumlah, ...jumlahAwal(b) };
  }

  return (
    <LabelBarcodeClient
      key={JSON.stringify([sp.item ?? null, sp.dari ?? null])}
      barangAwal={barang}
      jumlahAwal={jumlah}
      dokumen={dokumen}
      dokumenTidakAda={Boolean(sp.dari) && dokumen === null}
      itemTidakAda={itemIds.length > 0 && dariAlamat.length === 0}
    />
  );
}
