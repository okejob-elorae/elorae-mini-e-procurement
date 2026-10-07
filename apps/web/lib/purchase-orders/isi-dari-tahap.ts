import { prisma } from "@elorae/db";
import { ruangKerjaTahap } from "@/lib/production/jadwal-queries";
import { catatanProduksi, susunIsiKurang, type KebutuhanTahapPo } from "./kebutuhan-tahap";
import { tahapPo, type TahapPo } from "./tahap";

/*
 * Formulir PO baru dari ruang kerja tahap (`?planStageId=&isi=kurang&bahan=`).
 * Kebutuhan bahan dibaca lewat `ruangKerjaTahap` — kueri yang SAMA dengan kartu
 * Kebutuhan bahan, jadi qty yang terisi = kekurangan yang tampil di kartu.
 * "Sudah di-PO" selalu dihitung (PO tahap yang tidak batal), apa pun izin lihat
 * PO pembukanya: tanpa itu kekurangan akan terisi ganda.
 */

export type BarisIsiPo = { itemId: string; uomId: string; qty: number };

export type IsiPoDariTahap = {
  tahap: TahapPo;
  kebutuhan: KebutuhanTahapPo;
  /** null bila formulir tidak diminta terisi (`isi` bukan "kurang"). */
  isi: { notes: string; items: BarisIsiPo[] } | null;
};

export async function isiPoDariTahap(
  planStageId: string,
  opsi: { isiKurang: boolean; bahan?: readonly string[] },
): Promise<IsiPoDariTahap | null> {
  const data = await ruangKerjaTahap(planStageId, { lihatPo: true, lihatSpk: false });
  if (!data) return null;
  const { tahap } = data;

  const kebutuhan: KebutuhanTahapPo = {
    tahapId: tahap.id,
    targetQty: tahap.targetQty,
    bahan: data.kebutuhan.map((k) => ({
      itemId: k.itemId,
      nama: k.nama,
      sku: k.sku,
      satuan: k.satuan,
      perPcs: k.perPcs,
      wastePercent: k.wastePercent,
      butuh: k.butuh,
      diPo: k.diPo,
    })),
  };
  const tahapTampil = tahapPo({ id: tahap.id, name: tahap.name, planCategory: { code: tahap.kategori.code } }) as TahapPo;

  if (!opsi.isiKurang) return { tahap: tahapTampil, kebutuhan, isi: null };

  const baris = susunIsiKurang(kebutuhan.bahan, opsi.bahan);
  const satuan =
    baris.length > 0
      ? await prisma.item.findMany({ where: { id: { in: baris.map((b) => b.itemId) } }, select: { id: true, uomId: true } })
      : [];
  const uom = new Map(satuan.map((s) => [s.id, s.uomId]));
  return {
    tahap: tahapTampil,
    kebutuhan,
    isi: {
      notes: catatanProduksi(tahap.name, tahap.kategori),
      items: baris.map((b) => ({ itemId: b.itemId, uomId: uom.get(b.itemId) ?? "", qty: b.qty })),
    },
  };
}
