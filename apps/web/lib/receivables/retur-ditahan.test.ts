import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { buatKlaimPembayaran } from "./claim-writer";
import { batalkanRetur, catatHitunganGudang } from "./return-writer";
import { bacaSisaDanTahanan, putuskanKlaim } from "./writer";
import { daftarPiutang } from "./queries";

/**
 * KEPUTUSAN SEMENTARA PEMILIK 2026-10-06 — BKM kedua tidak boleh melunasi
 * bagian faktur yang masih DITAHAN retur, terhadap basis data sungguhan.
 *
 * Kejadiannya (audit "d"): faktur 1.000.000; BKM pertama melunasi 1 jt dengan
 * memotong retur 300.000 yang belum dihitung gudang → terverifikasi, sisa
 * 300.000 (ditahan Aturan 2). BKM kedua 300.000 "melunasi sisanya" — lalu gudang
 * menghitung barangnya utuh, tahanan lepas, dan toko sudah membayar 1,3 jt untuk
 * faktur 1 jt tanpa ada yang melihat (sisa dijepit di nol).
 *
 * Penjaganya hidup di transaksi serializable, jadi tiruan tidak bisa
 * membuktikannya. Basis data dipakai bersama data dev: pengguna DIPINJAM,
 * setiap penghapusan lewat `seededId()`.
 */

const tag = `TAHAN-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);

let salesId = "";
let keuanganId = "";
let gudangId = "";
let tokoId = "";
let piutangId = "";
let klaimIds: string[] = [];
let nrtIds: string[] = [];
let urut = 0;

beforeEach(async () => {
  salesId = "";
  keuanganId = "";
  gudangId = "";
  tokoId = "";
  piutangId = "";
  klaimIds = [];
  nrtIds = [];

  const orang = await prisma.user.findMany({ select: { id: true }, take: 3, orderBy: { createdAt: "asc" } });
  if (orang.length < 3) throw new Error("Basis data uji butuh tiga pengguna");
  salesId = orang[0].id;
  keuanganId = orang[1].id;
  gudangId = orang[2].id;

  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-A`, name: `${tag} A`, address: "uji", termsType: "PUTUS", isActive: true },
    })
  ).id;
  piutangId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/INV`,
        storeId: tokoId,
        salesmanId: salesId,
        invoiceDate: wib("2026-09-01"),
        dueDate: wib("2026-10-01"),
        amount: 1_000_000,
        outstanding: 1_000_000,
        source: "MANUAL",
      },
    })
  ).id;
});

afterEach(async () => {
  const klaimToko = tokoId
    ? await prisma.paymentClaim.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } })
    : [];
  klaimIds = [...new Set([...klaimIds, ...klaimToko.map((k) => k.id)])];
  const nri = nrtIds.length
    ? await prisma.warehouseReturn.findMany({ where: { storeReturnId: { in: seededIds(nrtIds) } }, select: { id: true } })
    : [];
  const beban = nrtIds.length
    ? await prisma.returnCharge.findMany({ where: { storeReturnId: { in: seededIds(nrtIds) } }, select: { id: true } })
    : [];
  const entitas = [...klaimIds, ...nrtIds, ...nri.map((n) => n.id), ...beban.map((b) => b.id), piutangId].filter(Boolean);
  if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
  if (beban.length) await prisma.returnCharge.deleteMany({ where: { id: { in: seededIds(beban.map((b) => b.id)) } } });
  if (klaimIds.length) await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds) } } });
  if (nri.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nri.map((n) => n.id)) } } });
  if (nrtIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(nrtIds) } } });
  if (piutangId) await prisma.receivable.delete({ where: { id: seededId(piutangId) } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
});

async function nrt(nilai = 300_000) {
  urut += 1;
  const n = await prisma.storeReturn.create({
    data: { noNrt: `${tag}-NRT-${urut}`, storeId: tokoId, salesmanId: salesId, claimDate: wib("2026-09-20"), claimedAmount: nilai },
  });
  nrtIds.push(n.id);
  return n.id;
}

async function lapor(nilai: number, potongan?: { nilai: number; nrtId: string }) {
  const h = await buatKlaimPembayaran({
    storeId: tokoId,
    salesmanId: salesId,
    createdById: salesId,
    claimedTransferAt: wib("2026-09-25"),
    method: "transfer",
    pelunasan: [{ receivableId: piutangId, nilai }],
    potongan: potongan ? [{ nama: "Retur", nilai: potongan.nilai, storeReturnId: potongan.nrtId }] : [],
    transferPhotoUrl: "/api/foto/uji",
  });
  if (h.ok && !klaimIds.includes(h.id)) klaimIds.push(h.id);
  return h;
}

const verifikasi = (id: string) => putuskanKlaim({ paymentClaimId: id, keputusan: "TERVERIFIKASI", olehUserId: keuanganId });

async function hitungGudang(nrtId: string, fisik: number) {
  const h = await catatHitunganGudang({
    storeReturnId: nrtId,
    warehouseUserId: gudangId,
    receivedAt: wib("2026-09-28"),
    deliveryMethod: "SALES",
    physicalAmount: fisik,
  });
  if (!h.ok) throw new Error(`hitungan gagal: ${h.alasan}`);
}

/** Jumlah yang dilunasi BKM terverifikasi atas faktur ini — tidak boleh melebihi 1 jt. */
async function dilunasiTerverifikasi() {
  const t = await prisma.paymentClaimReceivable.findMany({
    where: { receivableId: seededId(piutangId), paymentClaim: { status: "TERVERIFIKASI" } },
    select: { settledAmount: true },
  });
  return t.reduce((s, x) => s + Number(x.settledAmount), 0);
}

describe("BKM kedua tidak boleh melunasi bagian faktur yang ditahan retur", () => {
  it("saat dibuat: sisa 300 rb seluruhnya ditahan → BKM 300 rb (bahkan 1 rupiah) ditolak RETUR_DITAHAN", async () => {
    const n = await nrt();
    const a = await lapor(1_000_000, { nilai: 300_000, nrtId: n });
    if (!a.ok) throw new Error(`BKM pertama harus tercatat: ${a.alasan}`);
    expect(await verifikasi(a.id)).toEqual({ ok: true, sisaBaru: [300_000] });
    expect(await bacaSisaDanTahanan(prisma, piutangId)).toEqual({ sisa: 300_000, tertahan: 300_000 });
    // Layar BKM membaca batas yang sama dari daftar piutang.
    const [baris] = await daftarPiutang({ receivableIds: [piutangId] });
    expect(baris).toMatchObject({ outstanding: 300_000, bolehDilunasi: 0, keadaan: "tertahan" });

    expect(await lapor(300_000)).toEqual({ ok: false, alasan: "RETUR_DITAHAN" });
    expect(await lapor(1)).toEqual({ ok: false, alasan: "RETUR_DITAHAN" });

    // Gudang menghitung barangnya utuh: tahanan lepas, faktur lunas — tanpa BKM kedua.
    await hitungGudang(n, 300_000);
    expect(await bacaSisaDanTahanan(prisma, piutangId)).toEqual({ sisa: 0, tertahan: 0 });
    expect(await lapor(300_000)).toEqual({ ok: false, alasan: "SUDAH_LUNAS" });
    expect(await dilunasiTerverifikasi()).toBe(1_000_000);
  });

  it("saat dibuat: hanya bagian yang TIDAK ditahan yang boleh dilunasi (sisa 800 rb, ditahan 300 rb → 500 rb)", async () => {
    const n = await nrt();
    const a = await lapor(500_000, { nilai: 300_000, nrtId: n });
    if (!a.ok) throw new Error("BKM pertama harus tercatat");
    expect(await verifikasi(a.id)).toEqual({ ok: true, sisaBaru: [800_000] });
    expect((await daftarPiutang({ receivableIds: [piutangId] }))[0]).toMatchObject({ outstanding: 800_000, bolehDilunasi: 500_000 });

    expect(await lapor(500_001)).toEqual({ ok: false, alasan: "RETUR_DITAHAN" });
    const b = await lapor(500_000);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(await verifikasi(b.id)).toEqual({ ok: true, sisaBaru: [300_000] });
  });

  it("saat diverifikasi: BKM kedua yang tercatat SEBELUM yang pertama terverifikasi ditolak RETUR_DITAHAN dan tetap DIKIRIM", async () => {
    const n = await nrt();
    const a = await lapor(1_000_000, { nilai: 300_000, nrtId: n });
    const b = await lapor(300_000);
    if (!a.ok || !b.ok) throw new Error("kedua BKM harus tercatat (yang tertunda belum menahan apa pun)");
    expect((await verifikasi(a.id)).ok).toBe(true);

    expect(await verifikasi(b.id)).toEqual({ ok: false, alasan: "RETUR_DITAHAN" });
    expect((await prisma.paymentClaim.findUniqueOrThrow({ where: { id: seededId(b.id) } })).status).toBe("DIKIRIM");
    expect(await dilunasiTerverifikasi()).toBe(1_000_000);
  });

  it("nota retur yang DIBATALKAN menahan tetap — toko berutang potongannya, jadi BKM berikutnya boleh melunasinya", async () => {
    const n = await nrt();
    const a = await lapor(1_000_000, { nilai: 300_000, nrtId: n });
    if (!a.ok) throw new Error("BKM pertama harus tercatat");
    expect((await verifikasi(a.id)).ok).toBe(true);
    // Selama notanya hidup dan belum dihitung, bagian itu lepas sendiri: ditolak.
    expect(await lapor(300_000)).toEqual({ ok: false, alasan: "RETUR_DITAHAN" });

    // Kantor membatalkan notanya (barangnya tidak pernah ada): potongan 300 rb kini utang toko.
    expect((await batalkanRetur({ storeReturnId: n, alasan: "nota fiktif", olehUserId: keuanganId })).ok).toBe(true);
    expect(await bacaSisaDanTahanan(prisma, piutangId)).toEqual({ sisa: 300_000, tertahan: 0 });
    expect((await daftarPiutang({ receivableIds: [piutangId] }))[0]).toMatchObject({ outstanding: 300_000, bolehDilunasi: 300_000 });

    const b = await lapor(300_000);
    if (!b.ok) throw new Error(`BKM penagih harus tercatat: ${b.alasan}`);
    expect(await verifikasi(b.id)).toEqual({ ok: true, sisaBaru: [0] });
    // Uang yang masuk: 700 rb + 300 rb = faktur 1 jt; potongan fiktifnya tertagih penuh.
    const tunai = await prisma.paymentClaim.findMany({
      where: { id: { in: seededIds([a.id, b.id]) } },
      select: { receivedAmount: true },
    });
    expect(tunai.reduce((s, k) => s + Number(k.receivedAmount), 0)).toBe(1_000_000);
  });

  it("menolak RETUR_DITAHAN tidak menyentuh BKM tanpa retur tertahan: dua BKM biasa tetap diatur MELEBIHI_SISA", async () => {
    const a = await lapor(600_000);
    const b = await lapor(600_000);
    if (!a.ok || !b.ok) throw new Error("BKM harus tercatat");
    expect((await verifikasi(a.id)).ok).toBe(true);
    expect(await verifikasi(b.id)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
  });

  it("balapan: BKM ber-retur 1 jt dan BKM 300 rb diverifikasi bersamaan — hanya satu yang lolos, faktur tidak pernah terbayar lebih dari 1 jt", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      // Putaran baru: BKM lama dibatalkan supaya faktur kembali utuh.
      await prisma.paymentClaim.updateMany({
        where: { id: { in: seededIds(klaimIds).filter(Boolean) } },
        data: { status: "DIBATALKAN" },
      });
      const n = await nrt();
      const a = await lapor(1_000_000, { nilai: 300_000, nrtId: n });
      const b = await lapor(300_000);
      if (!a.ok || !b.ok) throw new Error("kedua BKM harus tercatat");

      const hasil = await Promise.all([verifikasi(a.id), verifikasi(b.id)]);
      expect(hasil.filter((h) => h.ok)).toHaveLength(1);
      const gagal = hasil.find((h) => !h.ok);
      // BKM ber-retur lebih dulu → yang 300 rb masuk bagian ditahan; sebaliknya → yang 1 jt melebihi sisa.
      expect(["RETUR_DITAHAN", "MELEBIHI_SISA"]).toContain(gagal && !gagal.ok ? gagal.alasan : "");
      expect(await dilunasiTerverifikasi()).toBeLessThanOrEqual(1_000_000);
    }
  });
});
