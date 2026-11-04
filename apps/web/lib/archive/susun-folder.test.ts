import { describe, expect, it } from "vitest";
import { susunFolder } from "./susun-folder";

type Pemasok = { id: string; name: string; isActive: boolean; jenis: string };

const pemasok: Pemasok[] = [
  { id: "cmt-a", name: "CMT Abadi", isActive: true, jenis: "TAILOR" },
  { id: "cmt-b", name: "CMT Baru", isActive: true, jenis: "TAILOR" },
  { id: "kain", name: "PT Kain Indah", isActive: true, jenis: "FABRIC" },
  { id: "aks", name: "Aksesoris Garmen", isActive: true, jenis: "ACCESSORIES" },
  { id: "lama", name: "CMT Lama", isActive: false, jenis: "TAILOR" },
];

const opsi = {
  tampilKosong: (p: Pemasok) => p.isActive && p.jenis === "TAILOR",
  meta: (n: number) => (n > 0 ? `${n} perintah kerja` : null),
  href: (p: Pemasok) => `/wo?vendorId=${p.id}`,
};

describe("susunFolder", () => {
  it("shows an empty folder only for a party that is expected to have documents", () => {
    const hasil = susunFolder(pemasok, [], opsi);
    expect(hasil.folders.map((f) => f.id)).toEqual(["cmt-a", "cmt-b"]);
  });

  it("always shows a party that has documents, even an inactive or non-CMT one", () => {
    const hasil = susunFolder(
      pemasok,
      [
        { pihakId: "kain", pending: false },
        { pihakId: "lama", pending: true },
      ],
      opsi,
    );
    expect(hasil.folders.map((f) => f.id).sort()).toEqual(["cmt-a", "cmt-b", "kain", "lama"]);
  });

  it("counts the summary from the folders, so the summary equals the sum of the folder numbers", () => {
    const hasil = susunFolder(
      pemasok,
      [
        { pihakId: "cmt-a", pending: true },
        { pihakId: "cmt-a", pending: false },
        { pihakId: "kain", pending: true },
        // A document pointing at a party that no longer exists is in no folder, so not in the total.
        { pihakId: "hilang", pending: true },
      ],
      opsi,
    );
    expect(hasil.totalDocs).toBe(3);
    expect(hasil.totalPending).toBe(2);
    expect(hasil.totalDocs).toBe(hasil.folders.reduce((s, f) => s + f.count, 0));
    expect(hasil.folders.find((f) => f.id === "cmt-a")).toMatchObject({
      count: 2,
      pending: 1,
      meta: "2 perintah kerja",
      href: "/wo?vendorId=cmt-a",
    });
  });

  it("sorts pending work first, then fuller folders, then by name, so empty folders sit last", () => {
    const hasil = susunFolder(
      pemasok,
      [
        { pihakId: "cmt-b", pending: false },
        { pihakId: "cmt-b", pending: false },
        { pihakId: "kain", pending: false },
        { pihakId: "lama", pending: true },
      ],
      opsi,
    );
    expect(hasil.folders.map((f) => f.id)).toEqual(["lama", "cmt-b", "kain", "cmt-a"]);
    expect(hasil.folders.at(-1)?.meta).toBeNull();
  });
});
