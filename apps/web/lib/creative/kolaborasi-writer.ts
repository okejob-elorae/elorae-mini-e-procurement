import { Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { denganNomorUnik } from "@/lib/receivables/nomor";
import {
  feeDiakui,
  indeksTahap,
  isJalurKeluar,
  type JenisKerjaSama,
  type StatusBayar,
  type Tahap,
} from "./tahap";
import {
  nomorBrief,
  pindahTahapKolaborasi,
  tanggalTahap,
  type AlasanGagalKreatif,
  type BarisBarangKirim,
  type BarisDeliverable,
  type HasilKreatif,
} from "./writer";

/*
 * Penulis kolaborasi di luar "buat" dan "pindah tahap" satuan (yang tinggal di
 * `writer.ts`): ubah isi, pindah tahap massal, dan masukkan banyak KOL ke satu
 * campaign. Stok TIDAK pernah bergerak di sini — rencana sampel hanya rencana;
 * stok keluar lewat pengiriman sampel.
 */

const D = (n: number) => new Prisma.Decimal(n);
const angka = (v: unknown): number => Number(v ?? 0);

/** Batas baris untuk aksi massal — layar tidak pernah memilih lebih dari satu halaman papan. */
export const BATAS_MASSAL = 500;

export type IsiUbahKolaborasi = {
  campaignId?: string | null;
  jenis?: JenisKerjaSama;
  fee?: number;
  commissionPct?: number | null;
  boostCost?: number;
  picId?: string | null;
  plannedLiveAt?: Date | null;
  briefText?: string | null;
  doList?: string | null;
  dontList?: string | null;
  /** `undefined` = tidak disentuh; `[]` = dikosongkan. */
  deliverables?: BarisDeliverable[];
  /** Rencana sampel. `undefined` = tidak disentuh; `[]` = dikosongkan. */
  barang?: BarisBarangKirim[];
};

const teks = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

/**
 * Status bayar mengikuti fee selama belum ada uang yang berpindah: fee nol
 * berarti tidak perlu dibayar, fee lebih dari nol yang tadinya "tidak perlu"
 * menjadi "belum". SEBAGIAN dan LUNAS tidak pernah disentuh — itu fakta.
 */
export function statusBayarSesudahUbahFee(sekarang: StatusBayar, feeBaru: number): StatusBayar {
  if (sekarang === "SEBAGIAN" || sekarang === "LUNAS") return sekarang;
  return feeBaru > 0 ? "BELUM" : "TIDAK_PERLU";
}

/**
 * Ubah isi satu kolaborasi. Semua kolom boleh diubah, kecuali fee dan jenis
 * kerja sama SESUDAH kontennya tayang: saat itu fee sudah diakui sebagai biaya,
 * jadi mengubahnya wajib beralasan (tercatat di jejak).
 *
 * Kolom yang tidak dikirim (`undefined`) tidak disentuh. Tahap TIDAK diubah di
 * sini — pakai `pindahTahapKolaborasi`.
 */
export async function ubahKolaborasi(input: {
  id: string;
  isi: IsiUbahKolaborasi;
  alasan?: string | null;
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string }>> {
  const { isi } = input;
  if (isi.fee !== undefined && !(Number.isFinite(isi.fee) && isi.fee >= 0)) {
    return { ok: false, alasan: "TIDAK_VALID", detail: "fee" };
  }
  if (isi.boostCost !== undefined && !(Number.isFinite(isi.boostCost) && isi.boostCost >= 0)) {
    return { ok: false, alasan: "TIDAK_VALID", detail: "boost" };
  }
  if (isi.commissionPct != null && !(Number.isFinite(isi.commissionPct) && isi.commissionPct >= 0 && isi.commissionPct <= 100)) {
    return { ok: false, alasan: "TIDAK_VALID", detail: "komisi" };
  }
  const barang = isi.barang?.filter((b) => b.itemId);
  if (barang?.some((b) => !Number.isInteger(b.qty) || b.qty <= 0)) return { ok: false, alasan: "QTY_TIDAK_VALID" };
  const deliverables = isi.deliverables?.filter((d) => d.qty > 0);
  if (deliverables?.some((d) => !Number.isInteger(d.qty))) return { ok: false, alasan: "QTY_TIDAK_VALID" };

  return runSerializable(async (tx) => {
    const lama = await tx.kolBrief.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        docNo: true,
        tahap: true,
        campaignId: true,
        jenis: true,
        fee: true,
        commissionPct: true,
        boostCost: true,
        picId: true,
        plannedLiveAt: true,
        briefText: true,
        doList: true,
        dontList: true,
        payStatus: true,
        kol: { select: { name: true } },
        _count: { select: { deliverables: true, items: true } },
      },
    });
    if (!lama) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as AlasanGagalKreatif };

    const feeLama = angka(lama.fee);
    const gantiFee = isi.fee !== undefined && Math.round(isi.fee * 100) !== Math.round(feeLama * 100);
    const gantiJenis = isi.jenis !== undefined && isi.jenis !== lama.jenis;
    if ((gantiFee || gantiJenis) && feeDiakui(lama.tahap as Tahap) && !input.alasan?.trim()) {
      return { ok: false as const, alasan: "ALASAN_WAJIB" as AlasanGagalKreatif, detail: "fee" };
    }

    if (isi.campaignId !== undefined && isi.campaignId && isi.campaignId !== lama.campaignId) {
      const c = await tx.kolCampaign.findUnique({ where: { id: isi.campaignId }, select: { archivedAt: true } });
      if (!c) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as AlasanGagalKreatif, detail: "campaign" };
      if (c.archivedAt) return { ok: false as const, alasan: "CAMPAIGN_DIARSIPKAN" as AlasanGagalKreatif };
    }
    if (isi.picId) {
      const u = await tx.user.findUnique({ where: { id: isi.picId }, select: { id: true } });
      if (!u) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as AlasanGagalKreatif, detail: "pic" };
    }

    const namaBarang = new Map<string, string>();
    if (barang?.length) {
      const items = await tx.item.findMany({
        where: { id: { in: barang.map((b) => b.itemId) } },
        select: { id: true, nameId: true },
      });
      if (items.length !== new Set(barang.map((b) => b.itemId)).size) {
        return { ok: false as const, alasan: "BARANG_TIDAK_DITEMUKAN" as AlasanGagalKreatif };
      }
      for (const i of items) namaBarang.set(i.id, i.nameId);
    }

    const feeBaru = isi.fee ?? feeLama;
    const data = {
      ...(isi.campaignId !== undefined ? { campaignId: isi.campaignId || null } : {}),
      ...(isi.jenis !== undefined ? { jenis: isi.jenis } : {}),
      ...(isi.fee !== undefined ? { fee: D(feeBaru) } : {}),
      ...(isi.fee !== undefined
        ? { payStatus: statusBayarSesudahUbahFee(lama.payStatus as StatusBayar, feeBaru) }
        : {}),
      ...(isi.commissionPct !== undefined ? { commissionPct: isi.commissionPct == null ? null : D(isi.commissionPct) } : {}),
      ...(isi.boostCost !== undefined ? { boostCost: D(isi.boostCost) } : {}),
      ...(isi.picId !== undefined ? { picId: isi.picId || null } : {}),
      ...(isi.plannedLiveAt !== undefined ? { plannedLiveAt: isi.plannedLiveAt } : {}),
      ...(isi.briefText !== undefined ? { briefText: teks(isi.briefText) } : {}),
      ...(isi.doList !== undefined ? { doList: teks(isi.doList) } : {}),
      ...(isi.dontList !== undefined ? { dontList: teks(isi.dontList) } : {}),
    };
    await tx.kolBrief.update({ where: { id: lama.id }, data });

    if (deliverables !== undefined) {
      await tx.kolBriefDeliverable.deleteMany({ where: { briefId: lama.id } });
      if (deliverables.length) {
        await tx.kolBriefDeliverable.createMany({
          data: deliverables.map((d) => ({
            briefId: lama.id,
            platform: d.platform,
            format: d.format,
            qty: d.qty,
            dueDate: d.dueDate ?? null,
          })),
        });
      }
    }
    if (barang !== undefined) {
      await tx.kolBriefItem.deleteMany({ where: { briefId: lama.id } });
      if (barang.length) {
        await tx.kolBriefItem.createMany({
          data: barang.map((b) => ({
            briefId: lama.id,
            itemId: b.itemId,
            itemName: namaBarang.get(b.itemId) ?? "",
            variantSku: b.variantSku?.trim() || null,
            qty: b.qty,
          })),
        });
      }
    }

    // Jejak hanya memuat kolom yang benar-benar berubah: jejak yang mengulang
    // seluruh isi tidak bisa dibaca siapa pun.
    const sebelum: Record<string, unknown> = {};
    const sesudah: Record<string, unknown> = {};
    const banding = (k: string, a: unknown, b: unknown) => {
      if (b === undefined) return;
      const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
      if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) {
        sebelum[k] = norm(a);
        sesudah[k] = norm(b);
      }
    };
    banding("campaignId", lama.campaignId, isi.campaignId === undefined ? undefined : isi.campaignId || null);
    banding("jenis", lama.jenis, isi.jenis);
    banding("fee", feeLama, isi.fee);
    banding("payStatus", lama.payStatus, "payStatus" in data ? data.payStatus : undefined);
    banding(
      "commissionPct",
      lama.commissionPct == null ? null : angka(lama.commissionPct),
      isi.commissionPct === undefined ? undefined : isi.commissionPct,
    );
    banding("boostCost", angka(lama.boostCost), isi.boostCost);
    banding("picId", lama.picId, isi.picId === undefined ? undefined : isi.picId || null);
    banding("plannedLiveAt", lama.plannedLiveAt, isi.plannedLiveAt);
    banding("briefText", lama.briefText, teks(isi.briefText));
    banding("doList", lama.doList, teks(isi.doList));
    banding("dontList", lama.dontList, teks(isi.dontList));
    if (deliverables !== undefined) {
      sebelum.jumlahDeliverable = lama._count.deliverables;
      sesudah.jumlahDeliverable = deliverables.length;
    }
    if (barang !== undefined) {
      sebelum.jumlahBarang = lama._count.items;
      sesudah.jumlahBarang = barang.length;
    }

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KOLABORASI_DIUBAH,
      entityType: "KolBrief",
      entityId: lama.id,
      changes: { before: sebelum, after: sesudah },
      metadata: { docNo: lama.docNo, kol: lama.kol.name },
      reason: input.alasan,
    });

    return { ok: true as const, id: lama.id };
  });
}

export type GagalMassal = { id: string; alasan: AlasanGagalKreatif };

/**
 * Pindahkan banyak kolaborasi ke satu tahap. Setiap kolaborasi dipindah dengan
 * aturan yang sama persis dengan pindah satuan (`pindahTahapKolaborasi`), dalam
 * transaksinya sendiri: satu kolaborasi yang tidak bisa dipindah (mis. sudah
 * keluar jalur) tidak menggagalkan yang lain, dan alasannya dikembalikan.
 */
export async function pindahTahapBanyak(input: {
  ids: string[];
  ke: Tahap;
  alasan?: string | null;
  olehUserId: string;
}): Promise<{ ok: true; dipindah: string[]; gagal: GagalMassal[] } | { ok: false; alasan: AlasanGagalKreatif }> {
  const ids = [...new Set(input.ids.filter(Boolean))];
  if (ids.length === 0 || ids.length > BATAS_MASSAL) return { ok: false, alasan: "TIDAK_VALID" };
  const dipindah: string[] = [];
  const gagal: GagalMassal[] = [];
  for (const id of ids) {
    const r = await pindahTahapKolaborasi({ kolaborasiId: id, ke: input.ke, alasan: input.alasan, olehUserId: input.olehUserId });
    if (r.ok) dipindah.push(id);
    else gagal.push({ id, alasan: r.alasan });
  }
  return { ok: true, dipindah, gagal };
}

export type HasilMasukkan = {
  /** Kolaborasi baru yang dibuat. */
  dibuat: number;
  /** KOL yang sudah punya kolaborasi di campaign ini (tahap apa pun) — dilewati. */
  sudahAda: number;
  /** KOL yang diblokir — dilewati. */
  diblokir: number;
  idDibuat: string[];
};

/**
 * Masukkan banyak KOL ke satu campaign sekaligus, dalam SATU transaksi
 * serializable. KOL yang sudah punya kolaborasi di campaign itu (tahap apa
 * pun, termasuk yang sudah keluar jalur — buka lagi yang lama, jangan
 * menggandakan) dan KOL yang diblokir dilewati dan dihitung.
 *
 * Kolaborasi baru lahir di `tahapAwal` (bukan jalur keluar), barter tanpa fee,
 * dan mewarisi brief campaign.
 */
export async function masukkanKeCampaign(input: {
  kolIds: string[];
  campaignId: string;
  tahapAwal?: Tahap;
  olehUserId: string;
}): Promise<({ ok: true } & HasilMasukkan) | { ok: false; alasan: AlasanGagalKreatif; detail?: string }> {
  const kolIds = [...new Set(input.kolIds.filter(Boolean))];
  if (kolIds.length === 0 || kolIds.length > BATAS_MASSAL) return { ok: false, alasan: "TIDAK_VALID" };
  const tahap: Tahap = input.tahapAwal ?? "PROSPEK";
  if (isJalurKeluar(tahap) || indeksTahap(tahap) < 0) return { ok: false, alasan: "STATUS_TIDAK_VALID", detail: tahap };

  return denganNomorUnik(() =>
    runSerializable(async (tx) => {
      const c = await tx.kolCampaign.findUnique({
        where: { id: input.campaignId },
        select: { id: true, name: true, brief: true, archivedAt: true },
      });
      if (!c) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as AlasanGagalKreatif, detail: "campaign" };
      if (c.archivedAt) return { ok: false as const, alasan: "CAMPAIGN_DIARSIPKAN" as AlasanGagalKreatif };

      const [kols, ada] = await Promise.all([
        tx.kol.findMany({ where: { id: { in: kolIds } }, select: { id: true, name: true, blockedAt: true } }),
        tx.kolBrief.findMany({
          where: { campaignId: c.id, kolId: { in: kolIds } },
          select: { kolId: true },
        }),
      ]);
      const sudah = new Set(ada.map((a) => a.kolId));
      const urutan = new Map(kolIds.map((id, i) => [id, i]));
      const target = kols
        .filter((k) => !sudah.has(k.id) && !k.blockedAt)
        .sort((a, b) => (urutan.get(a.id) ?? 0) - (urutan.get(b.id) ?? 0));

      const sekarang = new Date();
      const tahun = formatDateOnlyJakarta(sekarang).slice(0, 4);
      const idDibuat: string[] = [];
      for (const k of target) {
        const dibuat = await tx.kolBrief.create({
          data: {
            docNo: await nomorBrief(tx, tahun),
            kolId: k.id,
            campaignId: c.id,
            tahap,
            tahapAt: sekarang,
            ...tanggalTahap(tahap, sekarang),
            lastContactAt: indeksTahap(tahap) >= indeksTahap("DIHUBUNGI") ? sekarang : null,
            jenis: "BARTER",
            fee: D(0),
            payStatus: "TIDAK_PERLU",
            briefText: c.brief?.trim() || null,
            createdById: input.olehUserId,
          },
          select: { id: true, docNo: true },
        });
        idDibuat.push(dibuat.id);
        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.BRIEF_DIBUAT,
          entityType: "KolBrief",
          entityId: dibuat.id,
          changes: { after: { docNo: dibuat.docNo, tahap, fee: 0 } },
          metadata: { kol: k.name, campaignId: c.id, campaign: c.name, sumber: "MASUKKAN_KE_CAMPAIGN" },
        });
      }

      return {
        ok: true as const,
        dibuat: idDibuat.length,
        sudahAda: kols.filter((k) => sudah.has(k.id)).length,
        diblokir: kols.filter((k) => !sudah.has(k.id) && k.blockedAt).length,
        idDibuat,
      };
    }),
  );
}

export type HasilPindahCampaign = {
  /** Kolaborasi yang campaign-nya diganti. */
  dipindah: number;
  /** Sudah di campaign itu — tidak ada yang berubah. */
  sudahAda: number;
  /** KOL-nya sudah punya kolaborasi lain di campaign itu — dilewati supaya tidak kembar. */
  kembar: number;
};

/**
 * Masukkan kolaborasi yang DIPILIH ke satu campaign (aksi massal di daftar
 * Kolaborasi): campaign-nya diganti di tempat, tidak membuat kolaborasi baru.
 * Berbeda dari `masukkanKeCampaign` (dari daftar KOL), yang membuat kolaborasi
 * baru per KOL.
 *
 * Satu transaksi. Dilewati: yang sudah di campaign itu, dan yang KOL-nya sudah
 * punya kolaborasi lain di sana (dua kolaborasi untuk satu KOL di satu campaign
 * menggandakan sampel dan fee). Brief kosong mewarisi brief campaign.
 */
export async function pindahkanKeCampaign(input: {
  ids: string[];
  campaignId: string;
  olehUserId: string;
}): Promise<({ ok: true } & HasilPindahCampaign) | { ok: false; alasan: AlasanGagalKreatif; detail?: string }> {
  const ids = [...new Set(input.ids.filter(Boolean))];
  if (ids.length === 0 || ids.length > BATAS_MASSAL) return { ok: false, alasan: "TIDAK_VALID" };

  return runSerializable(async (tx) => {
    const c = await tx.kolCampaign.findUnique({
      where: { id: input.campaignId },
      select: { id: true, name: true, brief: true, archivedAt: true },
    });
    if (!c) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as AlasanGagalKreatif, detail: "campaign" };
    if (c.archivedAt) return { ok: false as const, alasan: "CAMPAIGN_DIARSIPKAN" as AlasanGagalKreatif };

    const pilih = await tx.kolBrief.findMany({
      where: { id: { in: ids } },
      select: { id: true, docNo: true, kolId: true, campaignId: true, briefText: true, kol: { select: { name: true } } },
    });
    const sudahDiSana = await tx.kolBrief.findMany({
      where: { campaignId: c.id, kolId: { in: pilih.map((p) => p.kolId) } },
      select: { kolId: true },
    });
    const kolDiSana = new Set(sudahDiSana.map((s) => s.kolId));

    let dipindah = 0;
    let sudahAda = 0;
    let kembar = 0;
    for (const p of pilih) {
      if (p.campaignId === c.id) {
        sudahAda += 1;
        continue;
      }
      if (kolDiSana.has(p.kolId)) {
        kembar += 1;
        continue;
      }
      kolDiSana.add(p.kolId);
      const warisBrief = !p.briefText?.trim() && c.brief?.trim() ? c.brief.trim() : undefined;
      await tx.kolBrief.update({
        where: { id: p.id },
        data: { campaignId: c.id, ...(warisBrief ? { briefText: warisBrief } : {}) },
      });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KOLABORASI_DIUBAH,
        entityType: "KolBrief",
        entityId: p.id,
        changes: {
          before: { campaignId: p.campaignId, ...(warisBrief ? { briefText: null } : {}) },
          after: { campaignId: c.id, ...(warisBrief ? { briefText: warisBrief } : {}) },
        },
        metadata: { docNo: p.docNo, kol: p.kol.name, campaign: c.name, sumber: "PINDAH_KE_CAMPAIGN" },
      });
      dipindah += 1;
    }
    return { ok: true as const, dipindah, sudahAda, kembar };
  });
}
