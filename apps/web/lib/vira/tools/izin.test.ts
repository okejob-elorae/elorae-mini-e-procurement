import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({
  daftarIzinKantor: vi.fn(),
  izinById: vi.fn(),
  setujuiIzin: vi.fn(),
  tolakIzin: vi.fn(),
}));

vi.mock("@/lib/salesman/izin-queries", () => ({
  daftarIzinKantor: m.daftarIzinKantor,
  izinById: m.izinById,
}));
vi.mock("@/lib/salesman/izin-writer", () => ({
  setujuiIzin: m.setujuiIzin,
  tolakIzin: m.tolakIzin,
}));

import { __sampleInput, parityCases, tools, writeTools } from "./izin";

const list = tools.find((t) => t.name === "list_leave_requests")!;
const approve = writeTools.find((t) => t.name === "approve_leave_request")!;
const reject = writeTools.find((t) => t.name === "reject_leave_request")!;
const listSchema = z.object(list.inputShape);
const approveSchema = z.object(approve.inputShape);
const rejectSchema = z.object(reject.inputShape);

const ctx: ViraToolContext = {
  actor: { id: "u1", name: "Uji", permissions: ["field_sales_orders:view"] },
  baseUrl: "https://e.test",
};
const writeCtx: ViraToolContext = {
  actor: {
    id: "u-admin",
    name: "Admin",
    permissions: ["field_sales_orders:approve", "vira:write"],
  },
  baseUrl: "https://e.test",
};

function row(extra: Record<string, unknown> = {}) {
  return {
    id: "leave-1",
    userId: "u-sales",
    nama: "Budi",
    jenis: "IZIN",
    status: "DIAJUKAN",
    mulai: "2026-11-10",
    selesai: "2026-11-11",
    rentang: "10–11 Nov 2026",
    hariKerja: 2,
    alasan: "urusan keluarga",
    fotoUrl: null,
    catatanKantor: null,
    diajukan: "10 Nov 2026, 08:00",
    diputuskan: null,
    diputuskanOleh: null,
    ditarikSendiri: false,
    cuti: null,
    ...extra,
  };
}

beforeEach(() => {
  m.daftarIzinKantor.mockReset().mockResolvedValue({
    baris: [row()],
    perStatus: { DIAJUKAN: 1, DISETUJUI: 0, DITOLAK: 0, DIBATALKAN: 0 },
    terpotong: false,
  });
  m.izinById.mockReset().mockResolvedValue(row());
  m.setujuiIzin.mockReset().mockResolvedValue({ ok: true });
  m.tolakIzin.mockReset().mockResolvedValue({ ok: true });
});

describe("list_leave_requests", () => {
  it("accepts StatusIzin / JenisIzin / YYYY-MM month", () => {
    expect(listSchema.safeParse({ status: "DIAJUKAN", type: "CUTI", month: "2026-11" }).success).toBe(
      true,
    );
    expect(listSchema.safeParse({ status: "PENDING" }).success).toBe(false);
    expect(listSchema.safeParse({ type: "cuti" }).success).toBe(false);
    expect(listSchema.safeParse({ month: "2026-11-01" }).success).toBe(false);
  });

  it("maps listed fields, pages with sliceToPage, and marks truncated", async () => {
    const out = serialize(
      await list.handler(listSchema.parse({ status: "DIAJUKAN", type: "IZIN", month: "2026-11" }), ctx),
    ) as { items: Record<string, unknown>[]; truncated?: boolean };
    expect(m.daftarIzinKantor).toHaveBeenCalledWith({
      status: "DIAJUKAN",
      jenis: "IZIN",
      userId: null,
      bulan: "2026-11",
    });
    expect(out.items[0]).toEqual({
      id: "leave-1",
      person: { name: "Budi" },
      type: "IZIN",
      status: "DIAJUKAN",
      startDay: "2026-11-10",
      endDay: "2026-11-11",
      workDays: 2,
      reason: "urusan keluarga",
      submittedAt: "10 Nov 2026, 08:00",
      url: "https://e.test/backoffice/izin?id=leave-1",
    });
    expect(out).not.toHaveProperty("truncated");

    m.daftarIzinKantor.mockResolvedValue({
      baris: Array.from({ length: 3 }, (_, i) => row({ id: `l${i}` })),
      perStatus: { DIAJUKAN: 3, DISETUJUI: 0, DITOLAK: 0, DIBATALKAN: 0 },
      terpotong: true,
    });
    const trunc = serialize(await list.handler(listSchema.parse({ limit: 2, offset: 0 }), ctx)) as {
      items: unknown[];
      truncated?: boolean;
      hasMore: boolean;
    };
    expect(trunc.items).toHaveLength(2);
    expect(trunc.truncated).toBe(true);
  });

  it("parity: predicate bolehMelihatIzin", () => {
    expect(parityCases).toContainEqual({
      tool: "list_leave_requests",
      kind: "predicate",
      module: "@/lib/salesman/izin",
      exportName: "bolehMelihatIzin",
    });
  });
});

describe("approve_leave_request / reject_leave_request", () => {
  it("exports __sampleInput and writeAction parity cases", () => {
    expect(__sampleInput).toEqual({
      approve_leave_request: { leaveRequestId: "leave-1" },
      reject_leave_request: { leaveRequestId: "leave-1", note: "x" },
    });
    expect(parityCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "approve_leave_request",
          kind: "writeAction",
          actionExport: "setujuiIzinAction",
          writerExport: "setujuiIzin",
          args: ["leave-1"],
        }),
        expect.objectContaining({
          tool: "reject_leave_request",
          kind: "writeAction",
          actionExport: "tolakIzinAction",
          writerExport: "tolakIzin",
          args: ["leave-1", "catatan"],
        }),
      ]),
    );
  });

  it("reject note blank fails the schema", () => {
    expect(rejectSchema.safeParse({ leaveRequestId: "leave-1", note: "   " }).success).toBe(false);
    expect(rejectSchema.safeParse({ leaveRequestId: "leave-1", note: "" }).success).toBe(false);
  });

  it("prepare approve: preview + revalidate paths; never calls writer", async () => {
    const prepared = await approve.prepare(
      approveSchema.parse({ leaveRequestId: "leave-1", note: "ok" }),
      writeCtx,
    );
    expect(m.setujuiIzin).not.toHaveBeenCalled();
    expect(prepared.args).toEqual({ leaveRequestId: "leave-1", note: "ok" });
    expect(prepared.preview.title).toBe("Setujui Izin Budi");
    expect(prepared.preview.confirmLabel).toBe("Setujui");
    expect(prepared.preview.cancelLabel).toBe("Batal");
    expect(prepared.preview.details.find((d) => d.label === "Tanggal")?.value).toBe("10–11 Nov 2026");
    expect(
      approve.revalidate(prepared.args, {
        ok: true,
        message: "",
        url: "",
        entityType: "",
        entityId: "",
      }),
    ).toEqual(["/pwa", "/pwa/absen", "/backoffice/izin", "/backoffice/absensi"]);
  });

  it("wrong status / missing / own request → prepare refuses", async () => {
    m.izinById.mockResolvedValue(row({ status: "DISETUJUI" }));
    await expect(
      approve.prepare(approveSchema.parse({ leaveRequestId: "leave-1" }), writeCtx),
    ).rejects.toEqual(new ViraInputError("Ajuan ini sudah DISETUJUI."));
    m.izinById.mockResolvedValue(null);
    await expect(
      approve.prepare(approveSchema.parse({ leaveRequestId: "missing" }), writeCtx),
    ).rejects.toEqual(new ViraNotFoundError("Ajuan izin tidak ditemukan"));
    m.izinById.mockResolvedValue(row({ userId: "u-admin" }));
    await expect(
      approve.prepare(approveSchema.parse({ leaveRequestId: "leave-1" }), writeCtx),
    ).rejects.toEqual(new ViraInputError("Anda tidak bisa memutuskan ajuan Anda sendiri."));
  });

  it("CUTI preview includes kuota detail", async () => {
    m.izinById.mockResolvedValue(
      row({
        jenis: "CUTI",
        cuti: { tahun: "2026", kuota: 12, disetujui: 4, menunggu: 2, sisa: 6 },
      }),
    );
    const prepared = await approve.prepare(
      approveSchema.parse({ leaveRequestId: "leave-1" }),
      writeCtx,
    );
    expect(prepared.preview.details.find((d) => d.label === "Kuota cuti")?.value).toBe(
      "Sisa 6 dari 12 (2026; disetujui 4, menunggu 2)",
    );
  });

  it("approve execute calls setujuiIzin with actor and maps KUOTA_CUTI_HABIS", async () => {
    m.izinById.mockResolvedValue(row({ status: "DISETUJUI", nama: "Budi" }));
    const ok = await approve.execute({ leaveRequestId: "leave-1", note: "cat" }, writeCtx);
    expect(m.setujuiIzin).toHaveBeenCalledWith({
      leaveRequestId: "leave-1",
      olehUserId: "u-admin",
      catatan: "cat",
    });
    expect(ok).toEqual({
      ok: true,
      message: "Izin Budi disetujui.",
      url: "https://e.test/backoffice/izin?id=leave-1",
      entityType: "LeaveRequest",
      entityId: "leave-1",
    });

    m.setujuiIzin.mockResolvedValueOnce({ ok: true });
    m.izinById.mockResolvedValueOnce(row({ status: "DISETUJUI", jenis: "SAKIT", nama: "Sari" }));
    const sakit = await approve.execute({ leaveRequestId: "leave-1" }, writeCtx);
    expect(sakit).toMatchObject({ ok: true, message: "Sakit Sari disetujui." });

    m.setujuiIzin.mockResolvedValueOnce({
      ok: false,
      kode: "KUOTA_CUTI_HABIS",
      tahun: "2026",
      sisa: 1,
    });
    const fail = await approve.execute({ leaveRequestId: "leave-1" }, writeCtx);
    expect(fail).toEqual({
      ok: false,
      code: "KUOTA_CUTI_HABIS",
      message: "Kuota cuti 2026 pemohon tidak cukup — sisa 1 hari kerja.",
      url: "https://e.test/backoffice/izin?id=leave-1",
    });
  });

  it("reject execute calls tolakIzin and maps SUDAH_DIPUTUSKAN", async () => {
    m.izinById.mockResolvedValue(row({ status: "DITOLAK", nama: "Budi" }));
    const ok = await reject.execute({ leaveRequestId: "leave-1", note: "penuh" }, writeCtx);
    expect(m.tolakIzin).toHaveBeenCalledWith({
      leaveRequestId: "leave-1",
      olehUserId: "u-admin",
      catatan: "penuh",
    });
    expect(ok).toMatchObject({ ok: true, message: "Izin Budi ditolak." });

    m.tolakIzin.mockResolvedValueOnce({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
    const fail = await reject.execute({ leaveRequestId: "leave-1", note: "penuh" }, writeCtx);
    expect(fail).toEqual({
      ok: false,
      code: "SUDAH_DIPUTUSKAN",
      message: "Ajuan ini sudah diputuskan atau ditarik. Daftar disegarkan.",
      url: "https://e.test/backoffice/izin?id=leave-1",
    });
  });

  it("prepare reject preview", async () => {
    const prepared = await reject.prepare(
      rejectSchema.parse({ leaveRequestId: "leave-1", note: "jadwal padat" }),
      writeCtx,
    );
    expect(prepared.preview.title).toBe("Tolak Izin Budi");
    expect(prepared.preview.confirmLabel).toBe("Tolak");
    expect(prepared.preview.destructive).toBe(true);
    expect(prepared.args).toEqual({ leaveRequestId: "leave-1", note: "jadwal padat" });
  });

  it("writer throw → refused GAGAL (no 500); failed re-read after success still ok", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gagal = {
      ok: false,
      code: "GAGAL",
      message: "Gagal menyimpan. Coba lagi.",
      url: "https://e.test/backoffice/izin?id=leave-1",
    };
    m.setujuiIzin.mockRejectedValueOnce(new Error("db down"));
    expect(await approve.execute({ leaveRequestId: "leave-1" }, writeCtx)).toEqual(gagal);
    m.tolakIzin.mockRejectedValueOnce(new Error("db down"));
    expect(await reject.execute({ leaveRequestId: "leave-1", note: "x" }, writeCtx)).toEqual(gagal);

    m.setujuiIzin.mockResolvedValueOnce({ ok: true });
    m.izinById.mockRejectedValueOnce(new Error("db down"));
    expect(await approve.execute({ leaveRequestId: "leave-1" }, writeCtx)).toMatchObject({ ok: true });
  });
});
