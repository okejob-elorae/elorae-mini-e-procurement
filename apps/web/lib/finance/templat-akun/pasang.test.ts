import { describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@elorae/db";
import { POSTING_ROLES } from "@/lib/constants/journal-roles";
import { ID_JEJAK_TEMPLAT, JEJAK_TEMPLAT_AKUN, bacaKeadaanBagan, pasangTemplatDalamTx } from "./pasang";
import { rencanaPasangTemplat } from "./rencana";
import type { AkunTemplat } from "./templat";

/*
 * Pemasang templat dijalankan di dalam transaksi yang SELALU dibatalkan di
 * akhir tes: basis data bersama (data UJIAKUN, pemetaan 22 peran lama) tidak
 * pernah berubah, dan 32 peran baru tidak pernah tertinggal terpetakan.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

class Batalkan extends Error {}

async function dalamTransaksiBatal(fn: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  await prisma
    .$transaction(
      async (tx) => {
        await fn(tx);
        throw new Batalkan("rollback");
      },
      { timeout: 60_000, maxWait: 20_000 },
    )
    .catch((e) => {
      if (!(e instanceof Batalkan)) throw e;
    });
}

async function petaPeran(client: Prisma.TransactionClient | typeof prisma): Promise<Map<string, string>> {
  const rows = await client.journalAccountMapping.findMany({ select: { role: true, chartAccountId: true } });
  return new Map(rows.map((r) => [r.role, r.chartAccountId]));
}

d("pasangTemplatDalamTx (basis data uji, transaksi dibatalkan)", () => {
  it("hanya mengisi peran kosong, tidak menimpa pemetaan lama, idempoten, dan berjejak", async () => {
    const sebelum = await petaPeran(prisma);
    const kodeSebelum = new Set((await prisma.chartAccount.findMany({ select: { code: true } })).map((a) => a.code));

    await dalamTransaksiBatal(async (tx) => {
      const token = Math.floor(Math.random() * 1e9).toString(36);
      const user = await tx.user.create({ data: { email: `templat-akun-${token}@test.local`, name: "Uji templat" } });

      const pertama = await pasangTemplatDalamTx(tx, { olehUserId: user.id });
      const sesudah = await petaPeran(tx);

      // Pemetaan lama tidak tersentuh.
      for (const [peran, akunId] of sebelum) expect(sesudah.get(peran), peran).toBe(akunId);
      // Setiap peran kini terpetakan, kecuali yang dilaporkan konflik.
      const terhalang = new Set(pertama.rencana.konflik.flatMap((k) => k.peran));
      for (const peran of POSTING_ROLES) {
        if (!terhalang.has(peran)) expect(sesudah.has(peran), peran).toBe(true);
      }
      expect(pertama.peranDipetakan).toBe(sesudah.size - sebelum.size);
      // Kode yang sudah ada tidak dibuat ulang (kode unik → create akan gagal), yang baru benar-benar baru.
      for (const a of pertama.rencana.akunBaru) expect(kodeSebelum.has(a.kode), a.kode).toBe(false);

      // Setiap pemetaan baru menunjuk akun aktif tanpa turunan, bertipe benar.
      for (const p of pertama.rencana.pemetaanBaru) {
        const akun = await tx.chartAccount.findUniqueOrThrow({ where: { id: sesudah.get(p.peran)! } });
        expect(akun.code).toBe(p.kode);
        expect(akun.isActive).toBe(true);
        expect(await tx.chartAccount.count({ where: { parentId: akun.id } })).toBe(0);
      }

      const jejak = await tx.auditLog.findMany({ where: { userId: user.id, action: JEJAK_TEMPLAT_AKUN } });
      if (pertama.akunDibuat + pertama.peranDipetakan > 0) {
        expect(jejak).toHaveLength(1);
        expect(jejak[0].entityId).toBe(ID_JEJAK_TEMPLAT);
      }

      // Kedua kalinya: tidak ada yang dibuat, tidak ada jejak baru.
      const kedua = await pasangTemplatDalamTx(tx, { olehUserId: user.id });
      expect(kedua.akunDibuat).toBe(0);
      expect(kedua.peranDipetakan).toBe(0);
      expect(await tx.auditLog.count({ where: { userId: user.id, action: JEJAK_TEMPLAT_AKUN } })).toBe(jejak.length);
    });

    // Sesudah dibatalkan: basis data bersama persis seperti semula.
    const akhir = await petaPeran(prisma);
    expect([...akhir.entries()].sort()).toEqual([...sebelum.entries()].sort());
    const kodeAkhir = (await prisma.chartAccount.findMany({ select: { code: true } })).map((a) => a.code);
    expect(kodeAkhir.filter((k) => !kodeSebelum.has(k))).toEqual([]);
  }, 90_000);

  it("akun daun yang sudah berbaris jurnal tidak diberi anak (dibaca dari basis data)", async () => {
    await dalamTransaksiBatal(async (tx) => {
      const token = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
      const user = await tx.user.create({ data: { email: `templat-akun-induk-${token}@test.local`, name: "Uji templat" } });
      const induk = await tx.chartAccount.create({ data: { code: `97${token}`, name: "Induk uji", type: "ASET", depth: 1 } });
      const lawan = await tx.chartAccount.create({ data: { code: `96${token}`, name: "Lawan uji", type: "EKUITAS", depth: 1 } });
      await tx.journal.create({
        data: {
          date: new Date("2002-01-15T00:00:00+07:00"),
          description: "uji induk dipakai",
          postedById: user.id,
          lines: {
            create: [
              { chartAccountId: induk.id, debit: 1000, credit: 0 },
              { chartAccountId: lawan.id, debit: 0, credit: 1000 },
            ],
          },
        },
      });
      const templat: AkunTemplat[] = [
        { kode: `97${token}`, nama: "Induk uji", induk: null, tipe: "ASET" },
        { kode: `97${token}01`, nama: "Anak uji", induk: `97${token}` },
      ];
      const keadaan = await bacaKeadaanBagan(tx, templat);
      expect(keadaan.akun.find((a) => a.id === induk.id)?.dipakai).toBe(true);
      const r = rencanaPasangTemplat(templat, keadaan);
      expect(r.akunBaru).toEqual([]);
      expect(r.konflik).toEqual([{ kode: `97${token}01`, nama: "Anak uji", sebab: "INDUK_DIPAKAI", peran: [] }]);
      const hasil = await pasangTemplatDalamTx(tx, { olehUserId: user.id, templat });
      expect(hasil.akunDibuat).toBe(0);
      expect(await tx.chartAccount.count({ where: { parentId: induk.id } })).toBe(0);
    });
  }, 60_000);
});
