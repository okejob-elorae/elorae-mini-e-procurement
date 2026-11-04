import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, type ToastT } from "sonner";
import { idPerluDilepas, idPulau, pesanDariToast, teksDariNode, teruskanToast, type ToastMirip } from "./jembatan-toast";
import { ambilKeadaan, tutupButir, _aturUlangPulau } from "./pulau";
import { DURASI, tampilan } from "./keadaan";

const utama = () => tampilan(ambilKeadaan())?.utama ?? null;

/** Riwayat sonner yang sesungguhnya — bentuk data yang dikirim `useSonner`. */
function riwayat(): ToastMirip[] {
  return toast.getHistory().filter((t): t is ToastT => !("dismiss" in t && t.dismiss === true));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
  _aturUlangPulau();
});

afterEach(() => {
  _aturUlangPulau();
  vi.useRealTimers();
});

describe("teksDariNode", () => {
  it("membaca teks dari string, angka, fungsi, larik, dan elemen React", () => {
    expect(teksDariNode("Tersimpan")).toBe("Tersimpan");
    expect(teksDariNode(12)).toBe("12");
    expect(teksDariNode(() => "dari fungsi")).toBe("dari fungsi");
    expect(teksDariNode(["a", " ", "b"])).toBe("a b");
    expect(teksDariNode({ props: { children: ["PO ", { props: { children: "PO/001" } }, " disimpan"] } })).toBe(
      "PO PO/001 disimpan",
    );
    expect(teksDariNode(null)).toBe("");
    expect(teksDariNode(undefined)).toBe("");
    expect(teksDariNode(false)).toBe("");
  });
});

describe("pesanDariToast", () => {
  it("memetakan jenis sonner ke jenis pulau", () => {
    const jenis = (type: ToastMirip["type"]) => pesanDariToast({ id: 1, type, title: "x" })?.jenis;
    expect(jenis("success")).toBe("sukses");
    expect(jenis("error")).toBe("galat");
    expect(jenis("warning")).toBe("peringatan");
    expect(jenis("info")).toBe("info");
    expect(jenis("loading")).toBe("memuat");
    expect(jenis("normal")).toBe("biasa");
    expect(jenis("default")).toBe("biasa");
    expect(jenis(undefined)).toBe("biasa");
  });

  it("membawa id, keterangan, dan durasi", () => {
    expect(pesanDariToast({ id: 7, type: "error", title: "Gagal", description: "Coba lagi", duration: 12000 })).toEqual({
      id: idPulau(7),
      jenis: "galat",
      teks: "Gagal",
      keterangan: "Coba lagi",
      durasiMs: 12000,
    });
    expect(pesanDariToast({ id: "a", title: "x", duration: Infinity })?.durasiMs).toBeNull();
    expect(pesanDariToast({ id: "a", title: "x" })).not.toHaveProperty("durasiMs");
  });

  it("tombol aksi diteruskan dan menerima peristiwa kliknya", () => {
    const onClick = vi.fn();
    const m = pesanDariToast({ id: 1, type: "success", title: "Diganti", action: { label: "Urungkan", onClick } });
    expect(m?.aksi?.label).toBe("Urungkan");
    m?.aksi?.jalankan("klik");
    expect(onClick).toHaveBeenCalledWith("klik");
  });

  it("aksi berupa elemen bebas (bukan {label, onClick}) diabaikan", () => {
    expect(pesanDariToast({ id: 1, title: "x", action: { props: {} } })?.aksi).toBeUndefined();
  });

  it("toast tanpa teks sama sekali (custom JSX) tidak diteruskan", () => {
    expect(pesanDariToast({ id: 1, jsx: { props: {} } })).toBeNull();
    expect(pesanDariToast({ id: 1, title: "" })).toBeNull();
  });
});

describe("teruskanToast — kontrak dengan sonner yang terpasang", () => {
  it("toast.loading lalu toast.success dengan id sama menjadi Menyimpan… → Tersimpan di satu kapsul", () => {
    let dikenal = new Map<string | number, ToastMirip>();
    toast.loading("Menyimpan…", { id: "uji-simpan" });
    dikenal = teruskanToast(dikenal, riwayat().filter((t) => t.id === "uji-simpan"));
    expect(utama()).toMatchObject({ jenis: "memuat", teks: "Menyimpan…" });

    toast.success("Tersimpan", { id: "uji-simpan" });
    teruskanToast(dikenal, riwayat().filter((t) => t.id === "uji-simpan"));
    expect(ambilKeadaan().pesan).toHaveLength(1);
    expect(utama()).toMatchObject({ jenis: "sukses", teks: "Tersimpan" });

    vi.advanceTimersByTime(DURASI.sukses);
    expect(utama()).toBeNull();
  });

  it("toast.error dengan description dan action dari sonner sampai utuh", () => {
    const onClick = vi.fn();
    const id = toast.error("Kode tidak dikenal", {
      description: "Cari dengan nama",
      action: { label: "Cari", onClick },
    });
    teruskanToast(new Map(), riwayat().filter((t) => t.id === id));
    expect(utama()).toMatchObject({ jenis: "galat", teks: "Kode tidak dikenal", keterangan: "Cari dengan nama" });
    utama()?.aksi?.jalankan("klik");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("hanya yang baru atau berubah yang diteruskan; yang hilang dari daftar ditutup", () => {
    const a: ToastMirip = { id: "a", type: "info", title: "A", duration: 60_000 };
    const b: ToastMirip = { id: "b", type: "info", title: "B", duration: 60_000 };
    // useSonner menaruh yang terbaru di depan: `b` lebih baru dari `a`.
    let dikenal = teruskanToast(new Map(), [b, a]);
    expect(ambilKeadaan().pesan.map((p) => p.teks)).toEqual(["A", "B"]);
    expect(utama()?.teks).toBe("B");

    // Objek yang sama tidak dikirim ulang (urutannya tidak berubah).
    dikenal = teruskanToast(dikenal, [b, a]);
    expect(ambilKeadaan().pesan.map((p) => p.teks)).toEqual(["A", "B"]);

    // `a` diperbarui sonner (objek baru, posisinya tetap) → naik menjadi yang terbaru.
    const a2 = { ...a, title: "A2" };
    dikenal = teruskanToast(dikenal, [b, a2]);
    expect(utama()?.teks).toBe("A2");

    // `b` di-dismiss → hilang dari daftar useSonner → ditutup di pulau.
    dikenal = teruskanToast(dikenal, [a2]);
    expect(ambilKeadaan().pesan.map((p) => p.teks)).toEqual(["A2"]);
    expect(dikenal.has("b")).toBe(false);
  });

  it("pembaruan toast yang kehilangan teksnya menutup pesan lamanya", () => {
    const dikenal = teruskanToast(new Map(), [{ id: "x", title: "ada", duration: 60_000 }]);
    teruskanToast(dikenal, [{ id: "x", jsx: { props: {} } }]);
    expect(ambilKeadaan().pesan).toHaveLength(0);
  });
});

describe("idPerluDilepas — toast yang pesannya sudah hilang dari pulau di-dismiss di sonner", () => {
  it("yang habis waktunya atau diketuk dilepas; yang masih tampil dan yang sudah dilepas tidak", () => {
    const dikenal = teruskanToast(new Map(), [
      { id: "lama", type: "success", title: "Lama" },
      { id: "tetap", type: "info", title: "Tetap", duration: 60_000 },
      { id: "diketuk", type: "error", title: "Diketuk" },
    ]);
    expect(idPerluDilepas(dikenal.keys(), ambilKeadaan().pesan, new Set())).toEqual([]);

    vi.advanceTimersByTime(DURASI.sukses); // "Lama" habis waktunya.
    const galat = tampilan(ambilKeadaan())?.utama;
    expect(galat?.teks).toBe("Diketuk");
    tutupButir(galat!); // "Diketuk" ditutup lewat ketukan.
    expect(idPerluDilepas(dikenal.keys(), ambilKeadaan().pesan, new Set()).sort()).toEqual(["diketuk", "lama"]);
    // Yang sudah dilepas tidak di-dismiss dua kali.
    expect(idPerluDilepas(dikenal.keys(), ambilKeadaan().pesan, new Set(["lama"]))).toEqual(["diketuk"]);
  });
});
