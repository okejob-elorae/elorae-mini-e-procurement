import { prisma, type Prisma, type PrismaClient } from "@elorae/db";

/*
 * Akun kas/bank yang boleh dipilih sebagai sumber pembayaran operasional
 * (biaya perjalanan) — KHUSUS SERVER. Akun daun yang aktif, bertipe ASET, dan
 * dipetakan ke peran BANK/CASH atau diklasifikasikan KAS di Klasifikasi Arus
 * Kas. Akun lain ditolak: membayar dari akun beban atau akun induk akan
 * memposting jurnal yang ditolak buku besar, atau yang salah.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export type AkunKas = { id: string; code: string; name: string };

async function idAkunKas(client: Klien): Promise<Set<string>> {
  const [peta, kas] = await Promise.all([
    client.journalAccountMapping.findMany({ where: { role: { in: ["BANK", "CASH"] } }, select: { chartAccountId: true } }),
    client.chartAccount.findMany({ where: { cashFlowSection: "KAS" }, select: { id: true } }),
  ]);
  return new Set([...peta.map((p) => p.chartAccountId), ...kas.map((a) => a.id)]);
}

export async function daftarAkunKasBank(client: Klien = prisma): Promise<AkunKas[]> {
  const ids = await idAkunKas(client);
  if (ids.size === 0) return [];
  return client.chartAccount.findMany({
    where: { id: { in: [...ids] }, type: "ASET", isActive: true, children: { none: {} } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
}

export async function akunKasSah(client: Klien, id: string): Promise<boolean> {
  if (!id) return false;
  const ids = await idAkunKas(client);
  if (!ids.has(id)) return false;
  const a = await client.chartAccount.findFirst({
    where: { id, type: "ASET", isActive: true, children: { none: {} } },
    select: { id: true },
  });
  return a !== null;
}
