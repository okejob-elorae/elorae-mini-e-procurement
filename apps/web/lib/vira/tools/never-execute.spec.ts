import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildViraServerFrom } from "../server";
import { VIRA_PARITY_CASES, VIRA_WRITE_TOOLS } from "./index";
import { defineWriteTool, type ViraWriteTool } from "./types";

/**
 * Prove that no MCP tools/call can reach a write tool's `execute` (or its mirrored writer).
 * Tool cards add rows to `VIRA_WRITE_TOOLS` and attach `__sampleInput` for the call args.
 * With an empty registry this file stays green; missing parity cases fail loudly.
 * A file-local fake (below) proves the MCP/token/execute+writer assertions today.
 */

const tulisNever = vi.hoisted(() => ({
  spy: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("writer must not be called from MCP prepare");
  }),
  exportName: "" as string,
}));

/** Prepare-only deps for registered write tools (so never-execute can call MCP without a DB). */
function mockPrepareDeps(toolName: string): string[] {
  const mocked: string[] = [];
  if (
    toolName === "approve_field_sales_order" ||
    toolName === "reject_field_sales_order"
  ) {
    const pending = {
      id: "o1",
      orderNo: "SO-1",
      orderType: "PUTUS",
      status: "PENDING_APPROVAL",
      storeName: "Toko",
      salesmanName: "Budi",
      total: 100_000,
      lines: [{ id: "l1" }],
      deliveries: [],
      deliveryStatus: "PENDING",
      createdAt: new Date("2026-11-01T00:00:00Z"),
      origin: "FIELD",
      creditHoldAtCreate: false,
      note: null,
      cancelledAt: null,
      cancelledByName: null,
      subtotal: 100_000,
      approvedAt: null,
      rejectedAt: null,
      rejectReason: null,
      closedAt: null,
      closeReason: null,
      markupPercent: null,
      paymentTempo: 30,
      orderDiscountAmount: 0,
      appliedOrderPromoName: null,
      legacyKonsiTransfer: null,
    };
    vi.doMock("@/lib/field-sales/queries", () => ({
      listFieldSalesOrders: vi.fn(async () => ({
        orders: [{ ...pending, orderNo: "SO-1" }],
        totalCount: 1,
      })),
      getFieldSalesOrderById: vi.fn(async () => pending),
    }));
    mocked.push("@/lib/field-sales/queries");
    vi.doMock("@/lib/finance/ar/credit-exposure", () => ({
      computeStoreCreditExposure: vi.fn(async () => ({
        receivableOutstanding: 0,
        undeliveredOrderResidual: 0,
        openInvoiceCount: 0,
        total: 0,
      })),
    }));
    mocked.push("@/lib/finance/ar/credit-exposure");
    vi.doMock("@/lib/salesman/tagihan-toko", () => ({
      bacaAturanKreditDb: vi.fn(async () => ({})),
    }));
    mocked.push("@/lib/salesman/tagihan-toko");
    vi.doMock("@/lib/salesman/kredit", () => ({
      batasKreditBerlaku: vi.fn(() => ({ nilai: { nilai: 1_000_000, sumber: "TOKO" } })),
      lewatBatasNilai: vi.fn(() => false),
    }));
    mocked.push("@/lib/salesman/kredit");
    vi.doMock("@elorae/db", async (asli) => {
      const nyata = await asli<typeof import("@elorae/db")>();
      return {
        ...nyata,
        prisma: {
          ...nyata.prisma,
          fieldSalesOrder: {
            findUnique: vi.fn(async ({ where }: { where: { id?: string; orderNo?: string } }) => {
              if (where.orderNo === "SO-1") return { id: "o1" };
              if (where.id === "o1" || where.id) {
                return { storeId: "s1", kreditDitahan: false };
              }
              return null;
            }),
          },
          store: {
            findUnique: vi.fn(async () => ({
              creditLimit: 1_000_000,
              noCreditLimit: false,
            })),
          },
        },
      };
    });
    mocked.push("@elorae/db");
  }
  if (toolName === "approve_leave_request" || toolName === "reject_leave_request") {
    vi.doMock("@/lib/salesman/izin-queries", () => ({
      daftarIzinKantor: vi.fn(async () => ({
        baris: [],
        perStatus: { DIAJUKAN: 0, DISETUJUI: 0, DITOLAK: 0, DIBATALKAN: 0 },
        terpotong: false,
      })),
      izinById: vi.fn(async () => ({
        id: "leave-1",
        userId: "u-sales",
        nama: "Budi",
        jenis: "IZIN",
        status: "DIAJUKAN",
        mulai: "2026-11-10",
        selesai: "2026-11-11",
        rentang: "10–11 Nov 2026",
        hariKerja: 2,
        alasan: "urusan",
        fotoUrl: null,
        catatanKantor: null,
        diajukan: "10 Nov 2026",
        diputuskan: null,
        diputuskanOleh: null,
        ditarikSendiri: false,
        cuti: null,
      })),
    }));
    mocked.push("@/lib/salesman/izin-queries");
  }
  if (toolName === "approve_spg_buyer_return" || toolName === "reject_spg_buyer_return") {
    vi.doMock("@/lib/spg/retur-pembeli-queries", () => ({
      daftarReturPembeliKantor: vi.fn(async () => ({
        baris: [],
        total: 0,
        perStatus: { MENUNGGU: 0, DISETUJUI: 0, DITOLAK: 0, DIBATALKAN: 0 },
        keputusanBarang: 0,
      })),
      rincianReturPembeliKantor: vi.fn(async () => ({
        id: "r-1",
        status: "MENUNGGU",
        dilaporkanPada: new Date("2026-11-10T02:00:00Z"),
        pelapor: { id: "u-spg", nama: "Sari" },
        toko: { id: "s1", nama: "Toko", termsType: "KONSI" },
        nota: { id: "sale-1", docNo: "NT-001", waktu: new Date(), total: 1 },
        alasan: "x",
        diputuskan: { olehId: null, oleh: null, pada: null, alasanTolak: null },
        uang: { keadaan: "MENUNGGU_BELUM", pada: null, olehKantor: null },
        foto: { barang: null, struk: null },
        strukTidakTercatat: [],
        bebanJikaDitolak: 0,
        beban: null,
        baris: [
          {
            id: "l1",
            saleLineId: "sl1",
            productName: "Kaos",
            variantSku: "KAOS-01",
            kondisi: "LAYAK",
            qty: 1,
            terjual: 1,
            sudahKembali: 0,
            menungguLain: 0,
            nilaiBersih: 10_000,
          },
        ],
        peringatan: {
          bulanKomisi: "2026-11",
          komisiDitutup: false,
          bulanLaporan: "2026-11",
          siklusKonsiTerkunci: false,
        },
        jejak: [],
      })),
    }));
    mocked.push("@/lib/spg/retur-pembeli-queries");
  }
  if (toolName === "close_purchase_order") {
    vi.doMock("@/lib/purchase-orders/queries", () => ({
      listPOs: vi.fn(async () => ({ items: [], totalCount: 0 })),
      getPOById: vi.fn(async () => ({
        id: "po-1",
        docNumber: "PO-1",
        supplierId: "s1",
        supplier: { name: "CV" },
        status: "PARTIAL",
        createdAt: "2026-11-01T00:00:00.000Z",
        etaDate: null,
        grandTotal: 1,
        items: [{ qty: 10, receivedQty: 1 }],
      })),
    }));
    mocked.push("@/lib/purchase-orders/queries");
    vi.doMock("@elorae/db", async (asli) => {
      const nyata = await asli<typeof import("@elorae/db")>();
      return {
        ...nyata,
        prisma: {
          ...nyata.prisma,
          gRN: { count: vi.fn(async () => 0) },
          purchaseOrder: {
            findUnique: vi.fn(async () => ({ id: "po-1" })),
          },
        },
      };
    });
    mocked.push("@elorae/db");
  }
  if (toolName === "record_consignment_document_number") {
    vi.doMock("@elorae/db", async (asli) => {
      const nyata = await asli<typeof import("@elorae/db")>();
      return {
        ...nyata,
        prisma: {
          ...nyata.prisma,
          consignmentCycle: {
            findUnique: vi.fn(async () => ({
              id: "c-1",
              noKonsi: "KNS-c-1",
              storeId: "s1",
              periodYear: 2026,
              periodMonth: 11,
              noNota: null,
              noFakturPajak: null,
              lockedAt: new Date("2026-11-01T00:00:00.000Z"),
              vatApplied: true,
              store: { name: "Toko", consignmentVat: true },
            })),
          },
        },
      };
    });
    mocked.push("@elorae/db");
  }
  if (toolName === "mark_tax_invoice_sent_to_store") {
    const taxRow = {
      id: "t-1",
      status: "CREATED",
      invoiceNo: "010.000-26.00000001",
      delivery: {
        docNo: "NT-1",
        invoiceDate: new Date(),
        dueDate: new Date(),
        total: 1,
        orderId: "o1",
        order: { store: { id: "s1", name: "Toko", npwp: null } },
      },
      sellThrough: null,
    };
    vi.doMock("@elorae/db", async (asli) => {
      const nyata = await asli<typeof import("@elorae/db")>();
      return {
        ...nyata,
        prisma: {
          ...nyata.prisma,
          taxInvoice: {
            findUnique: vi.fn(async () => taxRow),
            findMany: vi.fn(async () => [taxRow]),
          },
        },
      };
    });
    mocked.push("@elorae/db");
  }
  return mocked;
}

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "never-execute-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: unknown): unknown {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0].text);
}

async function assertNeverExecute(
  buildServer: typeof buildViraServerFrom,
  tool: ViraWriteTool,
  sample: Record<string, unknown>,
  writer: ReturnType<typeof vi.fn>,
): Promise<void> {
  const prepareSpy = vi.spyOn(tool, "prepare");
  const executeSpy = vi.spyOn(tool, "execute");
  const client = await connect(
    buildServer(
      [],
      {
        actor: { id: "u-1", name: "Uji", permissions: ["*"] },
        baseUrl: "https://x.test",
      },
      [tool],
    ),
  );
  const res = await client.callTool({ name: tool.name, arguments: sample });
  await client.close();

  expect(prepareSpy).toHaveBeenCalledTimes(1);
  expect(executeSpy).not.toHaveBeenCalled();
  expect(writer).not.toHaveBeenCalled();
  expect(res.isError).toBeFalsy();
  expect(textOf(res)).toMatchObject({ status: "awaiting_confirmation" });

  const meta = (res as { _meta?: Record<string, unknown> })._meta?.[
    "elorae/confirmation"
  ] as { token?: string } | undefined;
  expect(meta?.token).toBeTruthy();
  // Model-visible payloads only — `_meta` holds the token by design.
  const visible = JSON.stringify({
    content: (res as { content: unknown }).content,
    structuredContent: (res as { structuredContent?: unknown }).structuredContent,
  });
  expect(visible).not.toContain(meta!.token);
}

describe("VIRA write tools — model can never execute", () => {
  const SECRET = "test-vira-token-secret-0123456789abcdefg";

  beforeEach(() => {
    vi.stubEnv("VIRA_TOKEN_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("every write tool has a writeAction parity case (empty registry is green)", () => {
    const missing = VIRA_WRITE_TOOLS.filter(
      (t) => !VIRA_PARITY_CASES.some((c) => c.tool === t.name && c.kind === "writeAction"),
    ).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("self-test fake: prepare-only MCP never reaches execute or writer; token stays out of content", async () => {
    const writer = vi.fn(async () => ({
      ok: true as const,
      message: "done",
      url: "/x",
      entityType: "Fake",
      entityId: "1",
    }));
    const tool = defineWriteTool({
      kind: "write",
      name: "never_execute_fake",
      title: "Never-execute fake",
      description: "File-local harness only.",
      gate: { kind: "anyValidToken" },
      destructive: false,
      inputShape: { id: z.string() },
      argsSchema: z.object({ id: z.string() }),
      prepare: async (input) => ({
        preview: {
          title: "Fake",
          summary: "Would write if confirmed.",
          details: [],
          confirmLabel: "Ya",
          cancelLabel: "Batal",
          destructive: false,
          target: { type: "Fake", id: input.id, url: "/x" },
        },
        args: { id: input.id },
      }),
      // Writer is only reachable from execute — proves MCP never gets there.
      execute: async () => writer(),
      revalidate: () => ["/x"],
    });
    await assertNeverExecute(buildViraServerFrom, tool, { id: "ord-1" }, writer);
  });

  it.each(VIRA_WRITE_TOOLS.map((t) => [t.name, t] as const))(
    "%s: MCP tools/call never reaches execute or the writer; token stays out of content",
    async (_nama, tool) => {
      const kasus = VIRA_PARITY_CASES.find(
        (c) => c.tool === tool.name && c.kind === "writeAction",
      );
      expect(kasus, `${tool.name} needs a writeAction parity case`).toBeDefined();
      if (!kasus || kasus.kind !== "writeAction") return;

      expect(
        tool.__sampleInput,
        `${tool.name} must define __sampleInput for never-execute`,
      ).toBeDefined();

      // Pre-built registry tools close over their writer imports. Re-mock the writer
      // (and prepare deps), then re-import so prepare/execute bind the spy.
      vi.resetModules();
      const prepareMocks = mockPrepareDeps(tool.name);
      tulisNever.spy.mockReset();
      tulisNever.spy.mockImplementation(async () => {
        throw new Error(`${kasus.writerExport} must not be called from MCP prepare`);
      });
      tulisNever.exportName = kasus.writerExport;
      vi.doMock(kasus.writerModule, async (asli) => {
        // Fail closed: a typo’d writerModule must not install a silent spy-only stub
        // while prepare still runs the real writer from the correct path.
        let nyata: Record<string, unknown>;
        try {
          nyata = (await asli()) as Record<string, unknown>;
        } catch (err) {
          throw new Error(
            `writer module failed to load for never-execute: ${String(err)}`,
          );
        }
        const nama = tulisNever.exportName;
        if (!(nama in nyata)) {
          throw new Error(`writer module has no export ${nama} to mock`);
        }
        return { ...nyata, [nama]: tulisNever.spy };
      });

      try {
        const [{ buildViraServerFrom: buildFresh }, { VIRA_WRITE_TOOLS: freshWrites }] =
          await Promise.all([
            import("../server"),
            import("./index"),
          ]);
        const fresh = freshWrites.find((t) => t.name === tool.name);
        expect(fresh, `${tool.name} missing after re-import`).toBeDefined();
        const freshSample = fresh!.__sampleInput ?? tool.__sampleInput;
        expect(freshSample).toBeDefined();

        // Prove the mock is bound to the parity writerModule before any execute/prepare
        // that could hit a real writer on a mistyped path.
        const writerMod = (await import(/* @vite-ignore */ kasus.writerModule)) as Record<
          string,
          unknown
        >;
        expect(writerMod[kasus.writerExport]).toBe(tulisNever.spy);

        await assertNeverExecute(
          buildFresh,
          fresh!,
          freshSample as Record<string, unknown>,
          tulisNever.spy,
        );
      } finally {
        vi.doUnmock(kasus.writerModule);
        for (const id of prepareMocks) vi.doUnmock(id);
        // Drop modules that closed over the mocked writer so later files see the real one.
        vi.resetModules();
      }
    },
  );
});
