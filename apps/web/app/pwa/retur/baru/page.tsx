import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { bahanSalinRetur, tokoUntukRetur } from "@/lib/receivables/return-queries";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { stokToko } from "@/lib/spg/queries";
import { bacaIdRusak } from "@/lib/spg/rusak";
import { barisRusakUntukRetur } from "@/lib/spg/rusak-queries";
import { barisReturPembeliUntukRetur } from "@/lib/spg/gudang-rusak-queries";
import { pilihanBarang } from "@/app/pwa/spg/stok/pilihan";
import { ReturBaruClient } from "./ReturBaruClient";
import { ReturSpgClient, type AwalReturSpg, type BarisRusakAwal } from "./ReturSpgClient";
import type { BarisRusakPembeliAwal } from "./BarisRusakPembeli";

export const dynamic = "force-dynamic";

export default async function ReturBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ salin?: string; dariRusak?: string; dariReturPembeli?: string; toko?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const [terkunci, tokoTetap] = await Promise.all([tokoTerkunci(), ambilTokoTetap(session.user.id)]);
  // "Laporkan ulang": hanya nota batal milik orang ini.
  const { salin, dariRusak, dariReturPembeli, toko: tokoDiminta } = await searchParams;
  const awal = salin ? await bahanSalinRetur(salin, { salesmanId: session.user.id }) : null;

  // SPG: nota dengan baris barang dari buku stok toko tetapnya. Tokonya
  // ditetapkan server (aksinya menolak toko lain), jadi tidak ada pilihan toko.
  if (tokoTetap) {
    const toko = await prisma.store.findUnique({
      where: { id: tokoTetap },
      select: { id: true, name: true, termsType: true },
    });
    if (!toko) redirect("/pwa");
    const stok = await stokToko(toko.id);
    const barang = await pilihanBarang(stok);
    let awalSpg: AwalReturSpg | null = null;
    // Barang rusak kiriman yang dikirim balik (`?dariRusak=`, dari layar Terima
    // kiriman) dan baris rusak dari nota batal yang disalin. Sisanya dihitung
    // server; penulis nota memeriksa ulang semuanya di transaksinya.
    const idRusak = bacaIdRusak(dariRusak);
    // Barang rusak dari pembeli di konter (`?dariReturPembeli=`, dari layar
    // Terima kiriman) — pola yang sama: barisnya menunjuk retur pembeli.
    const idPembeli = bacaIdRusak(dariReturPembeli);
    const qtySalinRusak = new Map<string, number>();
    const qtySalinPembeli = new Map<string, number>();
    if (awal) {
      const semuaBaris = await prisma.storeReturnItem.findMany({
        where: { storeReturnId: awal.dariId, itemId: { not: null } },
        select: { itemId: true, variantSku: true, qty: true, condition: true, storeReceiptLineId: true, spgSaleReturnLineId: true },
      });
      for (const b of semuaBaris) {
        if (b.storeReceiptLineId) qtySalinRusak.set(b.storeReceiptLineId, (qtySalinRusak.get(b.storeReceiptLineId) ?? 0) + b.qty);
        if (b.spgSaleReturnLineId) qtySalinPembeli.set(b.spgSaleReturnLineId, (qtySalinPembeli.get(b.spgSaleReturnLineId) ?? 0) + b.qty);
      }
      const baris = semuaBaris.filter((b) => !b.storeReceiptLineId && !b.spgSaleReturnLineId);
      awalSpg = {
        dariId: awal.dariId,
        dariNoNrt: awal.dariNoNrt,
        // Nomor TRK buatan sistem tidak disalin: nota pengganti mendapat nomornya sendiri.
        noNrt: awal.noNrt.startsWith("TRK/") ? "" : awal.noNrt,
        tanggal: awal.tanggal,
        caraKirim: awal.caraKirim,
        // Nilai toko KONSI tidak pernah sampai ke HP.
        nilai: toko.termsType === "PUTUS" ? awal.nilai : null,
        foto: awal.foto,
        baris: baris.map((b) => ({ itemId: b.itemId as string, variantSku: b.variantSku, qty: b.qty, condition: b.condition })),
      };
    }
    const dicari = [...new Set([...idRusak, ...qtySalinRusak.keys()])];
    const rusakSah = await barisRusakUntukRetur(toko.id, dicari);
    const rusak: BarisRusakAwal[] = rusakSah.map((r) => ({
      receiptLineId: r.receiptLineId,
      itemId: r.itemId,
      variantSku: r.variantSku,
      nama: r.productName,
      docNo: r.docNo,
      sisa: r.sisa,
      qty: Math.min(r.sisa, qtySalinRusak.get(r.receiptLineId) ?? r.sisa),
    }));
    const dicariPembeli = [...new Set([...idPembeli, ...qtySalinPembeli.keys()])];
    const pembeliSah = await barisReturPembeliUntukRetur(toko.id, dicariPembeli);
    const rusakPembeli: BarisRusakPembeliAwal[] = pembeliSah.map((r) => ({
      spgSaleReturnLineId: r.id,
      itemId: r.itemId,
      variantSku: r.variantSku,
      nama: r.productName,
      docNo: r.docNo,
      kondisi: r.kondisi,
      sisa: r.sisa,
      qty: Math.min(r.sisa, qtySalinPembeli.get(r.id) ?? r.sisa),
    }));
    return (
      <ReturSpgClient
        toko={toko}
        barang={barang}
        bukuDimulai={stok.length > 0}
        awal={awalSpg}
        rusak={rusak}
        rusakPembeli={rusakPembeli}
        rusakTidakBisa={dicari.length - rusak.length + dicariPembeli.length - rusakPembeli.length}
      />
    );
  }

  // Salesman dengan kunci "hanya toko sendiri": hanya toko yang ia pegang.
  const opsi = terkunci ? { hanyaMilik: session.user.id } : undefined;
  const pilihan = await tokoUntukRetur(opsi);
  // "Lapor retur" dari halaman toko (`?toko=`): toko itu terpilih hanya bila ada
  // di pemilih toko ini — aturan yang sama. Selain itu diabaikan.
  const tokoAwal =
    typeof tokoDiminta === "string" && pilihan.some((t) => t.id === tokoDiminta) ? tokoDiminta : null;
  return <ReturBaruClient toko={pilihan} awal={awal} tokoAwal={tokoAwal} />;
}
