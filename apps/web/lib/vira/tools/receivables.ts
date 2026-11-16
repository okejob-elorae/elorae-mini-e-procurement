import { z } from "zod";
import { saringPiutang } from "@/app/backoffice/piutang/saring";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { URUT_KEADAAN_TAMPIL, type KeadaanTampil } from "@/lib/receivables/jatuh-tempo";
import { JENIS_TAGIHAN } from "@/lib/receivables/jenis-tagihan";
import { daftarPiutang, ringkasPiutang } from "@/lib/receivables/queries";
import { listInputShape, recordUrl, sliceToPage } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

/** `KeadaanTampil` (URUT_KEADAAN_TAMPIL), the states saringPiutang accepts, `jatuh_tempo` included. */
export const RECEIVABLE_STATES = URUT_KEADAAN_TAMPIL as unknown as [KeadaanTampil, ...KeadaanTampil[]];

const listShape = {
  state: z
    .enum(RECEIVABLE_STATES)
    .optional()
    .describe(
      "Only invoices in this state: lewat (past promised pay date), jatuh_tempo (past due date), tertahan (held for returns), klaim (payment waiting for verification), tt (tanda terima), belum (not yet due), lunas (paid). Omit for every unpaid invoice.",
    ),
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Text to match against the invoice number, store name or salesman name."),
  kind: z
    .enum(JENIS_TAGIHAN)
    .optional()
    .describe("konsi = consignment invoices, nonkonsi = outright (putus) invoices."),
  ...listInputShape,
};

type Jumlah = { jumlah: number; nilai: number };

export const tools: ViraTool[] = [
  defineTool({
    name: "list_receivables",
    title: "Receivables (piutang)",
    description:
      "Lists store receivables (piutang) with a summary: overdue (jatuh tempo), held for returns, waiting for verification, and totals. Filter by state, search, or kind (konsi or putus).",
    gate: { kind: "izin", name: "bolehMembacaPiutang", check: (p) => bolehMembacaPiutang(p) },
    inputShape: listShape,
    handler: async (input, ctx) => {
      // Decision D7: the same three calls as app/backoffice/piutang/page.tsx.
      const semua = await daftarPiutang();
      const rows = saringPiutang(semua, { keadaan: input.state ?? null, cari: input.search ?? "", jenis: input.kind ?? null });
      const r = ringkasPiutang(rows);
      const perState = (src: Record<string, Jumlah>) =>
        Object.fromEntries(URUT_KEADAAN_TAMPIL.map((k) => [k, { count: src[k]?.jumlah ?? 0, outstanding: src[k]?.nilai ?? 0 }]));
      const summary = {
        totalOutstanding: r.total,
        openCount: r.jumlahPiutang,
        byState: perState(r.perKeadaanTampil),
      };
      const items = rows.map((b) => ({
        invoiceNo: b.invoiceNo,
        store: { id: b.storeId, name: b.storeName },
        kind: b.konsi ? "konsi" : "nonkonsi",
        state: b.keadaanTampil,
        amount: b.amount,
        outstanding: b.outstanding,
        dueDate: b.dueDate,
        daysOverdue: b.alasan.hariLewatJatuhTempo ?? b.alasan.lewatTempoDiLuarTahanan?.hari ?? null,
        url: recordUrl(ctx.baseUrl, `/backoffice/piutang?cari=${encodeURIComponent(b.invoiceNo)}`),
      }));
      return { summary, ...sliceToPage(items, input.offset, input.limit) };
    },
  }),
];

export const parityCases: ParityCase[] = [
  { tool: "list_receivables", kind: "predicate", module: "@/lib/receivables/izin", exportName: "bolehMembacaPiutang" },
];
