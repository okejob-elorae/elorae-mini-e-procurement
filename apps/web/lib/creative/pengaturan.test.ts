import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { AMBANG_BAWAAN } from "./ambang";
import {
  bacaAmbangKreatif,
  bacaIdentitasKreatif,
  bacaPengaturanKreatif,
  bacaTemplateWaKreatif,
  KUNCI_AMBANG,
  KUNCI_IDENTITAS,
  KUNCI_TEMPLATE_WA,
  simpanAmbangKreatif,
  simpanIdentitasKreatif,
  simpanTemplateWaKreatif,
} from "./pengaturan";
import { IDENTITAS_BAWAAN, TEMPLATE_BAWAAN } from "./wa";

/**
 * Pengaturan Kreatif terhadap basis data sungguhan. Barisnya konfigurasi
 * bersama di basis data dev, jadi nilai aslinya dipotret dulu dan DIPULIHKAN
 * sesudah setiap tes — termasuk menghapus baris yang sebelumnya tidak ada.
 */

const KUNCI = [KUNCI_AMBANG, KUNCI_TEMPLATE_WA, KUNCI_IDENTITAS];
let asli: Map<string, string | null> = new Map();
let jejakIds: string[] = [];
let userId = "";

beforeEach(async () => {
  jejakIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: KUNCI } }, select: { key: true, value: true } });
  asli = new Map(KUNCI.map((k) => [k, rows.find((r) => r.key === k)?.value ?? null]));
  await prisma.systemSetting.deleteMany({ where: { key: { in: seededIds(KUNCI) } } });
});

afterEach(async () => {
  // Konfigurasi bersama dipulihkan lebih dulu, apa pun yang terjadi sesudahnya.
  for (const [key, value] of asli) {
    if (value === null) await prisma.systemSetting.deleteMany({ where: { key: seededId(key) } });
    else await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(jejakIds) } } });
});

async function catatJejakTerakhir(kunci: string) {
  const j = await prisma.auditLog.findFirstOrThrow({
    where: { action: "CREATIVE_SETTINGS_UPDATED", entityId: kunci, userId },
    orderBy: { createdAt: "desc" },
  });
  jejakIds.push(j.id);
  return j;
}

describe("pembaca pengaturan Kreatif", () => {
  it("tanpa baris sama sekali = bawaan di kode", async () => {
    expect(await bacaAmbangKreatif()).toEqual(AMBANG_BAWAAN);
    expect(await bacaTemplateWaKreatif()).toEqual(TEMPLATE_BAWAAN);
    expect(await bacaIdentitasKreatif()).toEqual(IDENTITAS_BAWAAN);
    expect(await bacaPengaturanKreatif()).toEqual({ ambang: AMBANG_BAWAAN, templateWa: TEMPLATE_BAWAAN, identitas: IDENTITAS_BAWAAN });
  });

  it("baris rusak tetap terbaca sebagai bawaan", async () => {
    await prisma.systemSetting.create({ data: { key: KUNCI_AMBANG, value: "{rusak" } });
    expect(await bacaAmbangKreatif()).toEqual(AMBANG_BAWAAN);
  });
});

describe("penulis pengaturan Kreatif", () => {
  it("menyimpan ambang dan menulis jejak sebelum/sesudah", async () => {
    const r = await simpanAmbangKreatif({ followUpHari: 5 }, userId);
    expect(r).toEqual({ ok: true, ambang: { ...AMBANG_BAWAAN, followUpHari: 5 } });
    expect((await bacaAmbangKreatif()).followUpHari).toBe(5);
    const j = await catatJejakTerakhir(KUNCI_AMBANG);
    expect(j.changes).toMatchObject({ before: null });
  });

  it("menolak ambang yang salah tanpa menulis apa pun", async () => {
    const r = await simpanAmbangKreatif({ followUpHari: -2 }, userId);
    expect(r).toMatchObject({ ok: false, kode: "TIDAK_VALID" });
    expect(await prisma.systemSetting.count({ where: { key: KUNCI_AMBANG } })).toBe(0);
  });

  it("menyimpan template dan identitas yang sudah dirapikan", async () => {
    const t = await simpanTemplateWaKreatif([{ kunci: "a", nama: " Sapa ", isi: "Halo {nama}" }], userId);
    expect(t).toEqual({ ok: true, templates: [{ kunci: "a", nama: "Sapa", isi: "Halo {nama}" }] });
    expect(await bacaTemplateWaKreatif()).toEqual([{ kunci: "a", nama: "Sapa", isi: "Halo {nama}" }]);
    await catatJejakTerakhir(KUNCI_TEMPLATE_WA);

    const i = await simpanIdentitasKreatif({ pengirim: " Dina ", brand: "", produk: "Koleksi Lebaran" }, userId);
    expect(i).toEqual({ ok: true, identitas: { pengirim: "Dina", brand: "Eloraé", produk: "Koleksi Lebaran" } });
    expect(await bacaIdentitasKreatif()).toEqual({ pengirim: "Dina", brand: "Eloraé", produk: "Koleksi Lebaran" });
    await catatJejakTerakhir(KUNCI_IDENTITAS);
  });

  it("menolak template tanpa nama dan identitas yang terlalu panjang", async () => {
    expect(await simpanTemplateWaKreatif([{ kunci: "a", nama: "", isi: "x" }], userId)).toEqual({ ok: false, kode: "NAMA_WAJIB", indeks: 0 });
    expect(await simpanIdentitasKreatif({ pengirim: "x".repeat(81) }, userId)).toEqual({ ok: false, kode: "TERLALU_PANJANG" });
  });
});
