import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { bacaIdentitasKreatif, bacaTemplateWaKreatif } from "./pengaturan";
import { LABEL_PLATFORM } from "./aturan";
import { isiTemplate, normalisasiWa, susunVariabel, TEMPLATE_BAWAAN, variabelDalam } from "./wa";

/*
 * WhatsApp ke KOL — dipakai tombol WA di semua layar Kreatif (2026-10-07).
 *
 * Elorae tidak mengirim apa pun: `siapkanPesanWa` menyusun teks template yang
 * sudah terisi, tombolnya membuka wa.me, lalu `catatKirimWa` mencatat "Kirim
 * WA: <template>" sebagai kontak terakhir (jam follow-up mulai ulang) dan
 * memajukan kolaborasi yang masih PROSPEK ke DIHUBUNGI.
 */

export type PesanWaSiap = { kunci: string; nama: string; isi: string };

export type HasilSiapkanWa =
  | { ok: true; nomor: string | null; namaKol: string; pesan: PesanWaSiap[] }
  | { ok: false; kode: "TIDAK_DITEMUKAN" };

export async function siapkanPesanWa(input: { kolId: string; kolaborasiId?: string | null }): Promise<HasilSiapkanWa> {
  const kol = await prisma.kol.findUnique({
    where: { id: input.kolId },
    select: {
      name: true,
      phone: true,
      accounts: { select: { platform: true, handle: true, followers: true }, orderBy: { followers: "desc" }, take: 1 },
    },
  });
  if (!kol) return { ok: false, kode: "TIDAK_DITEMUKAN" };

  const kolab = input.kolaborasiId
    ? await prisma.kolBrief.findFirst({
        where: { id: input.kolaborasiId, kolId: input.kolId },
        select: {
          fee: true,
          campaign: { select: { name: true, product: true } },
          shipments: {
            select: { courier: true, trackingNo: true, lines: { select: { itemName: true }, take: 1 } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          items: { select: { itemName: true }, take: 1 },
        },
      })
    : null;
  if (input.kolaborasiId && !kolab) return { ok: false, kode: "TIDAK_DITEMUKAN" };

  const [identitas, template] = await Promise.all([bacaIdentitasKreatif(), bacaTemplateWaKreatif()]);
  const akun = kol.accounts[0];
  const kirim = kolab?.shipments[0];
  const vars = susunVariabel({
    namaKol: kol.name,
    username: akun?.handle ?? null,
    platform: akun ? LABEL_PLATFORM[akun.platform] : null,
    campaign: kolab?.campaign?.name ?? null,
    produk: kirim?.lines[0]?.itemName ?? kolab?.items[0]?.itemName ?? kolab?.campaign?.product ?? null,
    resi: kirim?.trackingNo ?? null,
    ekspedisi: kirim?.courier ?? null,
    fee: kolab ? Number(kolab.fee) : null,
    identitas,
  });
  return {
    ok: true,
    nomor: normalisasiWa(kol.phone),
    namaKol: kol.name,
    // Template ber-{link} (minta data) hanya bisa dikirim dari kartu link formulir, saat link-nya baru dibuat.
    pesan: template.filter((t) => !variabelDalam(t.isi).includes("link")).map((t) => ({ kunci: t.kunci, nama: t.nama, isi: isiTemplate(t.isi, vars) })),
  };
}

export const KUNCI_TEMPLATE_MINTA_DATA = "minta-data";

/**
 * Pesan WhatsApp berisi link formulir data KOL. Memakai template `minta-data` yang tersimpan di
 * Pengaturan; organisasi yang menyimpan templatenya sebelum template ini ada memakai bawaannya.
 */
export async function siapkanPesanMintaData(input: { kolId: string; link: string }): Promise<{ nomor: string | null; templateNama: string; pesan: string } | null> {
  const kol = await prisma.kol.findUnique({
    where: { id: input.kolId },
    select: { name: true, phone: true, accounts: { select: { handle: true, platform: true }, orderBy: [{ followers: "desc" }, { id: "asc" }], take: 1 } },
  });
  if (!kol) return null;
  const [identitas, template] = await Promise.all([bacaIdentitasKreatif(), bacaTemplateWaKreatif()]);
  const t = template.find((x) => x.kunci === KUNCI_TEMPLATE_MINTA_DATA) ?? TEMPLATE_BAWAAN.find((x) => x.kunci === KUNCI_TEMPLATE_MINTA_DATA)!;
  const vars = susunVariabel({ namaKol: kol.name, username: kol.accounts[0]?.handle ?? null, link: input.link, identitas });
  // Link wajib ada di pesan: template yang diubah tanpa {link} tetap membawa link-nya di akhir.
  const isi = isiTemplate(t.isi, vars);
  return { nomor: normalisasiWa(kol.phone), templateNama: t.nama, pesan: isi.includes(input.link) ? isi : `${isi}\n\n${input.link}` };
}

export type HasilCatatWa = { ok: true; tahapBaru: string | null } | { ok: false; kode: "TIDAK_DITEMUKAN" };

export async function catatKirimWa(input: {
  kolId: string;
  kolaborasiId?: string | null;
  templateNama: string | null;
  olehUserId: string;
}): Promise<HasilCatatWa> {
  const nama = (input.templateNama ?? "").trim().slice(0, 120) || "tanpa template";
  return runSerializable(async (tx): Promise<HasilCatatWa> => {
    const sekarang = new Date();
    const kol = await tx.kol.findUnique({ where: { id: input.kolId }, select: { id: true, name: true } });
    if (!kol) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    await tx.kol.update({ where: { id: kol.id }, data: { lastContactAt: sekarang } });

    let tahapBaru: string | null = null;
    if (input.kolaborasiId) {
      const c = await tx.kolBrief.findFirst({
        where: { id: input.kolaborasiId, kolId: kol.id },
        select: { id: true, docNo: true, tahap: true, outreachAt: true },
      });
      if (!c) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      const keDihubungi = c.tahap === "PROSPEK";
      await tx.kolBrief.update({
        where: { id: c.id },
        data: {
          lastContactAt: sekarang,
          ...(keDihubungi ? { tahap: "DIHUBUNGI", tahapAt: sekarang, outreachAt: c.outreachAt ?? sekarang } : {}),
        },
      });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KOLABORASI_KONTAK,
        entityType: "KolBrief",
        entityId: c.id,
        metadata: { template: nama, docNo: c.docNo, kol: kol.name },
      });
      if (keDihubungi) {
        tahapBaru = "DIHUBUNGI";
        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.KOLABORASI_MAJU_OTOMATIS,
          entityType: "KolBrief",
          entityId: c.id,
          changes: { before: { tahap: c.tahap }, after: { tahap: "DIHUBUNGI" } },
          metadata: { sebab: `Kirim WA: ${nama}`, docNo: c.docNo },
        });
      }
    } else {
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KOLABORASI_KONTAK,
        entityType: "Kol",
        entityId: kol.id,
        metadata: { template: nama, kol: kol.name },
      });
    }
    return { ok: true, tahapBaru };
  });
}
