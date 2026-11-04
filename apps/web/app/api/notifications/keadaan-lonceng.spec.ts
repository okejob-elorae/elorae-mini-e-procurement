import { describe, expect, it } from "vitest";
import {
  dariHalamanPertama,
  tandaiSatuDibaca,
  tandaiSemuaDibaca,
  tempelHalaman,
  type ItemLonceng,
  type KeadaanLonceng,
} from "@/components/notifications/keadaan-lonceng";

/*
 * Keadaan daftar lonceng di peramban (`NotificationIcon`). Pasangan route-nya:
 * halaman 50 + `nextCursor`, `unreadCount` = semua yang belum dibaca.
 */

const WAKTU = "2026-10-06T09:00:00.000Z";

function item(n: number, dibaca = false): ItemLonceng {
  return {
    id: `n${n}`,
    type: "PO_CREATED",
    title: `Judul ${n}`,
    body: "isi",
    data: { poId: `po-${n}` },
    readAt: dibaca ? "2026-10-05T01:00:00.000Z" : null,
    createdAt: new Date(Date.UTC(2026, 9, 6) - n * 1000).toISOString(),
  };
}

const rentang = (a: number, b: number, dibaca = false) =>
  Array.from({ length: b - a + 1 }, (_, i) => item(a + i, dibaca));

describe("halaman pertama", () => {
  it("membawa kursor dari server; server lama tanpa nextCursor = tidak ada lanjutan", () => {
    expect(dariHalamanPertama({ items: rentang(1, 50), unreadCount: 70, nextCursor: "k50" }).nextCursor).toBe("k50");
    expect(dariHalamanPertama({ items: rentang(1, 3), unreadCount: 3 }).nextCursor).toBeNull();
  });
});

describe("tempelHalaman — Muat lebih", () => {
  const awal: KeadaanLonceng = { items: rentang(1, 50), unreadCount: 120, nextCursor: "k50" };

  it("baris ke-51 dan seterusnya ditambahkan di bawah, kursor dan lencana dari jawaban terbaru", () => {
    const hasil = tempelHalaman(awal, { items: rentang(51, 100), unreadCount: 121, nextCursor: "k100" });
    expect(hasil.items).toHaveLength(100);
    expect(hasil.items[50].id).toBe("n51");
    expect(hasil.items[99].id).toBe("n100");
    expect(hasil.nextCursor).toBe("k100");
    expect(hasil.unreadCount).toBe(121);
  });

  it("baris yang sudah ada tidak digandakan", () => {
    const hasil = tempelHalaman(awal, { items: rentang(49, 60), unreadCount: 120, nextCursor: null });
    expect(hasil.items.map((i) => i.id)).toEqual(rentang(1, 60).map((i) => i.id));
    expect(hasil.nextCursor).toBeNull();
  });

  it("tidak mengubah keadaan lama", () => {
    tempelHalaman(awal, { items: rentang(51, 52), unreadCount: 1, nextCursor: null });
    expect(awal.items).toHaveLength(50);
    expect(awal.nextCursor).toBe("k50");
  });
});

describe("tandaiSatuDibaca", () => {
  it("yang belum dibaca: ditandai dan lencana turun satu", () => {
    const hasil = tandaiSatuDibaca({ items: rentang(1, 3), unreadCount: 80, nextCursor: "k" }, "n2", WAKTU);
    expect(hasil.items[1].readAt).toBe(WAKTU);
    expect(hasil.items[0].readAt).toBeNull();
    expect(hasil.unreadCount).toBe(79);
    expect(hasil.nextCursor).toBe("k");
  });

  it("yang sudah dibaca: lencana tidak turun lagi, waktunya tidak ditimpa", () => {
    const lama: KeadaanLonceng = { items: [item(1, true), item(2)], unreadCount: 5, nextCursor: null };
    const hasil = tandaiSatuDibaca(lama, "n1", WAKTU);
    expect(hasil.unreadCount).toBe(5);
    expect(hasil.items[0].readAt).toBe("2026-10-05T01:00:00.000Z");
  });

  it("lencana tidak pernah negatif", () => {
    expect(tandaiSatuDibaca({ items: [item(1)], unreadCount: 0, nextCursor: null }, "n1", WAKTU).unreadCount).toBe(0);
  });
});

describe("tandaiSemuaDibaca", () => {
  it("lencana nol walau baru 50 termuat (server menandai semua), kursor tetap untuk memuat sisanya", () => {
    const hasil = tandaiSemuaDibaca({ items: [...rentang(1, 49), item(50, true)], unreadCount: 137, nextCursor: "k50" }, WAKTU);
    expect(hasil.unreadCount).toBe(0);
    expect(hasil.items.every((i) => i.readAt !== null)).toBe(true);
    expect(hasil.items[49].readAt).toBe("2026-10-05T01:00:00.000Z");
    expect(hasil.nextCursor).toBe("k50");
  });
});
