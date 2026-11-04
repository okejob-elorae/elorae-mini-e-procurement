import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Komponen gerak dirender di server (lingkungan node, seperti SSR Next).
 * Yang dijaga di sini adalah keadaan AWAL yang dilihat orang sebelum
 * JavaScript berjalan — geraknya sendiri ada di lib/gerak (murni, teruji)
 * dan globals.css (gerak-statis.test.ts).
 */

vi.mock("next-intl", () => ({ useTranslations: (ruang: string) => (k: string) => `${ruang}.${k}` }));

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

describe("AngkaNaik", () => {
  it("server menampilkan angka AKHIR, bukan nol — tidak berkedip saat dimuat ulang", async () => {
    const { AngkaNaik } = await import("@/components/gerak/AngkaNaik");
    const html = renderToStaticMarkup(createElement(AngkaNaik, { nilai: 12_345_678, format: rupiah }));
    expect(html).toContain("Rp 12.345.678");
    expect(html).not.toContain("Rp 0<");
  });

  it("lebar dicadangkan: salinan angka akhir tak terlihat di sel yang sama", async () => {
    const { AngkaNaik } = await import("@/components/gerak/AngkaNaik");
    const html = renderToStaticMarkup(createElement(AngkaNaik, { nilai: 42, format: String, className: "x" }));
    expect(html).toMatch(/^<span class="inline-grid tabular-nums x">/);
    expect(html).toContain('<span aria-hidden="true" class="invisible col-start-1 row-start-1">42</span>');
    expect(html).toContain('<span class="col-start-1 row-start-1">42</span>');
  });
});

describe("KerangkaDaftar", () => {
  it("satu tanda memuat yang terbaca pembaca layar, kotak-kotaknya disembunyikan", async () => {
    const { KerangkaDaftar } = await import("@/components/gerak/KerangkaDaftar");
    const html = renderToStaticMarkup(createElement(KerangkaDaftar));
    expect(html).toContain('role="status"');
    expect(html).toContain('<span class="sr-only">common.loading</span>');
    expect(html.match(/skeleton-block h-4 w-28/g)?.length).toBe(7);
  });

  it("jumlah baris dan baris saringan bisa diatur", async () => {
    const { KerangkaDaftar } = await import("@/components/gerak/KerangkaDaftar");
    const html = renderToStaticMarkup(createElement(KerangkaDaftar, { baris: 3, saringan: false }));
    expect(html.match(/skeleton-block h-4 w-28/g)?.length).toBe(3);
    expect(html).not.toContain("skeleton-block h-9 w-72");
  });

  it("baris nol atau negatif tetap menggambar satu baris", async () => {
    const { KerangkaDaftar } = await import("@/components/gerak/KerangkaDaftar");
    const html = renderToStaticMarkup(createElement(KerangkaDaftar, { baris: 0 }));
    expect(html.match(/skeleton-block h-4 w-28/g)?.length).toBe(1);
  });
});

describe("TransisiHalaman", () => {
  afterEach(() => {
    vi.doUnmock("react");
    vi.resetModules();
  });

  it("tanpa ViewTransition (React stabil, tes): anaknya dirender apa adanya", async () => {
    vi.resetModules();
    const { TransisiHalaman } = await import("@/components/gerak/TransisiHalaman");
    const html = renderToStaticMarkup(createElement(TransisiHalaman, null, createElement("main", null, "isi")));
    expect(html).toBe("<main>isi</main>");
  });

  it("dengan ViewTransition: hanya MASUK yang dianimasikan — refresh, saringan, dan keluar tidak", async () => {
    vi.resetModules();
    const diterima: Record<string, unknown>[] = [];
    vi.doMock("react", async (asli) => {
      const React = await asli<typeof import("react")>();
      return {
        ...React,
        ViewTransition: (props: Record<string, unknown> & { children?: ReactNode }) => {
          diterima.push(props);
          return React.createElement(React.Fragment, null, props.children);
        },
      };
    });
    const { TransisiHalaman } = await import("@/components/gerak/TransisiHalaman");
    const html = renderToStaticMarkup(createElement(TransisiHalaman, null, createElement("main", null, "isi")));
    expect(html).toBe("<main>isi</main>");
    expect(diterima).toHaveLength(1);
    expect(diterima[0]).toMatchObject({ enter: "auto", exit: "none", update: "none", share: "none", default: "none" });
  });
});

describe("useSorotBaris", () => {
  it("render pertama tidak menyalakan apa pun (sorot hanya muncul sesudah perubahan)", async () => {
    const { useSorotBaris } = await import("@/components/gerak/useSorotBaris");
    function Daftar() {
      const { sorot } = useSorotBaris("uji", [{ id: "a", tanda: "PENDING" }]);
      return createElement("tr", { ...sorot("a"), id: "a" });
    }
    const html = renderToStaticMarkup(createElement("table", null, createElement("tbody", null, createElement(Daftar))));
    expect(html).toContain('<tr id="a"></tr>');
    expect(html).not.toContain("data-sorot");
  });
});
