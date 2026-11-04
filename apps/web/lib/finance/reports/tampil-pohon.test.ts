import { describe, expect, it } from "vitest";
import type { BalanceRow } from "./balances";
import { buildRollup } from "./rollup";
import { barisPohon, dariRollup, rollupBanyak, type SimpulNilai } from "./tampil-pohon";

function simpul(code: string, sendiri: number[], children: SimpulNilai[] = []): SimpulNilai {
  const subtotal = sendiri.map((v, i) => children.reduce((s, c) => s + c.subtotal[i], v));
  return { accountId: code, code, name: `Akun ${code}`, sendiri, subtotal, children };
}

const ringkas = (rows: ReturnType<typeof barisPohon>) =>
  rows.map((r) => (r.jenis === "judul" ? `judul ${r.code}@${r.level}` : `${r.jenis} ${r.code}@${r.level}=${r.nilai.join("/")}`));

describe("barisPohon", () => {
  it("akun daun tunggal: satu baris angka", () => {
    expect(ringkas(barisPohon([simpul("4101", [100])]))).toEqual(["akun 4101@0=100"]);
  });

  it("induk tunggal satu bagian: judul tanpa angka, tanpa baris jumlah (Total bagian sudah menulisnya)", () => {
    const pohon = [simpul("4", [0], [simpul("4101", [100]), simpul("4102", [50])])];
    expect(ringkas(barisPohon(pohon))).toEqual(["judul 4@0", "akun 4101@1=100", "akun 4102@1=50"]);
  });

  it("induk bertingkat: jumlah hanya untuk induk yang anaknya lebih dari satu", () => {
    const pohon = [
      simpul("6", [0], [
        simpul("61", [0], [simpul("6101", [10]), simpul("6102", [20])]),
        simpul("62", [0], [simpul("6201", [5])]),
      ]),
    ];
    expect(ringkas(barisPohon(pohon))).toEqual([
      "judul 6@0",
      "judul 61@1",
      "akun 6101@2=10",
      "akun 6102@2=20",
      "jumlah 61@1=30",
      "judul 62@1",
      "akun 6201@2=5",
    ]);
  });

  it("menyembunyikan akun bernilai nol secara bawaan, dan induk yang semua anaknya nol", () => {
    const pohon = [
      simpul("4", [0], [simpul("4101", [86470800]), simpul("4102", [0])]),
      simpul("49", [0], [simpul("4901", [0])]),
    ];
    expect(ringkas(barisPohon(pohon))).toEqual(["judul 4@0", "akun 4101@1=86470800"]);
  });

  it("tampilkanNol menampilkan semuanya, termasuk jumlah induk", () => {
    const pohon = [
      simpul("4", [0], [simpul("4101", [100]), simpul("4102", [0])]),
      simpul("49", [0], [simpul("4901", [0])]),
    ];
    expect(ringkas(barisPohon(pohon, { tampilkanNol: true }))).toEqual([
      "judul 4@0",
      "akun 4101@1=100",
      "akun 4102@1=0",
      "jumlah 4@0=100",
      "judul 49@0",
      "akun 4901@1=0",
    ]);
  });

  it("induk yang punya mutasi sendiri: barisnya tampil sebagai rincian, lalu jumlah", () => {
    const pohon = [simpul("11", [300], [simpul("1101", [200])]), simpul("12", [0], [simpul("1201", [7])])];
    const rows = barisPohon(pohon);
    expect(ringkas(rows)).toEqual(["judul 11@0", "akun 11@1=300", "akun 1101@1=200", "jumlah 11@0=500", "judul 12@0", "akun 1201@1=7"]);
    expect(rows[1]).toMatchObject({ jenis: "akun", sendiriInduk: true });
  });

  it("banyak kolom: akun tampil bila salah satu kolom tidak nol", () => {
    const pohon = [simpul("5", [0, 0, 0], [simpul("5101", [0, 100, 0]), simpul("5102", [0, 0, 0])])];
    expect(ringkas(barisPohon(pohon))).toEqual(["judul 5@0", "akun 5101@1=0/100/0"]);
  });

  it("pecahan sen yang membulat ke nol dianggap nol", () => {
    expect(barisPohon([simpul("4101", [0.001])])).toEqual([]);
  });
});

function row(over: Partial<BalanceRow> & { accountId: string; code: string }): BalanceRow {
  return {
    accountId: over.accountId,
    code: over.code,
    name: over.name ?? `Akun ${over.code}`,
    type: over.type ?? "PENDAPATAN",
    parentId: over.parentId ?? null,
    depth: over.depth ?? 0,
    isActive: over.isActive ?? true,
    hasChildren: over.hasChildren ?? false,
    debit: over.debit ?? 0,
    credit: over.credit ?? 0,
    signed: over.signed ?? 0,
  };
}

describe("dariRollup", () => {
  it("membungkus pohon satu kolom", () => {
    const rows = [
      row({ accountId: "p", code: "4", hasChildren: true }),
      row({ accountId: "a", code: "4101", parentId: "p", signed: 100, credit: 100 }),
    ];
    const [akar] = dariRollup(buildRollup(rows, ["PENDAPATAN"]));
    expect(akar).toMatchObject({ code: "4", sendiri: [0], subtotal: [100] });
    expect(akar.children[0]).toMatchObject({ code: "4101", sendiri: [100], subtotal: [100] });
  });
});

describe("rollupBanyak", () => {
  it("menggabungkan akun dari semua kolom; akun yang tidak ada di satu kolom bernilai nol di kolom itu", () => {
    const ini = [
      row({ accountId: "p", code: "4", hasChildren: true }),
      row({ accountId: "a", code: "4101", parentId: "p", signed: 100 }),
    ];
    const lalu = [
      row({ accountId: "p", code: "4", hasChildren: true }),
      row({ accountId: "a", code: "4101", parentId: "p", signed: 80 }),
      // Akun nonaktif yang hanya bergerak di periode lalu.
      row({ accountId: "b", code: "4102", parentId: "p", signed: 5, isActive: false }),
    ];
    const [akar] = rollupBanyak([ini, lalu], ["PENDAPATAN"]);
    expect(akar.subtotal).toEqual([100, 85]);
    expect(akar.children.map((c) => [c.code, c.sendiri])).toEqual([
      ["4101", [100, 80]],
      ["4102", [0, 5]],
    ]);
  });

  it("hanya jenis akun yang diminta", () => {
    const ini = [row({ accountId: "x", code: "1101", type: "ASET", signed: 9 }), row({ accountId: "a", code: "4101", signed: 1 })];
    expect(rollupBanyak([ini], ["PENDAPATAN"]).map((s) => s.code)).toEqual(["4101"]);
  });

  it("subtotal dijumlah dalam sen", () => {
    const ini = [
      row({ accountId: "p", code: "4", hasChildren: true }),
      row({ accountId: "a", code: "4101", parentId: "p", signed: 0.1 }),
      row({ accountId: "b", code: "4102", parentId: "p", signed: 0.2 }),
    ];
    expect(rollupBanyak([ini], ["PENDAPATAN"])[0].subtotal).toEqual([0.3]);
  });
});
