import "reflect-metadata";
import { Controller, Get, Post, RequestMethod, type Type } from "@nestjs/common";
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { APP_GUARD } from "@nestjs/core";
import { AppModule } from "../app.module";
import { AuthModule } from "./auth.module";
import { InternalSignGuard } from "./internal-sign.guard";
import { IS_PUBLIC_KEY, Public } from "./public.decorator";

// Audit rute apps/api: setiap rute di AppModule dijaga InternalSignGuard
// (APP_GUARD global), KECUALI daftar terbuka di bawah. Rute baru yang diberi
// @Public() — atau AuthModule yang lepas dari AppModule — membuat tes ini gagal.

// Satu-satunya rute yang boleh tanpa tanda tangan internal, beserta alasannya.
const RUTE_TERBUKA: Record<string, string> = {
  "GET /health": "liveness probe Docker/Caddy, tidak membuka data",
  "POST /webhooks/jubelio/:event": "dipanggil Jubelio; diverifikasi header Sign (HMAC) di controller",
};

type Rute = { kunci: string; publik: boolean; controller: string };

type ImporModul =
  | Type<unknown>
  | { module: Type<unknown>; imports?: unknown[]; controllers?: Type<unknown>[]; providers?: unknown[] }
  | { forwardRef: () => Type<unknown> }
  | Promise<unknown>;

async function kumpulkanModul(akar: Type<unknown>): Promise<Map<Type<unknown>, { controllers: Type<unknown>[]; providers: unknown[] }>> {
  const hasil = new Map<Type<unknown>, { controllers: Type<unknown>[]; providers: unknown[] }>();
  const antre: unknown[] = [akar];
  while (antre.length > 0) {
    let entri = antre.shift();
    if (entri instanceof Promise) entri = await entri;
    if (!entri) continue;
    if (typeof entri === "object" && "forwardRef" in (entri as object)) {
      entri = (entri as { forwardRef: () => unknown }).forwardRef();
    }
    let kelas: Type<unknown>;
    let controllers: Type<unknown>[] = [];
    let providers: unknown[] = [];
    let imports: unknown[] = [];
    if (typeof entri === "function") {
      kelas = entri as Type<unknown>;
    } else if (typeof entri === "object" && "module" in (entri as object)) {
      const dinamis = entri as Exclude<ImporModul, Type<unknown> | Promise<unknown> | { forwardRef: () => Type<unknown> }>;
      kelas = dinamis.module;
      controllers = dinamis.controllers ?? [];
      providers = dinamis.providers ?? [];
      imports = dinamis.imports ?? [];
    } else {
      continue;
    }
    controllers = [...controllers, ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, kelas) as Type<unknown>[]) ?? [])];
    providers = [...providers, ...((Reflect.getMetadata(MODULE_METADATA.PROVIDERS, kelas) as unknown[]) ?? [])];
    imports = [...imports, ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, kelas) as unknown[]) ?? [])];

    const lama = hasil.get(kelas);
    if (lama) {
      lama.controllers.push(...controllers);
      lama.providers.push(...providers);
      continue;
    }
    hasil.set(kelas, { controllers, providers });
    antre.push(...imports);
  }
  return hasil;
}

function gabungJalur(...bagian: string[]): string {
  const jalur = "/" + bagian.join("/").split("/").filter(Boolean).join("/");
  return jalur;
}

function ruteController(ctrl: Type<unknown>): Rute[] {
  const dasar = Reflect.getMetadata(PATH_METADATA, ctrl) as string | string[] | undefined;
  const daftarDasar = Array.isArray(dasar) ? dasar : [dasar ?? ""];
  const kelasPublik = Reflect.getMetadata(IS_PUBLIC_KEY, ctrl) === true;
  const hasil: Rute[] = [];
  const proto = ctrl.prototype as Record<string, unknown>;
  // Nest (MetadataScanner) juga mendaftarkan handler WARISAN dari kelas induk,
  // jadi rantai prototipe ikut ditelusuri — kalau tidak, rute @Public() di kelas
  // dasar lolos dari audit.
  const namaMetode = new Set<string>();
  for (let p: object | null = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const n of Object.getOwnPropertyNames(p)) namaMetode.add(n);
  }
  for (const nama of namaMetode) {
    if (nama === "constructor") continue;
    const handler = proto[nama];
    if (typeof handler !== "function") continue;
    const jalur = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
    if (jalur === undefined) continue;
    const metode = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
    const publik = kelasPublik || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;
    for (const d of daftarDasar) {
      for (const j of Array.isArray(jalur) ? jalur : [jalur]) {
        hasil.push({ kunci: `${metode} ${gabungJalur(d, j)}`, publik, controller: ctrl.name });
      }
    }
  }
  return hasil;
}

describe("audit penjaga rute apps/api", () => {
  let modul: Map<Type<unknown>, { controllers: Type<unknown>[]; providers: unknown[] }>;
  let rute: Rute[];

  beforeAll(async () => {
    modul = await kumpulkanModul(AppModule);
    const controllers = new Set<Type<unknown>>();
    for (const { controllers: c } of modul.values()) c.forEach((x) => controllers.add(x));
    rute = [...controllers].flatMap(ruteController);
  });

  it("AppModule memuat AuthModule yang memasang InternalSignGuard sebagai APP_GUARD", () => {
    expect(modul.has(AuthModule)).toBe(true);
    const providers = modul.get(AuthModule)?.providers ?? [];
    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: InternalSignGuard });
  });

  it("menemukan semua rute (penjelajah modul tidak diam-diam kosong)", () => {
    const kunci = rute.map((r) => r.kunci);
    expect(kunci).toEqual(
      expect.arrayContaining([
        "POST /jubelio/salesorders/resync",
        "GET /jubelio/inventory/snapshot",
        "POST /jubelio/outbox/enqueue/:rowId",
        "POST /jubelio/catalog/sync",
        "GET /health",
      ]),
    );
    expect(rute.length).toBeGreaterThanOrEqual(12);
  });

  it("hanya rute di daftar terbuka yang @Public()", () => {
    const publik = rute.filter((r) => r.publik).map((r) => r.kunci).sort();
    expect(publik).toEqual(Object.keys(RUTE_TERBUKA).sort());
  });

  it("rute resync dijaga tanda tangan internal", () => {
    const resync = rute.filter((r) => r.kunci === "POST /jubelio/salesorders/resync");
    expect(resync).toHaveLength(1);
    expect(resync[0].publik).toBe(false);
  });

  it("handler warisan dari kelas induk ikut diaudit", () => {
    class IndukUji {
      @Public()
      @Post("terbuka")
      terbuka(): void {}

      @Get("tertutup")
      tertutup(): void {}
    }
    @Controller("uji-warisan")
    class TurunanUji extends IndukUji {}

    expect(ruteController(TurunanUji)).toEqual(
      expect.arrayContaining([
        { kunci: "POST /uji-warisan/terbuka", publik: true, controller: "TurunanUji" },
        { kunci: "GET /uji-warisan/tertutup", publik: false, controller: "TurunanUji" },
      ]),
    );
  });
});
