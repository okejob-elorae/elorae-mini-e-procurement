import { z } from "zod";
import {
  bolehMelihatIzin,
  JENIS_IZIN,
  labelRentangIzin,
  NAMA_JENIS_IZIN,
  STATUS_IZIN,
  type JenisIzin,
  type StatusIzin,
} from "@/lib/salesman/izin";
import { daftarIzinKantor, izinById, type BarisIzinKantor } from "@/lib/salesman/izin-queries";
import {
  setujuiIzin,
  tolakIzin,
  type HasilKeputusanIzin,
} from "@/lib/salesman/izin-writer";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { listInputShape, recordUrl, sliceToPage } from "../output";
import {
  defineTool,
  defineWriteTool,
  type ParityCase,
  type ViraExecuteResult,
  type ViraTool,
  type ViraToolContext,
  type ViraWriteTool,
} from "./types";

/** Copy of `backoffice.izin.err` messages in `lib/i18n/messages/id.json`. */
const PESAN_TOLAK: Record<string, string> = {
  TANPA_AKSES: "Anda tidak punya izin untuk tindakan ini.",
  TIDAK_DITEMUKAN: "Ajuan tidak ditemukan.",
  MILIK_SENDIRI: "Anda tidak bisa memutuskan ajuan Anda sendiri.",
  SUDAH_DIPUTUSKAN: "Ajuan ini sudah diputuskan atau ditarik. Daftar disegarkan.",
  TRANSISI_TIDAK_SAH: "Ajuan dengan status ini tidak bisa diubah begitu.",
  CATATAN_WAJIB: "Catatan wajib diisi.",
  CATATAN_TERLALU_PANJANG: "Catatan terlalu panjang (paling banyak 500 huruf).",
  GAGAL: "Gagal menyimpan. Coba lagi.",
};

const leaveRequestIdInput = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("The leave request id.");

const listShape = {
  status: z
    .enum(STATUS_IZIN)
    .optional()
    .describe("Only requests in this status. Omit for all."),
  type: z
    .enum(JENIS_IZIN)
    .optional()
    .describe("IZIN = short leave, SAKIT = sick, CUTI = annual leave. Omit for all."),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM")
    .optional()
    .describe("Calendar month of the leave dates (YYYY-MM). Omit for all months."),
  ...listInputShape,
};

type ApproveArgs = { leaveRequestId: string; note?: string };
type RejectArgs = { leaveRequestId: string; note: string };

async function resolvePending(leaveRequestId: string): Promise<BarisIzinKantor> {
  const row = await izinById(leaveRequestId);
  if (!row) throw new ViraNotFoundError("Ajuan izin tidak ditemukan");
  if (row.status !== "DIAJUKAN") {
    throw new ViraInputError(`Ajuan ini sudah ${row.status}.`);
  }
  return row;
}

function mapKeputusan(
  r: HasilKeputusanIzin,
  url: string,
): Extract<ViraExecuteResult, { ok: false }> | null {
  if (r.ok) return null;
  if (r.kode === "KUOTA_CUTI_HABIS") {
    return {
      ok: false,
      code: "KUOTA_CUTI_HABIS",
      message: `Kuota cuti ${r.tahun} pemohon tidak cukup — sisa ${r.sisa} hari kerja.`,
      url,
    };
  }
  return {
    ok: false,
    code: r.kode,
    message: PESAN_TOLAK[r.kode] ?? r.kode,
    url,
  };
}

const REVALIDATE = ["/pwa", "/pwa/absen", "/backoffice/izin", "/backoffice/absensi"] as const;

/**
 * Mirrors `setujuiIzinAction` in `app/actions/izin.ts` (~L99–105) and
 * `setujuiIzin` in `lib/salesman/izin-writer.ts` (~L307–309).
 */
const approveLeaveRequestTool = defineWriteTool({
  kind: "write",
  name: "approve_leave_request",
  title: "Approve leave request",
  description:
    "Prepares approval of a pending leave request (izin, sakit or cuti). The user must press the confirm button.",
  // Card asked for kind:"izin"/bolehMemutuskanIzin; parity forbids izin write gates.
  // Same permission the predicate checks (field_sales_orders:approve) — see #546 comment.
  gate: { kind: "code", code: "field_sales_orders:approve" },
  destructive: false,
  inputShape: {
    leaveRequestId: leaveRequestIdInput,
    note: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe("Optional office note for the requester."),
  },
  argsSchema: z.object({
    leaveRequestId: z.string().min(1),
    note: z.string().trim().max(500).optional(),
  }),
  __sampleInput: { leaveRequestId: "leave-1" },
  prepare: async (input, ctx) => {
    const row = await resolvePending(input.leaveRequestId);
    const url = recordUrl(ctx.baseUrl, `/backoffice/izin?id=${row.id}`);
    const jenisLabel = NAMA_JENIS_IZIN[row.jenis as JenisIzin] ?? row.jenis;
    const tanggal = labelRentangIzin(row.mulai, row.selesai);
    return {
      preview: {
        title: `Setujui ${jenisLabel} ${row.nama}`,
        summary: `${jenisLabel} · ${tanggal} · ${row.hariKerja} hari kerja`,
        details: [
          { label: "Nama", value: row.nama },
          { label: "Jenis", value: jenisLabel },
          { label: "Tanggal", value: tanggal },
          { label: "Hari kerja", value: String(row.hariKerja) },
          { label: "Alasan", value: row.alasan },
          { label: "Catatan", value: input.note?.trim() || "—" },
        ],
        confirmLabel: "Setujui",
        cancelLabel: "Batal",
        destructive: false,
        target: { type: "leave_request", id: row.id, url },
      },
      args: {
        leaveRequestId: row.id,
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    };
  },
  execute: async (args, ctx) => {
    const url = recordUrl(ctx.baseUrl, `/backoffice/izin?id=${args.leaveRequestId}`);
    const r = await setujuiIzin({
      leaveRequestId: args.leaveRequestId,
      olehUserId: ctx.actor.id,
      catatan: args.note ?? null,
    });
    const mapped = mapKeputusan(r, url);
    if (mapped) return mapped;
    const row = await izinById(args.leaveRequestId);
    return {
      ok: true,
      message: `Izin ${row?.nama ?? args.leaveRequestId} disetujui.`,
      url,
      entityType: "LeaveRequest",
      entityId: args.leaveRequestId,
    };
  },
  revalidate: () => [...REVALIDATE],
});

/**
 * Mirrors `tolakIzinAction` in `app/actions/izin.ts` (~L107–113) and
 * `tolakIzin` in `lib/salesman/izin-writer.ts` (~L311–314).
 */
const rejectLeaveRequestTool = defineWriteTool({
  kind: "write",
  name: "reject_leave_request",
  title: "Reject leave request",
  description:
    "Prepares rejection of a pending leave request with a note the requester will see. The user must press the confirm button.",
  // Same as approve — code gate equivalent to bolehMemutuskanIzin (#546).
  gate: { kind: "code", code: "field_sales_orders:approve" },
  destructive: true,
  inputShape: {
    leaveRequestId: leaveRequestIdInput,
    note: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Why the leave is rejected. The requester sees this."),
  },
  argsSchema: z.object({
    leaveRequestId: z.string().min(1),
    note: z.string().trim().min(1).max(500),
  }),
  __sampleInput: { leaveRequestId: "leave-1", note: "x" },
  prepare: async (input, ctx) => {
    const row = await resolvePending(input.leaveRequestId);
    const url = recordUrl(ctx.baseUrl, `/backoffice/izin?id=${row.id}`);
    const jenisLabel = NAMA_JENIS_IZIN[row.jenis as JenisIzin] ?? row.jenis;
    const tanggal = labelRentangIzin(row.mulai, row.selesai);
    return {
      preview: {
        title: `Tolak ${jenisLabel} ${row.nama}`,
        summary: `${jenisLabel} · ${tanggal}`,
        details: [
          { label: "Nama", value: row.nama },
          { label: "Jenis", value: jenisLabel },
          { label: "Tanggal", value: tanggal },
          { label: "Hari kerja", value: String(row.hariKerja) },
          { label: "Alasan", value: row.alasan },
          { label: "Catatan", value: input.note },
        ],
        confirmLabel: "Tolak",
        cancelLabel: "Batal",
        destructive: true,
        target: { type: "leave_request", id: row.id, url },
      },
      args: { leaveRequestId: row.id, note: input.note },
    };
  },
  execute: async (args, ctx) => {
    const url = recordUrl(ctx.baseUrl, `/backoffice/izin?id=${args.leaveRequestId}`);
    const r = await tolakIzin({
      leaveRequestId: args.leaveRequestId,
      olehUserId: ctx.actor.id,
      catatan: args.note,
    });
    const mapped = mapKeputusan(r, url);
    if (mapped) return mapped;
    const row = await izinById(args.leaveRequestId);
    return {
      ok: true,
      message: `Izin ${row?.nama ?? args.leaveRequestId} ditolak.`,
      url,
      entityType: "LeaveRequest",
      entityId: args.leaveRequestId,
    };
  },
  revalidate: () => [...REVALIDATE],
});

export const tools: ViraTool[] = [
  defineTool({
    name: "list_leave_requests",
    title: "Leave requests (izin, sakit, cuti)",
    description:
      "Lists leave requests (izin, sakit, cuti) from salesmen and SPG, newest first, pending ones on top. Filter by status, type or month.",
    gate: { kind: "izin", name: "bolehMelihatIzin", check: (p) => bolehMelihatIzin(p) },
    inputShape: listShape,
    handler: async (input, ctx) => {
      const { baris, terpotong } = await daftarIzinKantor({
        status: (input.status as StatusIzin | undefined) ?? null,
        jenis: (input.type as JenisIzin | undefined) ?? null,
        userId: null,
        bulan: input.month ?? null,
      });
      const items = baris.map((r) => ({
        id: r.id,
        person: { name: r.nama },
        type: r.jenis,
        status: r.status,
        startDay: r.mulai,
        endDay: r.selesai,
        workDays: r.hariKerja,
        reason: r.alasan,
        submittedAt: r.diajukan,
        url: recordUrl(ctx.baseUrl, `/backoffice/izin?id=${r.id}`),
      }));
      const page = sliceToPage(items, input.offset, input.limit);
      return terpotong ? { ...page, truncated: true } : page;
    },
  }),
];

export const writeTools: ViraWriteTool[] = [approveLeaveRequestTool, rejectLeaveRequestTool];

/** Sample MCP args for never-execute (#544), keyed by tool name. */
export const __sampleInput = {
  approve_leave_request: { leaveRequestId: "leave-1" },
  reject_leave_request: { leaveRequestId: "leave-1", note: "x" },
};

export const parityCases: ParityCase[] = [
  {
    tool: "list_leave_requests",
    kind: "predicate",
    module: "@/lib/salesman/izin",
    exportName: "bolehMelihatIzin",
  },
  {
    tool: "approve_leave_request",
    kind: "writeAction",
    actionModule: "@/app/actions/izin",
    actionExport: "setujuiIzinAction",
    writerModule: "@/lib/salesman/izin-writer",
    writerExport: "setujuiIzin",
    args: ["leave-1"],
  },
  {
    tool: "reject_leave_request",
    kind: "writeAction",
    actionModule: "@/app/actions/izin",
    actionExport: "tolakIzinAction",
    writerModule: "@/lib/salesman/izin-writer",
    writerExport: "tolakIzin",
    args: ["leave-1", "catatan"],
  },
];
