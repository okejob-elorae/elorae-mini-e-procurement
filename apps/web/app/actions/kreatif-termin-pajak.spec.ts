import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Gerbang izin aksi termin & pajak KOL (sesi, PIN, dan penulis ditiru — tanpa
 * basis data). Setiap ekspor "use server" adalah endpoint: izin diperiksa di
 * aksinya sendiri, pengguna diambil dari sesi, bukan dari isian klien.
 */

const sesi = vi.hoisted(() => ({ ada: true, id: "u-sesi", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.ada ? { user: { id: sesi.id, email: null, permissions: sesi.permissions } } : null)),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const pin = vi.hoisted(() => ({ hasil: { success: true, messageKey: "ok" } as { success: boolean; messageKey?: string }, panggilan: 0 }));
vi.mock("@/app/actions/security/pin-auth", () => ({
  verifyPinForAction: vi.fn(async () => {
    pin.panggilan++;
    return pin.hasil;
  }),
}));

const penulis = vi.hoisted(() => ({ panggilan: [] as { nama: string; arg: unknown }[] }));
const catat = (nama: string, hasil: unknown) =>
  vi.fn(async (arg: unknown) => {
    penulis.panggilan.push({ nama, arg });
    return hasil;
  });
vi.mock("@/lib/creative/termin-writer", () => ({
  aturTermin: catat("aturTermin", { ok: true, kolaborasiId: "k", berubah: true }),
  ubahModePajak: catat("ubahModePajak", { ok: true, kolaborasiId: "k", berubah: true }),
  bayarTermin: catat("bayarTermin", { ok: true, kolaborasiId: "k", payStatus: "LUNAS", tahap: null }),
  bayarTerminBanyak: catat("bayarTerminBanyak", { ok: true, jumlah: 1, kolaborasiIds: ["k"], perpindahan: [] }),
  batalkanBayarTermin: catat("batalkanBayarTermin", { ok: true, kolaborasiId: "k", payStatus: "BELUM", tahap: null }),
  catatBuktiPotong: catat("catatBuktiPotong", { ok: true, kolaborasiId: "k" }),
  catatSetorPph: catat("catatSetorPph", { ok: true, kolaborasiId: "k" }),
}));
vi.mock("@/lib/creative/jurnal-kol", () => ({ postingUlangJurnalKol: catat("postingUlangJurnalKol", { ok: true, diposting: 2, gagal: [] }) }));
vi.mock("@/lib/creative/termin-queries", () => ({
  semuaTermin: vi.fn(async () => []),
  daftarPphDipotong: vi.fn(async () => [
    {
      terminId: "t1",
      kolaborasiId: "k",
      docNo: "BRIEF/1",
      kolId: "kol1",
      kolNama: "Siti",
      label: "Pelunasan",
      pasal: "21",
      jenisPajak: "ORANG_PRIBADI",
      identitasTersamar: "NIK ••••8901",
      adaNpwp: true,
      bruto: 1_000_000,
      dpp: 500_000,
      tarifEfektifPersen: 2.5,
      pph: 25_000,
      neto: 975_000,
      grossUp: false,
      dibayarAt: "2026-10-03",
      nomorBuktiPotong: null,
      buktiPotongAt: null,
      setorAt: null,
      ntpn: null,
    },
  ]),
  identitasLengkap: catat("identitasLengkap", new Map([["kol1", { nik: "3174012345678901", npwp: null }]])),
}));
vi.mock("@/lib/creative/pajak-kol-writer", () => ({
  simpanPajakKol: catat("simpanPajakKol", { ok: true, berubah: true, dihitungUlang: 0 }),
  simpanDataSensitifKol: catat("simpanDataSensitifKol", { ok: true, diubah: ["nik"], lengkap: false }),
  bukaDataSensitifKol: catat("bukaDataSensitifKol", { ok: true, isi: { bankName: "BCA", bankAccount: "1", bankHolder: "x", nik: null, npwp: null } }),
}));
vi.mock("@/lib/creative/pajak-pengaturan", () => ({ simpanTarifPajakKreatif: catat("simpanTarifPajakKreatif", { ok: true, tarif: {}, dihitungUlang: 0 }) }));
const jejak = vi.hoisted(() => ({ n: 0 }));
vi.mock("@elorae/db", () => ({ prisma: { $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({}) } }));
vi.mock("@/lib/receivables/jejak", () => ({
  JEJAK: { DATA_SENSITIF_KOL_DIBUKA: "KOL_SENSITIVE_VIEWED" },
  catatJejak: vi.fn(async () => {
    jejak.n++;
  }),
}));

const termin = await import("./kreatif-termin");
const pajak = await import("./kreatif-pajak");

const sebagai = (...izin: string[]) => {
  sesi.ada = true;
  sesi.permissions = izin;
};

beforeEach(() => {
  penulis.panggilan = [];
  pin.panggilan = 0;
  pin.hasil = { success: true, messageKey: "ok" };
  jejak.n = 0;
});

describe("aksi termin", () => {
  it("tanpa sesi atau hanya creative:view → TANPA_AKSES, penulis tidak dipanggil", async () => {
    sesi.ada = false;
    expect(await termin.bayarTerminAction({ terminId: "t", tanggal: "2026-10-01" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sebagai("creative:view");
    expect(await termin.bayarTerminAction({ terminId: "t", tanggal: "2026-10-01" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await termin.aturTerminAction({ kolaborasiId: "k", rencana: [], dasar: "PERSEN" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(penulis.panggilan).toHaveLength(0);
  });

  it("creative:manage membayar dengan pengguna dari SESI, bukan dari klien", async () => {
    sebagai("creative:view", "creative:manage");
    const isian = { terminId: "t", tanggal: "2026-10-01", olehUserId: "penyusup" } as unknown as Parameters<typeof termin.bayarTerminAction>[0];
    expect(await termin.bayarTerminAction(isian)).toMatchObject({ ok: true });
    expect(penulis.panggilan[0]).toMatchObject({ nama: "bayarTermin", arg: { terminId: "t", olehUserId: "u-sesi" } });
  });

  it("keuangan (journals:manage) juga boleh membayar", async () => {
    sebagai("journals:view", "journals:manage");
    expect(await termin.bayarTerminBanyakAction({ terminIds: ["t1"], tanggal: "2026-10-01" })).toMatchObject({ ok: true });
  });

  it("bukti potong, setoran, dan posting ulang jurnal hanya untuk keuangan", async () => {
    sebagai("creative:view", "creative:manage");
    expect(await termin.catatBuktiPotongAction({ terminId: "t", nomor: "BP" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await termin.catatSetorPphAction({ terminId: "t", setor: { tanggal: "2026-10-01", ntpn: "N" } })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await termin.postingUlangJurnalKolAction("k")).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sebagai("journals:view", "journals:manage");
    expect(await termin.catatSetorPphAction({ terminId: "t", setor: { tanggal: "2026-10-01", ntpn: "N" } })).toMatchObject({ ok: true });
    expect(await termin.postingUlangJurnalKolAction("k")).toEqual({ ok: true, diposting: 2, gagal: [] });
  });
});

describe("aksi pajak & data sensitif", () => {
  it("menulis rekening/NIK: creative:manage; keuangan saja tidak", async () => {
    sebagai("journals:manage");
    expect(await pajak.simpanDataSensitifKolAction({ kolId: "kol1", isi: { nik: "3174012345678901" } })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sebagai("creative:manage");
    expect(await pajak.simpanDataSensitifKolAction({ kolId: "kol1", isi: { nik: "3174012345678901" } })).toMatchObject({ ok: true });
  });

  it("membuka data lengkap: keuangan + PIN; pengelola Kreatif ditolak sebelum PIN diperiksa", async () => {
    sebagai("creative:view", "creative:manage");
    expect(await pajak.bukaDataSensitifKolAction({ kolId: "kol1", pin: "1234" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(pin.panggilan).toBe(0);
    sebagai("journals:manage");
    pin.hasil = { success: false, messageKey: "pinIncorrect" };
    expect(await pajak.bukaDataSensitifKolAction({ kolId: "kol1", pin: "0000" })).toEqual({ ok: false, kode: "PIN", pesan: "pinIncorrect" });
    expect(penulis.panggilan.some((p) => p.nama === "bukaDataSensitifKol")).toBe(false);
    pin.hasil = { success: true, messageKey: "ok" };
    expect(await pajak.bukaDataSensitifKolAction({ kolId: "kol1", pin: "1234" })).toMatchObject({ ok: true });
    expect(penulis.panggilan.find((p) => p.nama === "bukaDataSensitifKol")).toMatchObject({ arg: { kolId: "kol1", olehUserId: "u-sesi" } });
  });

  it("admin sistem (*) boleh membuka data lengkap", async () => {
    sebagai("*");
    expect(await pajak.bukaDataSensitifKolAction({ kolId: "kol1", pin: "1234" })).toMatchObject({ ok: true });
  });

  it("ekspor PPh: tanpa PIN tersamar; dengan PIN hanya keuangan, identitas lengkap + jejak per KOL", async () => {
    sebagai("journals:view");
    const tersamar = await pajak.eksporPphDipotongAction({ masa: "2026-10" });
    expect(tersamar).toMatchObject({ ok: true, lengkap: false });
    if (!tersamar.ok) throw new Error("ekspor gagal");
    expect(tersamar.isi).toContain("NIK ••••8901");
    expect(tersamar.isi).not.toContain("3174012345678901");
    expect(penulis.panggilan.some((p) => p.nama === "identitasLengkap")).toBe(false);

    expect(await pajak.eksporPphDipotongAction({ masa: "2026-10", pin: "1234" })).toEqual({ ok: false, kode: "TANPA_AKSES" });

    sebagai("journals:view", "journals:manage");
    const lengkap = await pajak.eksporPphDipotongAction({ masa: "2026-10", pin: "1234" });
    expect(lengkap).toMatchObject({ ok: true, lengkap: true });
    if (!lengkap.ok) throw new Error("ekspor gagal");
    expect(lengkap.isi).toContain("3174012345678901");
    expect(jejak.n).toBe(1);

    expect(await pajak.eksporPphDipotongAction({ masa: "Oktober" })).toEqual({ ok: false, kode: "MASA_TIDAK_VALID" });
  });

  it("tarif pajak: pengelola Kreatif atau keuangan; pembaca saja ditolak", async () => {
    sebagai("creative:view");
    expect(await pajak.simpanTarifPajakAction({})).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sebagai("journals:manage");
    expect(await pajak.simpanTarifPajakAction({})).toMatchObject({ ok: true });
  });
});
