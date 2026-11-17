import { z } from "zod";
import { prisma } from "@elorae/db";
import { bacaSaringSiklus, saringSiklus, type SaringSiklus } from "@/app/backoffice/konsinyasi/saring";
import { URUT_TAHAP } from "@/app/backoffice/konsinyasi/tahap";
import { daftarSiklus, pakaiPpnSiklus } from "@/lib/konsinyasi/queries";
import { catatNomorDokumen } from "@/lib/konsinyasi/writer";
import { bolehMembukaKonsi, bolehMencatatNomorKonsi } from "@/lib/receivables/izin";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { listInputShape, recordUrl, sliceToPage } from "../output";
import {
  defineTool,
  defineWriteTool,
  type ParityCase,
  type ViraTool,
  type ViraWriteTool,
} from "./types";

/** `SaringSiklus`: "berjalan" (not finished — the page's default), "semua", or one stage of URUT_TAHAP. */
export const CYCLE_STAGES = ["berjalan", "semua", ...URUT_TAHAP] as [SaringSiklus, ...SaringSiklus[]];

const listShape = {
  stage: z
    .enum(CYCLE_STAGES)
    .optional()
    .describe(
      "berjalan = not finished (default), semua = all, or one stage: laporan, cocok, bayar_spg, nota, pajak, bayar_toko, selesai.",
    ),
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Text to match against the konsi number, store, period, nota number or tax invoice number."),
  ...listInputShape,
};

/** Copy of konsinyasi err* messages for nomor dokumen. */
const PESAN_NOMOR: Record<string, string> = {
  NOMOR_WAJIB: "Isi nomornya.",
  TIDAK_DITEMUKAN: "Siklus tidak ditemukan.",
  BELUM_DIKUNCI: "Angkanya belum dikunci.",
  TANPA_PPN: "Tagihan siklus ini tanpa PPN — tidak ada faktur pajak untuk dicatat.",
  TANPA_AKSES: "Anda tidak punya akses untuk tindakan ini.",
  GAGAL: "Gagal menyimpan. Coba lagi.",
};

const BULAN = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

type CycleRow = {
  id: string;
  noKonsi: string;
  storeId: string;
  storeName: string;
  periode: string;
  noNota: string | null;
  noFakturPajak: string | null;
  lockedAt: Date | null;
  vatApplied: boolean | null;
  consignmentVat: boolean;
};

const cycleSelect = {
  id: true,
  noKonsi: true,
  storeId: true,
  periodYear: true,
  periodMonth: true,
  noNota: true,
  noFakturPajak: true,
  lockedAt: true,
  vatApplied: true,
  store: { select: { name: true, consignmentVat: true } },
} as const;

/** Exact id or unique `noKonsi` — no full `daftarSiklus` scan. */
async function resolveCycle(cycle: string): Promise<CycleRow> {
  let row =
    (await prisma.consignmentCycle.findUnique({ where: { id: cycle }, select: cycleSelect })) ??
    (await prisma.consignmentCycle.findUnique({ where: { noKonsi: cycle }, select: cycleSelect }));
  if (!row) throw new ViraNotFoundError("Siklus tidak ditemukan");
  return {
    id: row.id,
    noKonsi: row.noKonsi,
    storeId: row.storeId,
    storeName: row.store.name,
    periode: `${BULAN[row.periodMonth - 1]} ${row.periodYear}`,
    noNota: row.noNota,
    noFakturPajak: row.noFakturPajak,
    lockedAt: row.lockedAt,
    vatApplied: row.vatApplied,
    consignmentVat: row.store.consignmentVat,
  };
}

type NomorArgs = { cycleId: string; kind: "NOTA" | "PAJAK"; number: string };

/**
 * Mirrors `catatNomorDokumenAction` in `app/actions/konsinyasi.ts` (~L244–262)
 * and `catatNomorDokumen` in `lib/konsinyasi/writer.ts` (~L1175+).
 */
const recordConsignmentDocumentNumberTool = defineWriteTool({
  kind: "write",
  name: "record_consignment_document_number",
  title: "Record consignment document number",
  description:
    "Prepares recording the sales-admin nota number (NOTA) or the faktur pajak number (PAJAK) on a consignment cycle. The user must press the confirm button.",
  gate: { kind: "anyOf", codes: ["consignment:note_number", "consignment:tax_number"] },
  destructive: false,
  inputShape: {
    cycle: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("The cycle id or konsi number (noKonsi)."),
    kind: z.enum(["NOTA", "PAJAK"]).describe("NOTA = sales-admin nota number, PAJAK = tax invoice number."),
    number: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("The document number to record."),
  },
  argsSchema: z.object({
    cycleId: z.string().min(1),
    kind: z.enum(["NOTA", "PAJAK"]),
    number: z.string().trim().min(1).max(100),
  }),
  __sampleInput: { cycle: "c-1", kind: "NOTA", number: "001" },
  prepare: async (input, ctx) => {
    if (!bolehMencatatNomorKonsi(ctx.actor.permissions, input.kind)) {
      throw new ViraInputError(`Anda tidak punya izin mencatat nomor ${input.kind}.`);
    }
    const row = await resolveCycle(input.cycle);
    // Writer refuses unlocked cycles (`catatNomorDokumen` ~L1192).
    if (!row.lockedAt) {
      throw new ViraInputError(PESAN_NOMOR.BELUM_DIKUNCI);
    }
    // Same VAT gate as the writer (`vatApplied ?? store.consignmentVat`).
    if (
      input.kind === "PAJAK" &&
      !pakaiPpnSiklus({ vatApplied: row.vatApplied, store: { consignmentVat: row.consignmentVat } })
    ) {
      throw new ViraInputError(PESAN_NOMOR.TANPA_PPN);
    }
    const current = input.kind === "NOTA" ? row.noNota : row.noFakturPajak;
    const label = input.kind === "NOTA" ? "NOTA" : "faktur pajak";
    const url = recordUrl(ctx.baseUrl, `/backoffice/konsinyasi/${row.id}`);
    return {
      preview: {
        title: `Catat nomor ${label} ${row.noKonsi}`,
        summary: `${row.storeName} · ${row.periode}`,
        details: [
          { label: "Toko", value: row.storeName },
          { label: "Periode", value: row.periode },
          { label: "Nomor sekarang", value: current?.trim() || "—" },
          { label: "Nomor baru", value: input.number },
        ],
        confirmLabel: "Catat",
        cancelLabel: "Batal",
        destructive: false,
        target: { type: "consignment_cycle", id: row.id, url },
      },
      args: { cycleId: row.id, kind: input.kind, number: input.number },
    };
  },
  execute: async (args, ctx) => {
    const url = recordUrl(ctx.baseUrl, `/backoffice/konsinyasi/${args.cycleId}`);
    if (!bolehMencatatNomorKonsi(ctx.actor.permissions, args.kind)) {
      return { ok: false, code: "TANPA_AKSES", message: PESAN_NOMOR.TANPA_AKSES, url };
    }
    // Mirror action try/catch → GAGAL so confirm does not burn jti as INTERNAL.
    let hasil;
    try {
      hasil = await catatNomorDokumen({
        cycleId: args.cycleId,
        jenis: args.kind,
        nomor: args.number,
        olehUserId: ctx.actor.id,
      });
    } catch {
      return { ok: false, code: "GAGAL", message: PESAN_NOMOR.GAGAL, url };
    }
    if (!hasil.ok) {
      return {
        ok: false,
        code: hasil.alasan,
        message: PESAN_NOMOR[hasil.alasan] ?? hasil.alasan,
        url,
      };
    }
    return {
      ok: true,
      message: `Nomor ${args.kind} dicatat.`,
      url,
      entityType: "ConsignmentCycle",
      entityId: args.cycleId,
    };
  },
  // Action `segarkan()` — /backoffice/konsinyasi only for this path.
  revalidate: () => ["/backoffice/konsinyasi"],
});

export const tools: ViraTool[] = [
  defineTool({
    name: "list_consignment_cycles",
    title: "Consignment cycles (siklus konsinyasi)",
    description:
      "Lists consignment cycles (siklus konsinyasi) per store, with stage, nota and tax invoice numbers, and sold value. soldValue is the total of goods the store reported sold in the cycle; it is not the amount billed (no VAT, loss charges or other adjustments). Filter by stage or search.",
    gate: { kind: "izin", name: "bolehMembukaKonsi", check: (p) => bolehMembukaKonsi(p) },
    inputShape: listShape,
    handler: async (input, ctx) => {
      // As app/backoffice/konsinyasi/page.tsx: daftarSiklus → saringSiklus. Never rincianSiklus
      // (SPG salary, decision D6); only the fields below leave this function.
      const semua = await daftarSiklus();
      const rows = saringSiklus(semua, { saring: input.stage ?? bacaSaringSiklus(undefined), cari: input.search ?? "" });
      const items = rows.map((c) => ({
        id: c.id,
        store: { id: c.storeId, name: c.storeName },
        stage: c.tahap,
        notaNo: c.noNota,
        fakturPajakNo: c.noFakturPajak,
        // nilaiTerjual: sum of the sold lines, before VAT and adjustments, so not a billed amount.
        soldValue: c.nilaiTerjual,
        url: recordUrl(ctx.baseUrl, `/backoffice/konsinyasi/${c.id}`),
      }));
      return sliceToPage(items, input.offset, input.limit);
    },
  }),
];

export const writeTools: ViraWriteTool[] = [recordConsignmentDocumentNumberTool];

export const __sampleInput = {
  record_consignment_document_number: { cycle: "c-1", kind: "NOTA" as const, number: "001" },
};

export const parityCases: ParityCase[] = [
  { tool: "list_consignment_cycles", kind: "predicate", module: "@/lib/receivables/izin", exportName: "bolehMembukaKonsi" },
  {
    tool: "record_consignment_document_number",
    kind: "writeAction",
    actionModule: "@/app/actions/konsinyasi",
    actionExport: "catatNomorDokumenAction",
    writerModule: "@/lib/konsinyasi/writer",
    writerExport: "catatNomorDokumen",
    args: ["c-1", "NOTA", "001"],
  },
  // Second row: PAJAK uses consignment:tax_number. Write-gate parity ORs both rows so the
  // tool's anyOf(note_number, tax_number) matches the UI's per-jenis gate.
  {
    tool: "record_consignment_document_number",
    kind: "writeAction",
    actionModule: "@/app/actions/konsinyasi",
    actionExport: "catatNomorDokumenAction",
    writerModule: "@/lib/konsinyasi/writer",
    writerExport: "catatNomorDokumen",
    args: ["c-1", "PAJAK", "010"],
  },
];
