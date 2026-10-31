import { prisma } from "@elorae/db";

/*
 * Melengkapi `data` baris lonceng dengan konteks yang tidak ditulis penulisnya
 * tetapi dibutuhkan tautannya (`lib/notifications/navigation.ts`, murni dan
 * berjalan di peramban, tidak bisa membaca basis data).
 *
 * Satu kasus sekarang: jurnal muat van yang gagal. Metadatanya hanya membawa
 * id muatan (`docId`), padahal muatan van tidak punya halaman sendiri — tombol
 * "Post journal"-nya ada di halaman van kanvasernya. Kanvaser dicari di sini
 * dalam satu kueri per halaman, hanya bila halaman itu memuat baris seperti itu.
 */

type BarisLonceng = { type: string; data: unknown };

/** `data` sebagai objek. Kolom JSON bisa tiba sebagai teks (MariaDB) — dibaca sama. */
function objek(v: unknown): Record<string, unknown> | null {
  let nilai = v;
  if (typeof nilai === "string") {
    try {
      nilai = JSON.parse(nilai);
    } catch {
      return null;
    }
  }
  return nilai !== null && typeof nilai === "object" && !Array.isArray(nilai)
    ? (nilai as Record<string, unknown>)
    : null;
}

function idMuatVan(b: BarisLonceng): string | null {
  if (b.type !== "JOURNAL_PENDING") return null;
  const d = objek(b.data);
  if (!d || d.kind !== "van_load" || typeof d.canvasserId === "string") return null;
  return typeof d.docId === "string" && d.docId !== "" ? d.docId : null;
}

/**
 * Tidak pernah melempar: kegagalan melengkapi hanya membuat tautan jatuh ke
 * daftar kanvasing, dan lonceng tetap tampil.
 */
export async function lengkapiDataLonceng<T extends BarisLonceng>(baris: T[]): Promise<T[]> {
  const ids = [...new Set(baris.map(idMuatVan).filter((x): x is string => x !== null))];
  if (ids.length === 0) return baris;
  try {
    const muatan = await prisma.vanLoad.findMany({
      where: { id: { in: ids } },
      select: { id: true, canvasserId: true },
    });
    const kanvaser = new Map(muatan.map((m) => [m.id, m.canvasserId]));
    return baris.map((b) => {
      const id = idMuatVan(b);
      const c = id ? kanvaser.get(id) : undefined;
      return c ? { ...b, data: { ...objek(b.data), canvasserId: c } } : b;
    });
  } catch (e) {
    console.error("[notifications] gagal melengkapi kanvaser muatan van", e);
    return baris;
  }
}
