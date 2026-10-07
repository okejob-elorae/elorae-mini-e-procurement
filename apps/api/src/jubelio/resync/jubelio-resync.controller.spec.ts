import { Module, type INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AuthModule } from "../../auth/auth.module";
import { computeSignature } from "../../auth/internal-sign.util";
// Klien asli apps/web (dipakai triggerSettlementResyncAction). Diimpor dari sini,
// bukan dari tes apps/web: tsconfig api mengecualikan *.spec.ts, sedangkan
// `next build` memeriksa semua berkas web dan image web tidak memuat apps/api.
import { apiFetch } from "../../../../web/lib/internal-api";
import { JubelioResyncController } from "./jubelio-resync.controller";
import { ResyncSeedService } from "./resync-seed.service";

// Uji lewat HTTP sungguhan: AuthModule asli (APP_GUARD global) + controller
// resync di modulnya sendiri, persis seperti AppModule menyusunnya. Hanya
// ResyncSeedService yang dipalsukan supaya tidak menyentuh basis data.
// Kasus terakhir memanggil apiFetch milik apps/web ke server ini: kalau rumus
// tanda tangan web dan api berselisih, tombol resync diam-diam selalu 401.

const SECRET = "resync-guard-spec-secret";
const PATH = "/jubelio/salesorders/resync";

const seedBatch = jest.fn();

@Module({
  controllers: [JubelioResyncController],
  providers: [{ provide: ResyncSeedService, useValue: { seedBatch } }],
})
class ResyncUjiModule {}

function tandaTangan(path: string, userId: string, body: string, secret = SECRET): string {
  return computeSignature("POST", path, userId, body, secret);
}

describe("POST /jubelio/salesorders/resync — dijaga tanda tangan internal", () => {
  let app: INestApplication;
  let base: string;
  let secretLama: string | undefined;
  let urlLama: string | undefined;

  beforeAll(async () => {
    secretLama = process.env.INTERNAL_API_SECRET;
    urlLama = process.env.INTERNAL_API_URL;
    process.env.INTERNAL_API_SECRET = SECRET;

    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        AuthModule,
        ResyncUjiModule,
      ],
    }).compile();
    app = mod.createNestApplication({ rawBody: true, logger: false });
    await app.listen(0, "127.0.0.1");
    base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
    process.env.INTERNAL_API_URL = base;
  });

  afterAll(async () => {
    await app?.close();
    if (secretLama === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = secretLama;
    if (urlLama === undefined) delete process.env.INTERNAL_API_URL;
    else process.env.INTERNAL_API_URL = urlLama;
  });

  beforeEach(() => {
    seedBatch.mockReset();
    seedBatch.mockResolvedValue({ batchId: "batch-uji", seeded: 2 });
  });

  async function kirim(body: string, headers: Record<string, string>): Promise<Response> {
    return fetch(`${base}${PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
  }

  it("menolak 401 tanpa header tanda tangan, dan tidak membuat batch", async () => {
    const res = await kirim(JSON.stringify({ salesorderNos: ["SO-1"] }), {});
    expect(res.status).toBe(401);
    expect(seedBatch).not.toHaveBeenCalled();
  });

  it("menolak 401 bila tanda tangan dibuat dengan rahasia lain", async () => {
    const body = JSON.stringify({ salesorderNos: ["SO-1"] });
    const res = await kirim(body, {
      "X-Internal-Sign": tandaTangan(PATH, "u1", body, "rahasia-lain"),
      "X-User-Id": "u1",
    });
    expect(res.status).toBe(401);
    expect(seedBatch).not.toHaveBeenCalled();
  });

  it("menolak 401 bila isi permintaan diubah sesudah ditandatangani", async () => {
    const asli = JSON.stringify({ salesorderNos: ["SO-1"] });
    const diubah = JSON.stringify({ salesorderNos: ["SO-1", "SO-999"] });
    const res = await kirim(diubah, {
      "X-Internal-Sign": tandaTangan(PATH, "u1", asli),
      "X-User-Id": "u1",
    });
    expect(res.status).toBe(401);
    expect(seedBatch).not.toHaveBeenCalled();
  });

  it("menolak 401 bila tanda tangan milik rute lain dipakai ulang", async () => {
    const body = JSON.stringify({ salesorderNos: ["SO-1"] });
    const res = await kirim(body, {
      "X-Internal-Sign": tandaTangan("/jubelio/refresh", "u1", body),
      "X-User-Id": "u1",
    });
    expect(res.status).toBe(401);
    expect(seedBatch).not.toHaveBeenCalled();
  });

  it("menolak 401 bila X-User-Id ditukar sesudah ditandatangani", async () => {
    const body = JSON.stringify({ salesorderNos: ["SO-1"] });
    const res = await kirim(body, {
      "X-Internal-Sign": tandaTangan(PATH, "u1", body),
      "X-User-Id": "u2",
    });
    expect(res.status).toBe(401);
    expect(seedBatch).not.toHaveBeenCalled();
  });

  it("meneruskan permintaan bertanda tangan sah dan mencatat siapa yang memicu batch", async () => {
    const body = JSON.stringify({ salesorderNos: ["SO-1", "SO-2"] });
    const res = await kirim(body, {
      "X-Internal-Sign": tandaTangan(PATH, "user_42", body),
      "X-User-Id": "user_42",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ batchId: "batch-uji", seeded: 2 });
    expect(seedBatch).toHaveBeenCalledTimes(1);
    expect(seedBatch).toHaveBeenCalledWith({
      salesorderNos: ["SO-1", "SO-2"],
      enqueuedById: "user_42",
    });
  });

  it("alur sistem (X-User-Id kosong) diterima tanpa pencatat", async () => {
    const body = JSON.stringify({ salesorderNos: ["SO-7"] });
    const res = await kirim(body, {
      "X-Internal-Sign": tandaTangan(PATH, "", body),
      "X-User-Id": "",
    });
    expect(res.status).toBe(200);
    expect(seedBatch).toHaveBeenCalledWith({
      salesorderNos: ["SO-7"],
      enqueuedById: undefined,
    });
  });

  it("isian bukan teks dibuang, bukan membuat 500", async () => {
    const body = JSON.stringify({ salesorderNos: ["SO-1", 5, null, { no: "x" }, "SO-3"] });
    const res = await kirim(body, {
      "X-Internal-Sign": tandaTangan(PATH, "u1", body),
      "X-User-Id": "u1",
    });
    expect(res.status).toBe(200);
    expect(seedBatch).toHaveBeenCalledWith({
      salesorderNos: ["SO-1", "SO-3"],
      enqueuedById: "u1",
    });
  });

  it("klien apps/web (apiFetch) lolos penjaga dengan pengguna yang memicu", async () => {
    const r = await apiFetch<{ batchId: string; seeded: number }>("POST", PATH, {
      userId: "user_web",
      body: { salesorderNos: ["SO-W1", "SO-W2"] },
    });
    expect(r).toEqual({ ok: true, status: 200, data: { batchId: "batch-uji", seeded: 2 } });
    expect(seedBatch).toHaveBeenCalledWith({
      salesorderNos: ["SO-W1", "SO-W2"],
      enqueuedById: "user_web",
    });
  });
});
