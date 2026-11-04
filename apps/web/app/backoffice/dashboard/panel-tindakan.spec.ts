import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ActionItem } from "@/lib/dashboard/action-items-shared";

/*
 * Panel "perlu ditindaklanjuti": nilai PO terlambat diberi nama ("nilai PO …"),
 * dan baris yang menunggu orang lain (BKM yang dicatat penonton sendiri) tidak
 * menjadikan judulnya "N hal perlu ditindaklanjuti".
 */

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { permissions: ["*"] } } }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}${JSON.stringify(v)}` : k),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));

const { ActionNeededPanel } = await import("./ActionNeededPanel");

const gambar = (items: ActionItem[]) => renderToStaticMarkup(createElement(ActionNeededPanel, { items }));

const poTerlambat: ActionItem = {
  key: "overduePOs",
  labelKey: "overduePOs",
  count: 3,
  href: "/backoffice/purchase-orders?status=overdue",
  permission: null,
  tone: "overdue",
  amount: 11_450_000,
  amountLabelKey: "amountPoValue",
};
const bkmSendiri: ActionItem = {
  key: "claimsAwaitingOthers",
  labelKey: "claimsAwaitingOthers",
  count: 2,
  href: "/backoffice/pelunasan?status=DIKIRIM",
  permission: null,
  tone: "waiting",
  menungguOrangLain: true,
};

describe("ActionNeededPanel", () => {
  it("nilai PO terlambat disebut 'nilai PO', bukan rupiah tanpa nama", () => {
    const html = gambar([poTerlambat]);
    expect(html).toContain("amountPoValue");
    expect(html).toContain("Rp");
    expect(html).toContain('title{&quot;count&quot;:3}');
  });

  it("hanya baris yang menunggu orang lain: judulnya 'tidak ada yang menunggu', barisnya tetap tampil", () => {
    const html = gambar([bkmSendiri]);
    expect(html).toContain("emptyTitle");
    expect(html).not.toContain("title{");
    expect(html).toContain("claimsAwaitingOthers");
  });

  it("baris menunggu orang lain tidak ikut angka judul", () => {
    const html = gambar([poTerlambat, bkmSendiri]);
    expect(html).toContain('title{&quot;count&quot;:3}');
  });
});
