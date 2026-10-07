import { createHash } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, seededIds } from "@elorae/db";

/*
 * POST /api/foto menyimpan sidik isi foto (`Foto.sha256`) — basis data
 * sungguhan, sesi ditiru. Tanpa sidik, foto bukti rekan yang diunduh lalu
 * diunggah ulang menjadi "foto milik sendiri" yang tidak bisa dibedakan.
 */

const sesi = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.id ? { user: { id: sesi.id, permissions: [] } } : null)) }));

const { POST } = await import("./route");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `SIDIK-${Math.random().toString(36).slice(2, 8)}`;

d("POST /api/foto — sidik isi (test bed only)", () => {
  const dibuat: string[] = [];

  afterAll(async () => {
    await prisma.foto.deleteMany({ where: { id: { in: seededIds(dibuat) } } });
  });

  async function unggah(isi: Uint8Array<ArrayBuffer>, jenis = "image/jpeg") {
    const form = new FormData();
    form.append("file", new File([isi], "bukti.jpg", { type: jenis }));
    form.append("caption", tag);
    const res = await POST(new NextRequest("http://localhost/api/foto", { method: "POST", body: form }));
    const body = (await res.json()) as { id?: string; url?: string; error?: string };
    if (body.id) dibuat.push(body.id);
    return { status: res.status, body };
  }

  it("menyimpan sha256 isi berkas (hex huruf kecil) bersama barisnya", async () => {
    sesi.id = `${tag}-a`;
    const isi = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const { status, body } = await unggah(isi);
    expect(status).toBe(200);
    const baris = await prisma.foto.findUniqueOrThrow({
      where: { id: body.id! },
      select: { sha256: true, uploadedById: true, sizeBytes: true },
    });
    expect(baris).toEqual({
      sha256: createHash("sha256").update(isi).digest("hex"),
      uploadedById: `${tag}-a`,
      sizeBytes: 8,
    });
    expect(baris.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("isi yang sama dari orang lain → baris baru miliknya, sidik SAMA (bisa dikenali sebagai kembaran)", async () => {
    const isi = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 9, 9, 9]);
    sesi.id = `${tag}-a`;
    const a = await unggah(isi);
    sesi.id = `${tag}-b`;
    const b = await unggah(isi);
    expect(b.body.id).not.toBe(a.body.id);
    const baris = await prisma.foto.findMany({
      where: { id: { in: seededIds([a.body.id!, b.body.id!]) } },
      select: { uploadedById: true, sha256: true },
      orderBy: { uploadedById: "asc" },
    });
    expect(baris.map((r) => r.uploadedById)).toEqual([`${tag}-a`, `${tag}-b`]);
    expect(baris.map((r) => r.sha256)).toEqual([
      createHash("sha256").update(isi).digest("hex"),
      createHash("sha256").update(isi).digest("hex"),
    ]);
  });

  it("penolakan (jenis berkas) tidak menulis baris", async () => {
    sesi.id = `${tag}-a`;
    const sebelum = await prisma.foto.count({ where: { caption: tag } });
    expect((await unggah(new Uint8Array([1, 2, 3]), "application/pdf")).status).toBe(400);
    expect(await prisma.foto.count({ where: { caption: tag } })).toBe(sebelum);
  });
});
