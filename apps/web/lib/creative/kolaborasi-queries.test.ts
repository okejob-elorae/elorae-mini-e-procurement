import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { AMBANG_BAWAAN } from "./ambang";
import { PARAM_KOLABORASI_AWAL, TAHAP_KELUAR, UKURAN_HALAMAN_KOLABORASI, type ParamKolaborasi } from "./kolaborasi-param";
import { cariKolUntukKolaborasi, daftarKolaborasi, detailKolaborasi, ringkasRiwayatKol } from "./kolaborasi-queries";
import { SEMUA_TAHAP, type Tahap } from "./tahap";

/*
 * Kueri daftar Kolaborasi terhadap basis data sungguhan. Basis data dev dipakai
 * bersama, jadi setiap kueri dicakup ke campaign milik tes ini.
 *
 * Yang dikunci: angka di chip tahap SAMA dengan panjang daftar yang terbuka
 * saat chip itu diklik — perbaikan KOL Manager yang chip-nya tanpa angka, dan
 * jebakan klasik daftar yang menghitung dengan saringan berbeda dari yang
 * ditampilkannya.
 */

const tag = `KLQ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const opsi = { hariIni: "2026-10-07", ambang: AMBANG_BAWAAN };
let userId = "";
let kolIg = "";
let kolTt = "";
let campaignId = "";

beforeEach(async () => {
  userId = "";
  kolIg = "";
  kolTt = "";
  campaignId = "";
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolIg = (
    await prisma.kol.create({
      data: { name: `${tag} Ayu`, accounts: { create: [{ platform: "INSTAGRAM", handle: `${tag.toLowerCase()}ayu`, followers: 50_000 }] } },
      select: { id: true },
    })
  ).id;
  kolTt = (
    await prisma.kol.create({
      data: {
        name: `${tag} Bima`,
        blockedAt: new Date(),
        accounts: { create: [{ platform: "TIKTOK", handle: `${tag.toLowerCase()}bima`, followers: 9_000 }] },
      },
      select: { id: true },
    })
  ).id;
  campaignId = (await prisma.kolCampaign.create({ data: { name: `${tag} Lebaran` }, select: { id: true } })).id;
});

afterEach(async () => {
  const kolIds = [kolIg, kolTt].filter(Boolean);
  const ids = (await prisma.kolBrief.findMany({ where: { kolId: { in: seededIds(kolIds) } }, select: { id: true } })).map((b) => b.id);
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(ids) } } });
  await prisma.kolCampaign.deleteMany({ where: { id: { in: seededIds([campaignId].filter(Boolean)) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

let urut = 0;
async function kolab(kolId: string, tahap: Tahap, tambahan: { picId?: string; tahapAt?: Date } = {}) {
  urut += 1;
  return (
    await prisma.kolBrief.create({
      data: {
        docNo: `${tag}/${String(urut).padStart(4, "0")}`,
        kolId,
        campaignId,
        tahap,
        picId: tambahan.picId ?? null,
        ...(tambahan.tahapAt ? { tahapAt: tambahan.tahapAt } : {}),
      },
      select: { id: true },
    })
  ).id;
}

const param = (ubah: Partial<ParamKolaborasi> = {}): ParamKolaborasi => ({ ...PARAM_KOLABORASI_AWAL, campaign: campaignId, ...ubah });

describe("daftarKolaborasi", () => {
  it("angka di setiap chip sama dengan panjang daftar chip itu", async () => {
    await kolab(kolIg, "PROSPEK");
    await kolab(kolIg, "PROSPEK");
    await kolab(kolIg, "DEAL");
    await kolab(kolTt, "TAYANG");
    await kolab(kolTt, "GHOSTING");
    await kolab(kolIg, "BATAL");

    const semua = await daftarKolaborasi(param(), opsi);
    expect(semua.jumlah.semua).toBe(6);
    expect(semua.total).toBe(6);
    expect(semua.baris).toHaveLength(6);
    expect(semua.jumlah.keluar).toBe(2);

    for (const t of SEMUA_TAHAP) {
      const d = await daftarKolaborasi(param({ tahap: t }), opsi);
      expect(d.total, t).toBe(semua.jumlah.perTahap[t]);
      expect(d.baris, t).toHaveLength(semua.jumlah.perTahap[t]);
      expect(d.baris.every((b) => b.tahap === t)).toBe(true);
    }
    const keluar = await daftarKolaborasi(param({ tahap: TAHAP_KELUAR }), opsi);
    expect(keluar.baris).toHaveLength(2);
    expect(keluar.baris.map((b) => b.tahap).sort()).toEqual(["BATAL", "GHOSTING"]);
  });

  it("saringan platform, PIC, dan cari (nama, @username, nomor) ikut mengubah angka chip", async () => {
    await kolab(kolIg, "DEAL", { picId: userId });
    await kolab(kolTt, "DEAL");
    const tt = await daftarKolaborasi(param({ platform: "TIKTOK" }), opsi);
    expect(tt.total).toBe(1);
    expect(tt.jumlah.perTahap.DEAL).toBe(1);
    expect(tt.baris[0].kol).toMatchObject({ id: kolTt, platform: "TIKTOK", diblokir: true });

    const pic = await daftarKolaborasi(param({ pic: userId }), opsi);
    expect(pic.baris.map((b) => b.kol.id)).toEqual([kolIg]);

    const handle = await daftarKolaborasi(param({ cari: `@${tag.toLowerCase()}ayu` }), opsi);
    expect(handle.baris.map((b) => b.kol.id)).toEqual([kolIg]);
    const nama = await daftarKolaborasi(param({ cari: "bima" }), opsi);
    expect(nama.baris.map((b) => b.kol.id)).toEqual([kolTt]);
    const nomor = await daftarKolaborasi(param({ cari: tt.baris[0].docNo }), opsi);
    expect(nomor.total).toBe(1);
  });

  it("berhalaman 25, halaman di luar batas dijepit ke halaman terakhir", async () => {
    await prisma.kolBrief.createMany({
      data: Array.from({ length: UKURAN_HALAMAN_KOLABORASI + 1 }, (_, i) => ({
        docNo: `${tag}/M${String(i).padStart(3, "0")}`,
        kolId: kolIg,
        campaignId,
        tahap: "PROSPEK" as const,
      })),
    });
    const h1 = await daftarKolaborasi(param(), opsi);
    expect(h1.baris).toHaveLength(UKURAN_HALAMAN_KOLABORASI);
    expect(h1.total).toBe(UKURAN_HALAMAN_KOLABORASI + 1);
    const h2 = await daftarKolaborasi(param({ halaman: 2 }), opsi);
    expect(h2.baris).toHaveLength(1);
    const h9 = await daftarKolaborasi(param({ halaman: 9 }), opsi);
    expect(h9.halaman).toBe(2);
    expect(new Set([...h1.baris, ...h2.baris].map((b) => b.id)).size).toBe(UKURAN_HALAMAN_KOLABORASI + 1);
  });

  it("papan hanya memuat yang berjalan, yang paling lama di tahapnya lebih dulu, dan umur merah lewat ambang", async () => {
    const lama = await kolab(kolIg, "DEAL", { tahapAt: new Date("2026-09-01T03:00:00Z") });
    await kolab(kolIg, "DEAL", { tahapAt: new Date("2026-10-06T03:00:00Z") });
    await kolab(kolIg, "SELESAI");
    await kolab(kolIg, "BATAL");
    const p = await daftarKolaborasi(param({ tampilan: "papan", tahap: "BATAL" }), opsi);
    expect(p.baris.map((b) => b.tahap)).toEqual(["DEAL", "DEAL"]);
    expect(p.baris[0].id).toBe(lama);
    expect(p.baris[0].umurMerah).toBe(true);
    expect(p.baris[1].umurMerah).toBe(false);
    expect(p.terpotong).toBe(false);
    // Deal tanpa pengiriman: tenggat kirim sampel, sudah lewat untuk yang lama.
    expect(p.baris[0].tenggat).toMatchObject({ jenis: "KIRIM_SAMPEL", lewat: true });
  });
});

describe("ringkasRiwayatKol dan cari KOL", () => {
  it("menghitung kolaborasi, fee terakhir, ghosting dan menolak", async () => {
    const a = await kolab(kolIg, "SELESAI");
    await prisma.kolBrief.update({ where: { id: a }, data: { fee: 750_000 } });
    await kolab(kolIg, "GHOSTING");
    await kolab(kolIg, "DITOLAK");
    const r = await ringkasRiwayatKol(kolIg);
    expect(r).toMatchObject({ jumlahKolaborasi: 3, ghosting: 1, ditolak: 1, feeTerakhir: { fee: 750_000 } });
    expect(r!.kol.diblokir).toBe(false);
  });

  it("autocomplete butuh 2 huruf dan menandai KOL yang diblokir", async () => {
    expect(await cariKolUntukKolaborasi("b")).toEqual([]);
    const h = await cariKolUntukKolaborasi(`@${tag.toLowerCase()}bima`);
    expect(h.map((k) => k.id)).toEqual([kolTt]);
    expect(h[0]).toMatchObject({ diblokir: true, platform: "TIKTOK", followers: 9_000 });
  });
});

describe("detailKolaborasi — data kirim dan mode pajak", () => {
  it("menyebut tepat kolom data kirim yang kosong (aturan yang sama dengan Hari ini) dan membawa mode pajak", async () => {
    await prisma.kol.update({ where: { id: kolIg }, data: { phone: "081234567890", waNormal: "6281234567890" } });
    const id = await kolab(kolIg, "DEAL");
    await prisma.kolBrief.update({ where: { id }, data: { modePajak: "GROSS_UP" } });
    const d = await detailKolaborasi(id, opsi);
    expect(d?.modePajak).toBe("GROSS_UP");
    // HP sudah ada: yang kurang hanya alamat dan ukuran — bukan "alamat & no. HP".
    expect(d?.kurangKirim).toEqual(["ALAMAT", "UKURAN"]);

    await prisma.kol.update({ where: { id: kolIg }, data: { address: "Jl. Mawar 1", sizeProfile: JSON.stringify({ atasan: "M" }) } });
    expect((await detailKolaborasi(id, opsi))?.kurangKirim).toEqual([]);
  });
});
