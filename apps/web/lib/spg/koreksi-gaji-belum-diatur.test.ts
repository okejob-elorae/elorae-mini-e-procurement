import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { hapusGajiUji, siapkanGajiUji } from "./gaji-pokok-uji";
import { DASAR_TARIF_KATEGORI } from "./komisi";
import { daftarTunggakanKomisi, jumlahGajiSpgBelumDiatur, jumlahKomisiSpgTertunggak } from "./koreksi-queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Angka Beranda `spgSalariesUnset` terhadap basis data sungguhan: tunggakan yang ditahan karena gaji
 * bulanan SPG belum diatur (P60) — satu definisi dengan bagian ditahan kartu #tunggakan, dan tidak
 * pernah dihitung juga sebagai tunggakan yang bisa dibayar. Sari menjual di toko putus September;
 * laporannya dicek Oktober, jadi barisnya tunggakan di November. Semua baris diseed di sini;
 * penghapusan lewat `seededId(s)`.
 */
d("gaji bulanan SPG belum diatur di Beranda (test bed only)", () => {
  const tag = `GBD${Math.random().toString(36).slice(2, 8)}`;
  const sekarang = new Date("2026-11-05T09:00:00+07:00");
  let toko = "";
  let sari = "";
  let kantor = "";

  beforeEach(async () => {
    toko = "";
    sari = "";
    kantor = "";
    kantor = (await prisma.user.create({ data: { email: `${tag}-kantor@test.local`, name: `Kantor ${tag}` } })).id;
    toko = (await prisma.store.create({ data: { code: `${tag}-P`, name: `Toko ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    sari = (await prisma.user.create({ data: { email: `${tag}-sari@test.local`, name: `Sari ${tag}`, assignedStoreId: toko, spgStartedOn: "2026-09-01" } })).id;
    await prisma.spgCommission.create({
      data: { userId: sari, storeId: toko, period: "2026-09", unitsSold: 0, commission: 0, basis: DASAR_TARIF_KATEGORI, lockedById: kantor },
    });
    await prisma.spgSalesCheck.create({ data: { storeId: toko, period: "2026-09", checkedById: kantor, checkedAt: new Date("2026-10-05T10:00:00+07:00") } });
  });

  afterEach(async () => {
    await hapusGajiUji([sari]);
    await prisma.spgCommission.deleteMany({ where: { storeId: seededId(toko) } });
    await prisma.spgSalesCheck.deleteMany({ where: { storeId: seededId(toko) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sari, kantor].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: seededId(toko) } });
  });

  it("hanya tunggakan yang ditahan GAJI_POKOK_BELUM_DIATUR, sama dengan daftar yang dibuka, tidak pernah juga dihitung bisa dibayar", async () => {
    const scope = { userIds: [sari] };
    const ditahanGaji = async () => (await daftarTunggakanKomisi(prisma, sekarang, scope)).filter((t) => t.ditahan === "GAJI_POKOK_BELUM_DIATUR").length;

    // (1) Gaji bulanan belum diatur: dihitung di sini, bukan di tunggakan yang bisa dibayar.
    expect(await jumlahGajiSpgBelumDiatur(sekarang, scope)).toBe(1);
    expect(await ditahanGaji()).toBe(1);
    expect(await jumlahKomisiSpgTertunggak(sekarang, scope)).toBe(0);

    // (2) Gaji diatur, tetapi dasar harinya belum ada: ditahan sebab lain — tidak dihitung di sini.
    await prisma.spgSalary.create({ data: { userId: sari, effectiveFrom: "2026-09", monthlyAmount: 3_000_000, createdById: kantor } });
    expect(await jumlahGajiSpgBelumDiatur(sekarang, scope)).toBe(0);
    expect((await daftarTunggakanKomisi(prisma, sekarang, scope)).map((t) => t.ditahan)).toEqual(["CATATAN_HADIR_BELUM_DIMASUKKAN"]);
    expect(await jumlahKomisiSpgTertunggak(sekarang, scope)).toBe(0);

    // (3) Dasar harinya pasti: bisa dibayar.
    await siapkanGajiUji({ userId: sari, storeId: toko, bulan: "2026-09", jumlah: 3_000_000, olehUserId: kantor });
    expect(await jumlahGajiSpgBelumDiatur(sekarang, scope)).toBe(0);
    expect(await jumlahKomisiSpgTertunggak(sekarang, scope)).toBe(1);
  });
});
