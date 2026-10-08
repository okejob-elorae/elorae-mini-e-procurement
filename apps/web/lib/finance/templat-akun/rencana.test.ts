import { describe, expect, it } from "vitest";
import { POSTING_ROLES } from "@/lib/constants/journal-roles";
import { isAccountTypeValidForRole } from "@/lib/finance/journals/role-account-types";
import { TEMPLAT_DAGANG_FESYEN, tipeAkunTemplat } from "./templat";
import { KEDALAMAN_MAKS, rencanaKosong, rencanaPasangTemplat, type AkunAda, type KeadaanBagan, type RencanaTemplat } from "./rencana";

const T = TEMPLAT_DAGANG_FESYEN;

function akun(kode: string, nama: string, tipe: AkunAda["tipe"], kedalaman: number, lain: Partial<AkunAda> = {}): AkunAda {
  return { id: `id-${kode}`, kode, nama, tipe, kedalaman, aktif: true, punyaAnak: false, dipakai: false, ...lain };
}

/** Kerangka SAK-EMKM yang ada di setiap basis data (packages/db/prisma/seeds/coa-sak-emkm.json). */
function kerangkaSakEmkm(): AkunAda[] {
  return [
    akun("1", "Aset", "ASET", 1, { punyaAnak: true }),
    akun("11", "Aset Lancar", "ASET", 2, { punyaAnak: true }),
    akun("1101", "Kas", "ASET", 3),
    akun("1102", "Bank", "ASET", 3),
    akun("2", "Liabilitas", "LIABILITAS", 1, { punyaAnak: true }),
    akun("21", "Utang Lancar", "LIABILITAS", 2),
    akun("3", "Ekuitas", "EKUITAS", 1),
    akun("4", "Pendapatan", "PENDAPATAN", 1),
    akun("5", "HPP", "HPP", 1),
    akun("6", "Beban", "BEBAN", 1),
  ];
}

/** Terapkan rencana ke keadaan tiruan — dipakai untuk membuktikan pemasangan kedua tidak berbuat apa-apa. */
function terapkan(keadaan: KeadaanBagan, r: RencanaTemplat): KeadaanBagan {
  const akunList = [...keadaan.akun];
  for (const b of r.akunBaru) {
    akunList.push(akun(b.kode, b.nama, b.tipe, b.kedalaman));
    if (b.kodeInduk) {
      const i = akunList.findIndex((a) => a.kode === b.kodeInduk);
      akunList[i] = { ...akunList[i], punyaAnak: true };
    }
  }
  for (const p of r.pemetaanBaru) {
    const i = akunList.findIndex((a) => a.kode === p.kode);
    akunList[i] = { ...akunList[i], dipakai: true };
  }
  return { akun: akunList, peranTerpetakan: [...keadaan.peranTerpetakan, ...r.pemetaanBaru.map((p) => p.peran)] };
}

describe("templat Dagang & produksi fesyen", () => {
  it("memetakan SETIAP peran posting tepat satu kali", () => {
    const peran = T.flatMap((a) => a.peran ?? []);
    expect(new Set(peran).size).toBe(peran.length);
    expect([...peran].sort()).toEqual([...POSTING_ROLES].sort());
  });

  it("tipe akun setiap peran adalah tipe yang diizinkan peran itu", () => {
    for (const a of T) {
      const tipe = tipeAkunTemplat(T, a.kode);
      expect(tipe, a.kode).not.toBeNull();
      for (const p of a.peran ?? []) expect(isAccountTypeValidForRole(p, tipe!), `${p} → ${a.kode}`).toBe(true);
    }
  });

  it("kode unik, angka saja ≤ 8 digit, induk muncul lebih dulu, kode anak berawalan kode induk, kedalaman ≤ 4", () => {
    const urutan = new Map<string, number>();
    const kedalaman = new Map<string, number>();
    T.forEach((a, i) => {
      expect(urutan.has(a.kode), `kode ganda ${a.kode}`).toBe(false);
      urutan.set(a.kode, i);
      expect(a.kode).toMatch(/^\d{1,8}$/);
      if (a.induk === null) {
        expect(a.tipe, a.kode).toBeDefined();
        kedalaman.set(a.kode, 1);
      } else {
        expect(a.tipe, `${a.kode}: anak mewarisi tipe induk`).toBeUndefined();
        expect(urutan.get(a.induk), `${a.kode}: induk ${a.induk} harus lebih dulu`).toBeLessThan(i);
        expect(a.kode.startsWith(a.induk) && a.kode.length > a.induk.length, a.kode).toBe(true);
        kedalaman.set(a.kode, kedalaman.get(a.induk)! + 1);
      }
      expect(kedalaman.get(a.kode)!).toBeLessThanOrEqual(KEDALAMAN_MAKS);
    });
  });

  it("akun pemegang peran selalu daun di templat (tidak ada akun templat di bawahnya)", () => {
    const induk = new Set(T.map((a) => a.induk).filter(Boolean));
    for (const a of T) if (a.peran?.length) expect(induk.has(a.kode), a.kode).toBe(false);
  });
});

describe("rencanaPasangTemplat", () => {
  it("bagan kosong: semua akun dibuat dan semua peran dipetakan ke akun baru", () => {
    const r = rencanaPasangTemplat(T, { akun: [], peranTerpetakan: [] });
    expect(r.akunBaru).toHaveLength(T.length);
    expect(r.pemetaanBaru).toHaveLength(POSTING_ROLES.length);
    expect(r.pemetaanBaru.every((p) => p.akunBaru)).toBe(true);
    expect(r.konflik).toEqual([]);
    expect(r.akunSudahAda).toBe(0);
    expect(r.akunBaru.find((a) => a.kode === "1101")).toMatchObject({ tipe: "ASET", kodeInduk: "11", kedalaman: 3 });
  });

  it("kerangka SAK-EMKM: sepuluh akun dipakai ulang, Kas/Bank dipetakan ke akun lama, sisanya dibuat", () => {
    const r = rencanaPasangTemplat(T, { akun: kerangkaSakEmkm(), peranTerpetakan: [] });
    expect(r.akunSudahAda).toBe(10);
    expect(r.akunBaru.map((a) => a.kode)).not.toContain("1101");
    expect(r.pemetaanBaru.find((p) => p.peran === "CASH")).toMatchObject({ kode: "1101", akunBaru: false });
    expect(r.pemetaanBaru.find((p) => p.peran === "BANK")).toMatchObject({ kode: "1102", akunBaru: false });
    expect(r.pemetaanBaru).toHaveLength(POSTING_ROLES.length);
    expect(r.konflik).toEqual([]);
    // "21" adalah daun tanpa jurnal di kerangka — boleh mendapat anak.
    expect(r.akunBaru.find((a) => a.kode === "2101")).toMatchObject({ kodeInduk: "21", kedalaman: 3 });
  });

  it("peran yang sudah dipetakan TIDAK pernah dipetakan ulang, walau akun templatnya ada", () => {
    const keadaan: KeadaanBagan = {
      akun: [...kerangkaSakEmkm(), akun("1103", "Bank BCA", "ASET", 3, { dipakai: true })],
      peranTerpetakan: ["BANK", "CASH", "AP"],
    };
    const r = rencanaPasangTemplat(T, keadaan);
    expect(r.pemetaanBaru.map((p) => p.peran)).not.toContain("BANK");
    expect(r.pemetaanBaru.map((p) => p.peran)).not.toContain("CASH");
    expect(r.pemetaanBaru.map((p) => p.peran)).not.toContain("AP");
    expect(r.peranSudahDipetakan).toEqual(expect.arrayContaining(["BANK", "CASH", "AP"]));
    expect(r.pemetaanBaru).toHaveLength(POSTING_ROLES.length - 3);
  });

  it("akun lama bertipe beda → konflik, anak-anak templatnya tidak dibuat dan perannya tidak dipetakan", () => {
    const keadaan: KeadaanBagan = {
      akun: kerangkaSakEmkm().map((a) => (a.kode === "5" ? { ...a, tipe: "BEBAN" as const } : a)),
      peranTerpetakan: [],
    };
    const r = rencanaPasangTemplat(T, keadaan);
    expect(r.konflik).toEqual([
      { kode: "5", nama: "HPP", sebab: "TIPE_BERBEDA", peran: [] },
      { kode: "5101", nama: "HPP barang terjual", sebab: "INDUK_GAGAL", peran: ["COGS"] },
    ]);
    expect(r.akunBaru.map((a) => a.kode)).not.toContain("5101");
    expect(r.pemetaanBaru.map((p) => p.peran)).not.toContain("COGS");
  });

  it("anak tidak dibuat di bawah akun daun yang sudah dipakai jurnal/peran (akun itu akan berhenti bisa diposting)", () => {
    const keadaan: KeadaanBagan = {
      akun: [...kerangkaSakEmkm(), akun("12", "Aset Tetap", "ASET", 2, { dipakai: true })],
      peranTerpetakan: [],
    };
    const r = rencanaPasangTemplat(T, keadaan);
    expect(r.konflik.filter((k) => k.sebab === "INDUK_DIPAKAI")).toEqual([
      { kode: "1201", nama: "Peralatan & perlengkapan", sebab: "INDUK_DIPAKAI", peran: ["FIXED_ASSET"] },
      { kode: "1209", nama: "Akumulasi penyusutan", sebab: "INDUK_DIPAKAI", peran: ["ACCUM_DEPRECIATION"] },
    ]);
  });

  it("akun pemegang peran yang nonaktif atau punya turunan → konflik, peran dibiarkan kosong", () => {
    const keadaan: KeadaanBagan = {
      akun: [
        ...kerangkaSakEmkm(),
        akun("1104", "Piutang toko", "ASET", 3, { aktif: false }),
        akun("1105", "Piutang marketplace", "ASET", 3, { punyaAnak: true }),
      ],
      peranTerpetakan: [],
    };
    const r = rencanaPasangTemplat(T, keadaan);
    expect(r.konflik).toEqual(
      expect.arrayContaining([
        { kode: "1104", nama: "Piutang usaha (toko)", sebab: "AKUN_NONAKTIF", peran: ["AR_STORE"] },
        { kode: "1105", nama: "Piutang marketplace", sebab: "BUKAN_DAUN", peran: ["AR"] },
      ]),
    );
    expect(r.pemetaanBaru.map((p) => p.peran)).not.toEqual(expect.arrayContaining(["AR_STORE"]));
    expect(r.pemetaanBaru.map((p) => p.peran)).not.toEqual(expect.arrayContaining(["AR"]));
  });

  it("induk nonaktif → anak yang belum ada tidak dibuat", () => {
    const keadaan: KeadaanBagan = {
      akun: [...kerangkaSakEmkm(), akun("61", "Beban penjualan", "BEBAN", 2, { aktif: false })],
      peranTerpetakan: [],
    };
    const r = rencanaPasangTemplat(T, keadaan);
    const anak61 = T.filter((a) => a.induk === "61").map((a) => a.kode);
    expect(r.konflik.filter((k) => k.sebab === "INDUK_NONAKTIF").map((k) => k.kode)).toEqual(anak61);
  });

  it("idempoten: memasang rencana lalu merencanakan ulang menghasilkan rencana kosong", () => {
    for (const awal of [{ akun: [], peranTerpetakan: [] }, { akun: kerangkaSakEmkm(), peranTerpetakan: ["BANK"] }] as KeadaanBagan[]) {
      const r1 = rencanaPasangTemplat(T, awal);
      const r2 = rencanaPasangTemplat(T, terapkan(awal, r1));
      expect(rencanaKosong(r2)).toBe(true);
      expect(r2.konflik).toEqual([]);
      expect(r2.akunSudahAda).toBe(T.length);
    }
  });

  it("bagan uji akuntansi (UJIAKUN): 22 peran lama tetap, peran baru menempati akun berkode sama", () => {
    const lama = [
      ...kerangkaSakEmkm(),
      akun("1103", "Bank BCA", "ASET", 3, { dipakai: true }),
      akun("1104", "Piutang usaha (toko)", "ASET", 3),
      akun("12", "Aset Tetap", "ASET", 2, { punyaAnak: true }),
      akun("1201", "Peralatan & perlengkapan", "ASET", 3, { dipakai: true }),
      akun("3102", "Laba ditahan", "EKUITAS", 2),
      akun("2102", "Hutang pajak (PPh final)", "LIABILITAS", 3, { dipakai: true }),
    ];
    const r = rencanaPasangTemplat(T, { akun: lama, peranTerpetakan: ["BANK", "CASH", "TAX"] });
    expect(r.pemetaanBaru.find((p) => p.peran === "AR_STORE")).toMatchObject({ kode: "1104", akunBaru: false });
    expect(r.pemetaanBaru.find((p) => p.peran === "FIXED_ASSET")).toMatchObject({ kode: "1201", akunBaru: false });
    expect(r.pemetaanBaru.find((p) => p.peran === "RETAINED_EARNINGS")).toMatchObject({ kode: "3102", akunBaru: false });
    expect(r.pemetaanBaru.find((p) => p.peran === "PPH_FINAL_PAYABLE")).toMatchObject({ kode: "2102", akunBaru: false });
    expect(r.akunBaru.map((a) => a.kode)).not.toContain("1103");
    expect(r.konflik).toEqual([]);
  });
});
