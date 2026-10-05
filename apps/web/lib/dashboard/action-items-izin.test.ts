import { describe, expect, it } from "vitest";
import { hasPermission } from "@/lib/rbac";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { buildActionItems, type BuildActionItemsInput } from "./action-items";

/*
 * Baris "Lewat janji bayar" mengikuti pagar yang SAMA dengan kartu piutang di
 * beranda (`bolehMembacaPiutang`: receivables:view ATAU receivables:manage).
 * Dulu barisnya menuntut receivables:view saja, jadi pengelola piutang yang
 * hanya memegang receivables:manage melihat kartu "lewat janji" tetapi barisnya
 * di daftar tindakan hilang.
 */

const nol: BuildActionItemsInput = {
  fieldSalesPendingApproval: 0,
  storeChangesPending: 0,
  taxInvoicePending: 0,
  salesReturnPending: 0,
  journalPending: 0,
  overduePOs: 0,
  draftPOs: 0,
  oversoldSkus: 0,
  unshippedOrders: 0,
};

const masukan: BuildActionItemsInput = {
  ...nol,
  overduePOs: 1,
  overduePromises: { count: 2, amount: 3_100_000 },
};

/** Saringan yang dipakai beranda dan lencana menu sesudah `buildActionItems`. */
const terlihat = (izin: string[]) =>
  buildActionItems(masukan, izin)
    .filter((i) => !i.permission || hasPermission(izin, i.permission))
    .map((i) => i.key);

describe("buildActionItems — baris lewat janji bayar memakai bolehMembacaPiutang", () => {
  const kasus: string[][] = [
    ["dashboard:view", "receivables:manage"],
    ["dashboard:view", "receivables:view"],
    ["dashboard:view", "receivables:view", "receivables:manage"],
    ["dashboard:view", "journals:manage"],
    ["dashboard:view", "purchase_orders:view"],
    ["*"],
  ];
  for (const izin of kasus) {
    it(`[${izin.join(", ")}] sama dengan kartu piutang`, () => {
      expect(terlihat(izin).includes("overduePromises")).toBe(bolehMembacaPiutang(izin));
    });
  }

  it("pemegang receivables:manage saja melihat barisnya, lengkap dengan nilai", () => {
    const baris = buildActionItems(masukan, ["dashboard:view", "receivables:manage"]).find((i) => i.key === "overduePromises");
    expect(baris).toMatchObject({ count: 2, amount: 3_100_000, href: "/backoffice/piutang?keadaan=lewat" });
  });

  it("baris lain tetap disaring dengan izinnya sendiri", () => {
    expect(terlihat(["dashboard:view", "receivables:manage"])).not.toContain("overduePOs");
    expect(terlihat(["dashboard:view", "purchase_orders:view"])).toEqual(["overduePOs"]);
  });

  it("izin pemanggil yang tidak lolos membuang barisnya walau datanya ikut dioper", () => {
    expect(terlihat(["dashboard:view", "purchase_orders:view"])).not.toContain("overduePromises");
  });
});

/*
 * Beranda memanggil `buildActionItems` TANPA izin dan menyaring sesudahnya
 * dengan `!permission || hasPermission(izin, permission)`. Datanya
 * (`overduePromises`) hanya diisi bila kartu piutang dimuat — `kartuBeranda`
 * memakai `bolehMembacaPiutang` — jadi itulah pagarnya di jalur ini. Dulu
 * barisnya membawa `receivables:view`, sehingga pemegang receivables:manage
 * saja kehilangan barisnya di beranda yang sesungguhnya.
 */
describe("buildActionItems tanpa izin — cara beranda memanggilnya", () => {
  const seperti = (izin: string[]) => {
    const kartuPiutang = bolehMembacaPiutang(izin);
    return buildActionItems({ ...masukan, overduePromises: kartuPiutang ? masukan.overduePromises : undefined })
      .filter((i) => !i.permission || hasPermission(izin, i.permission))
      .map((i) => i.key);
  };

  it("pemegang receivables:manage saja melihat baris lewat janji bayar", () => {
    expect(seperti(["dashboard:view", "receivables:manage"])).toContain("overduePromises");
  });

  it("tanpa izin piutang datanya tidak dimuat, jadi barisnya tidak ada", () => {
    expect(seperti(["dashboard:view", "purchase_orders:view"])).toEqual(["overduePOs"]);
  });

  it("barisnya tidak membawa satu kode izin yang tidak bisa menyatakan view ATAU manage", () => {
    expect(buildActionItems(masukan).find((i) => i.key === "overduePromises")?.permission).toBeNull();
  });
});
