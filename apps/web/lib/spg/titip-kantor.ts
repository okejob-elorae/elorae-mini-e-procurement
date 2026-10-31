import { prisma } from "@elorae/db";
import { STATUS_TITIP, type StatusTitip } from "./titip";

/**
 * Titip pesan untuk layar kantor (`/backoffice/spg-pelanggan?tab=titip`):
 * per toko, berapa permintaan di tiap status, permintaan menunggu yang paling
 * lama, dan barang yang paling sering dititip-pesankan — bahan kiriman
 * berikutnya dan barang yang perlu diproduksi. Tanpa data pribadi pembeli.
 */

export type RingkasTitipToko = {
  storeId: string;
  toko: string;
  kode: string;
  perStatus: Record<StatusTitip, number>;
  terbuka: number;
  menungguTertua: string | null;
  /** Barang paling sering dititip: nama barang katalog, atau keterangan bebas yang sama. */
  palingSering: { label: string; jumlah: number; katalog: boolean } | null;
};

const kosong = (): Record<StatusTitip, number> => Object.fromEntries(STATUS_TITIP.map((s) => [s, 0])) as Record<StatusTitip, number>;

export async function ringkasTitipKantor(): Promise<RingkasTitipToko[]> {
  const [status, tertua, perBarang, perKeterangan] = await Promise.all([
    prisma.customerRequest.groupBy({ by: ["storeId", "status"], _count: { _all: true } }),
    prisma.customerRequest.groupBy({ by: ["storeId"], where: { status: "MENUNGGU" }, _min: { createdAt: true } }),
    prisma.customerRequest.groupBy({ by: ["storeId", "itemId"], where: { itemId: { not: null } }, _count: { _all: true } }),
    prisma.customerRequest.groupBy({ by: ["storeId", "description"], where: { itemId: null }, _count: { _all: true } }),
  ]);
  const storeIds = [...new Set(status.map((s) => s.storeId))];
  if (storeIds.length === 0) return [];
  const itemIds = [...new Set(perBarang.map((b) => b.itemId as string))];
  const [toko, item] = await Promise.all([
    prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true, code: true } }),
    itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true } }) : Promise.resolve([]),
  ]);
  const tokoPer = new Map(toko.map((t) => [t.id, t]));
  const namaBarang = new Map(item.map((i) => [i.id, i.nameId]));
  const tertuaPer = new Map(tertua.map((t) => [t.storeId, t._min.createdAt]));

  const hasil = new Map<string, RingkasTitipToko>();
  for (const id of storeIds) {
    const t = tokoPer.get(id);
    const m = tertuaPer.get(id);
    hasil.set(id, {
      storeId: id,
      toko: t?.name ?? "—",
      kode: t?.code ?? "",
      perStatus: kosong(),
      terbuka: 0,
      menungguTertua: m ? m.toISOString() : null,
      palingSering: null,
    });
  }
  for (const s of status) {
    const r = hasil.get(s.storeId);
    if (!r || !(STATUS_TITIP as readonly string[]).includes(s.status)) continue;
    r.perStatus[s.status as StatusTitip] += s._count._all;
    if (s.status === "MENUNGGU" || s.status === "TERSEDIA" || s.status === "DIKABARI") r.terbuka += s._count._all;
  }
  const calon = (storeId: string, label: string, jumlah: number, katalog: boolean) => {
    const r = hasil.get(storeId);
    if (!r) return;
    if (!r.palingSering || jumlah > r.palingSering.jumlah) r.palingSering = { label, jumlah, katalog };
  };
  for (const b of perBarang) calon(b.storeId, namaBarang.get(b.itemId as string) ?? "—", b._count._all, true);
  // Keterangan bebas yang sama persis dihitung bersama; beda ejaan tetap terpisah.
  for (const k of perKeterangan) calon(k.storeId, k.description, k._count._all, false);

  return [...hasil.values()].sort((a, b) => b.terbuka - a.terbuka || a.toko.localeCompare(b.toko));
}
