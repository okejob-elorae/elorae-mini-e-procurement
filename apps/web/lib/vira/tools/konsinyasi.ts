import { z } from "zod";
import { bacaSaringSiklus, saringSiklus, type SaringSiklus } from "@/app/backoffice/konsinyasi/saring";
import { URUT_TAHAP } from "@/app/backoffice/konsinyasi/tahap";
import { daftarSiklus } from "@/lib/konsinyasi/queries";
import { bolehMembukaKonsi } from "@/lib/receivables/izin";
import { listInputShape, recordUrl, sliceToPage } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

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

export const parityCases: ParityCase[] = [
  { tool: "list_consignment_cycles", kind: "predicate", module: "@/lib/receivables/izin", exportName: "bolehMembukaKonsi" },
];
