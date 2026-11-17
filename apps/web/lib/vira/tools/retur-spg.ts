import { z } from "zod";
import {
  setujuiReturPembeli,
  tolakReturPembeli,
  type HasilPutusanReturPembeli,
} from "@/lib/spg/retur-pembeli";
import {
  daftarReturPembeliKantor,
  rincianReturPembeliKantor,
  type RincianReturPembeliKantor,
} from "@/lib/spg/retur-pembeli-queries";
import {
  STATUS_RETUR_PEMBELI,
  type TabReturPembeliKantor,
} from "@/lib/spg/retur-pembeli-status";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import { resolveStore } from "./_resolve-store";
import {
  defineTool,
  defineWriteTool,
  type ParityCase,
  type ViraExecuteResult,
  type ViraTool,
  type ViraToolContext,
  type ViraWriteTool,
} from "./types";

/** Copy of `spgReturPembeli.err` in `lib/i18n/messages/id.json`. */
const PESAN: Record<string, string> = {
  TIDAK_DITEMUKAN: "Laporan tidak ditemukan.",
  SUDAH_DIPUTUSKAN: "Laporan ini sudah diputuskan atau ditarik. Muat ulang halaman.",
  PELAPOR_SAMA: "Anda tidak bisa memutuskan laporan yang Anda buat sendiri.",
  BUKAN_MILIK: "Hanya pelapor, di tokonya sendiri, yang bisa menarik laporan ini.",
  ALASAN_WAJIB: "Tulis alasannya.",
  ALASAN_TERLALU_PANJANG: "Alasannya terlalu panjang (paling banyak 500 huruf).",
  MELEBIHI_SISA: "Jumlahnya melebihi barang yang masih bisa dikembalikan di nota ini. Tolak laporan ini.",
  TANPA_AKSES: "Anda tidak punya akses untuk ini.",
  UANG_SUDAH_DIKEMBALIKAN: "Uang laporan ini sudah dicatat dikembalikan.",
  ALASAN_UANG_KEMBALI_WAJIB: "Tulis dari mana Anda tahu uangnya sudah dikembalikan.",
  BESAR_BEBAN_TIDAK_VALID: "Besar beban harus lebih dari nol, paling banyak dua angka di belakang koma.",
  ALASAN_BESAR_BEBAN_WAJIB: "Besar beban berbeda dari nota — tulis alasannya.",
  GAGAL: "Gagal menyimpan. Coba lagi.",
};

const STATUS_FILTER = [...STATUS_RETUR_PEMBELI, "SEMUA", "KEPUTUSAN_BARANG"] as const;

const returnIdInput = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("The buyer-return report id.");

type WriteArgs = { returnId: string; spgSaleId: string; reason?: string };

function formatRp(n: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
}

function mapHasil(r: HasilPutusanReturPembeli, url: string): Extract<ViraExecuteResult, { ok: false }> | null {
  if (r.ok) return null;
  return { ok: false, code: r.alasan, message: PESAN[r.alasan] ?? r.alasan, url };
}

/** Uang + commission/konsi lock flags the detail page shows before a decision. */
function detailKeputusan(row: RincianReturPembeliKantor): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [
    { label: "Uang", value: row.uang.keadaan },
  ];
  if (row.peringatan.komisiDitutup) {
    details.push({
      label: "Peringatan komisi",
      value: `Komisi bulan nota ${row.peringatan.bulanKomisi} sudah dicek/dikunci.`,
    });
  }
  if (row.peringatan.siklusKonsiTerkunci) {
    details.push({
      label: "Peringatan konsi",
      value: `Siklus konsinyasi bulan laporan ${row.peringatan.bulanLaporan} sudah dikunci.`,
    });
  }
  return details;
}

async function resolveMenunggu(returnId: string, actorId: string): Promise<RincianReturPembeliKantor> {
  const row = await rincianReturPembeliKantor(returnId);
  if (!row) throw new ViraNotFoundError("Retur tidak ditemukan");
  if (row.status !== "MENUNGGU") {
    throw new ViraInputError(`Retur berstatus ${row.status}, tidak bisa diputuskan.`);
  }
  if (row.pelapor.id === actorId) {
    throw new ViraInputError(PESAN.PELAPOR_SAMA);
  }
  return row;
}

/** `segarkan` in `app/actions/retur-spg.ts` ~L146–155. */
function revalidatePaths(args: WriteArgs): string[] {
  const { spgSaleId, returnId } = args;
  return [
    "/backoffice/retur-spg",
    `/backoffice/retur-spg/${returnId}`,
    `/backoffice/spg-sales/${spgSaleId}`,
    "/backoffice/komisi-spg",
    "/pwa/spg/retur-pembeli",
    `/pwa/spg/${spgSaleId}/nota`,
    `/pwa/spg/${spgSaleId}/kembali`,
    "/pwa/spg/nota",
    "/pwa/spg/stok",
    "/pwa/spg/opname",
    "/pwa/spg/stocktake",
    "/pwa/spg/tutup",
    "/pwa/spg/gaji",
    "/pwa/beban",
    "/pwa",
  ];
}

/**
 * Mirrors `setujuiReturPembeliAction` in `app/actions/retur-spg.ts` (~L205–219)
 * and `setujuiReturPembeli` in `lib/spg/retur-pembeli.ts` (~L563+).
 */
const approveSpgBuyerReturnTool = defineWriteTool({
  kind: "write",
  name: "approve_spg_buyer_return",
  title: "Approve SPG buyer return",
  description:
    "Prepares approval of an SPG buyer return. The user must press the confirm button.",
  gate: { kind: "code", code: "spg_returns:approve" },
  destructive: false,
  inputShape: { returnId: returnIdInput },
  argsSchema: z.object({
    returnId: z.string().min(1),
    spgSaleId: z.string().min(1),
  }),
  __sampleInput: { returnId: "r-1" },
  prepare: async (input, ctx) => {
    const row = await resolveMenunggu(input.returnId, ctx.actor.id);
    const url = recordUrl(ctx.baseUrl, `/backoffice/retur-spg/${row.id}`);
    const nilai = row.baris.reduce((n, l) => n + l.nilaiBersih, 0);
    const barang = row.baris
      .slice(0, 8)
      .map((l) => `${l.variantSku} × ${l.qty} (${l.kondisi})`);
    if (row.baris.length > 8) barang.push(`…+${row.baris.length - 8} lagi`);
    return {
      preview: {
        title: `Setujui retur ${row.nota.docNo}`,
        summary: `${row.toko.nama} · ${row.baris.length} baris · ${formatRp(nilai)}`,
        details: [
          { label: "Toko", value: row.toko.nama },
          { label: "SPG", value: row.pelapor.nama },
          { label: "Barang", value: barang.join(", ") || "—" },
          { label: "Nilai", value: formatRp(nilai) },
          { label: "Alasan SPG", value: row.alasan },
          ...detailKeputusan(row),
        ],
        confirmLabel: "Setujui",
        cancelLabel: "Batal",
        destructive: false,
        target: { type: "spg_buyer_return", id: row.id, url },
      },
      args: { returnId: row.id, spgSaleId: row.nota.id },
    };
  },
  execute: async (args, ctx) => {
    const url = recordUrl(ctx.baseUrl, `/backoffice/retur-spg/${args.returnId}`);
    const r = await setujuiReturPembeli({
      returnId: args.returnId,
      olehUserId: ctx.actor.id,
    });
    const mapped = mapHasil(r, url);
    if (mapped) return mapped;
    const row = await rincianReturPembeliKantor(args.returnId);
    return {
      ok: true,
      message: `Retur ${row?.nota.docNo ?? args.returnId} disetujui.`,
      url,
      entityType: "SpgBuyerReturn",
      entityId: args.returnId,
    };
  },
  revalidate: (args) => revalidatePaths(args),
});

/**
 * Mirrors `tolakReturPembeliAction` in `app/actions/retur-spg.ts` (~L227–249)
 * and `tolakReturPembeli` in `lib/spg/retur-pembeli.ts` (~L656+). Money-return
 * correction fields stay in Elorae (not exposed here).
 */
const rejectSpgBuyerReturnTool = defineWriteTool({
  kind: "write",
  name: "reject_spg_buyer_return",
  title: "Reject SPG buyer return",
  description:
    "Prepares rejection of an SPG buyer return with a reason. The user must press the confirm button. Money-returned corrections stay in Elorae.",
  gate: { kind: "code", code: "spg_returns:approve" },
  destructive: true,
  inputShape: {
    returnId: returnIdInput,
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Why the return is rejected. The SPG sees this on their phone."),
  },
  argsSchema: z.object({
    returnId: z.string().min(1),
    spgSaleId: z.string().min(1),
    reason: z.string().trim().min(1).max(500),
  }),
  __sampleInput: { returnId: "r-1", reason: "x" },
  prepare: async (input, ctx) => {
    const row = await resolveMenunggu(input.returnId, ctx.actor.id);
    const url = recordUrl(ctx.baseUrl, `/backoffice/retur-spg/${row.id}`);
    const nilai = row.baris.reduce((n, l) => n + l.nilaiBersih, 0);
    const barang = row.baris
      .slice(0, 8)
      .map((l) => `${l.variantSku} × ${l.qty} (${l.kondisi})`);
    if (row.baris.length > 8) barang.push(`…+${row.baris.length - 8} lagi`);
    // TolakDialog: MENUNGGU_SUDAH / uang already recorded → rejecting creates SPG beban.
    const uangSudah =
      row.uang.keadaan === "MENUNGGU_SUDAH" || row.uang.pada != null;
    const bebanDetail = uangSudah
      ? [
          {
            label: "Beban SPG jika ditolak",
            value: formatRp(row.bebanJikaDitolak),
          },
        ]
      : [];
    return {
      preview: {
        title: `Tolak retur ${row.nota.docNo}`,
        summary: uangSudah
          ? `${row.toko.nama} · uang sudah dikembalikan · beban ${formatRp(row.bebanJikaDitolak)}`
          : `${row.toko.nama} · ${formatRp(nilai)}`,
        details: [
          { label: "Toko", value: row.toko.nama },
          { label: "SPG", value: row.pelapor.nama },
          { label: "Barang", value: barang.join(", ") || "—" },
          { label: "Nilai", value: formatRp(nilai) },
          { label: "Alasan SPG", value: row.alasan },
          { label: "Alasan tolak", value: input.reason },
          ...detailKeputusan(row),
          ...bebanDetail,
        ],
        confirmLabel: "Tolak",
        cancelLabel: "Batal",
        destructive: true,
        target: { type: "spg_buyer_return", id: row.id, url },
      },
      args: { returnId: row.id, spgSaleId: row.nota.id, reason: input.reason },
    };
  },
  execute: async (args, ctx) => {
    const url = recordUrl(ctx.baseUrl, `/backoffice/retur-spg/${args.returnId}`);
    // Same as the action when money fields are absent (`uangTernyataDikembalikan` false).
    const r = await tolakReturPembeli({
      returnId: args.returnId,
      olehUserId: ctx.actor.id,
      alasan: args.reason,
      uangTernyataDikembalikan: false,
      alasanUangKembali: null,
      besarBeban: null,
      alasanBesarBeban: null,
    });
    const mapped = mapHasil(r, url);
    if (mapped) return mapped;
    const row = await rincianReturPembeliKantor(args.returnId);
    const beban =
      row?.beban != null ? ` Beban SPG ${formatRp(row.beban.jumlah)}.` : "";
    return {
      ok: true,
      message: `Retur ${row?.nota.docNo ?? args.returnId} ditolak.${beban}`,
      url,
      entityType: "SpgBuyerReturn",
      entityId: args.returnId,
    };
  },
  revalidate: (args) => revalidatePaths(args),
});

export const tools: ViraTool[] = [
  defineTool({
    name: "list_spg_buyer_returns",
    title: "SPG buyer returns (retur pembeli)",
    description:
      "Lists buyer returns recorded by SPG at consignment stores, with their decision status. Filter by status or store.",
    gate: { kind: "code", code: "spg_sales:view" },
    inputShape: {
      status: z
        .enum(STATUS_FILTER)
        .optional()
        .describe("MENUNGGU / DISETUJUI / DITOLAK / DIBATALKAN / SEMUA / KEPUTUSAN_BARANG. Default MENUNGGU."),
      store: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe("Store id, code or name. Omit for all stores."),
      ...listInputShape,
    },
    handler: async (input, ctx) => {
      const { limit, offset } = input;
      if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
      const storeId = input.store ? (await resolveStore(input.store)).id : null;
      const { baris, total } = await daftarReturPembeliKantor({
        status: (input.status as TabReturPembeliKantor | undefined) ?? "MENUNGGU",
        storeId,
        cari: "",
        halaman: offset / limit + 1,
        ukuran: limit,
      });
      const items = baris.map((b) => ({
        id: b.id,
        docNo: b.docNo,
        store: { id: b.storeId, name: b.toko },
        spg: { name: b.pelapor },
        status: b.status,
        items: b.pcs,
        itemsSummary: b.ringkasBarang,
        reason: b.alasan,
        // List query has no money total (detail does); keep the field for the card shape.
        amount: null as number | null,
        refundMethod: b.uang,
        createdAt: b.dilaporkanPada,
        url: recordUrl(ctx.baseUrl, `/backoffice/retur-spg/${b.id}`),
      }));
      return toPage(items, total, offset, limit);
    },
  }),
];

export const writeTools: ViraWriteTool[] = [approveSpgBuyerReturnTool, rejectSpgBuyerReturnTool];

export const __sampleInput = {
  approve_spg_buyer_return: { returnId: "r-1" },
  reject_spg_buyer_return: { returnId: "r-1", reason: "x" },
};

export const parityCases: ParityCase[] = [
  {
    tool: "list_spg_buyer_returns",
    kind: "pageCode",
    pageFile: "apps/web/app/backoffice/retur-spg/page.tsx",
    codes: ["spg_sales:view"],
  },
  {
    tool: "approve_spg_buyer_return",
    kind: "writeAction",
    actionModule: "@/app/actions/retur-spg",
    actionExport: "setujuiReturPembeliAction",
    writerModule: "@/lib/spg/retur-pembeli",
    writerExport: "setujuiReturPembeli",
    args: [{ returnId: "r-1" }],
  },
  {
    tool: "reject_spg_buyer_return",
    kind: "writeAction",
    actionModule: "@/app/actions/retur-spg",
    actionExport: "tolakReturPembeliAction",
    writerModule: "@/lib/spg/retur-pembeli",
    writerExport: "tolakReturPembeli",
    args: [{ returnId: "r-1", alasan: "x" }],
  },
];
