import { describe, expect, it } from "vitest";
import { engagementRate } from "./angka-konten";
import { hitungErAkun, type PostingPantau } from "./pantau-er";

/*
 * ER akun TikTok (keputusan P2): rata-rata ER per posting atas ≤ 12 posting
 * terakhir yang tidak disematkan dan berumur ≥ 48 jam; ER per posting memakai
 * rumus `engagementRate` (like + komentar + share + save) ÷ views × 100.
 * Views 0 dilewati; kurang dari 3 posting sah → null, bukan 0.
 */

const SEKARANG = new Date("2003-06-10T05:00:00Z");
const detik = (d: Date) => Math.floor(d.getTime() / 1000);
const JAM = 3600;

let urut = 0;
function posting(isi: Partial<PostingPantau> & { umurJam?: number } = {}): PostingPantau {
  const { umurJam = 72, ...sisa } = isi;
  urut += 1;
  return {
    id: `v${urut}`,
    dibuatPada: detik(SEKARANG) - umurJam * JAM,
    disematkan: false,
    views: 1000,
    like: 80,
    komentar: 10,
    share: 5,
    save: 5,
    ...sisa,
  };
}

describe("hitungErAkun", () => {
  it("memakai rumus engagementRate yang sama untuk setiap posting", () => {
    const p = posting({ views: 1234, like: 77, komentar: 9, share: 4, save: 3 });
    const sama = [p, { ...p, id: "b" }, { ...p, id: "c" }];
    const r = hitungErAkun(sama, SEKARANG);
    expect(r.er).toBe(engagementRate({ views: 1234, likes: 77, comments: 9, shares: 4, saves: 3 }));
    expect(r.postsCounted).toBe(3);
    expect(r.avgViews).toBe(1234);
  });

  it("rata-rata ER per posting, bukan total interaksi ÷ total views", () => {
    const r = hitungErAkun(
      [
        posting({ views: 100, like: 10, komentar: 0, share: 0, save: 0 }),
        posting({ views: 1000, like: 10, komentar: 0, share: 0, save: 0 }),
        posting({ views: 100, like: 10, komentar: 0, share: 0, save: 0 }),
      ],
      SEKARANG,
    );
    expect(r.er).toBe(7);
    expect(r.avgViews).toBe(400);
  });

  it("melewati posting yang disematkan, yang berumur < 48 jam, dan yang views-nya 0", () => {
    const sah = [posting(), posting(), posting()];
    const r = hitungErAkun(
      [
        ...sah,
        posting({ disematkan: true, like: 900 }),
        posting({ umurJam: 47, like: 900 }),
        posting({ views: 0, like: 900 }),
      ],
      SEKARANG,
    );
    expect(r.postsCounted).toBe(3);
    expect(r.er).toBe(10);
  });

  it("posting tepat 48 jam ikut dihitung", () => {
    const r = hitungErAkun([posting({ umurJam: 48 }), posting({ umurJam: 48 }), posting({ umurJam: 48 })], SEKARANG);
    expect(r.postsCounted).toBe(3);
  });

  it("hanya 12 posting sah TERBARU yang dihitung", () => {
    const baru = Array.from({ length: 12 }, (_, i) => posting({ umurJam: 50 + i }));
    const lama = Array.from({ length: 5 }, (_, i) => posting({ umurJam: 500 + i, like: 1000 }));
    const r = hitungErAkun([...lama, ...baru], SEKARANG);
    expect(r.postsCounted).toBe(12);
    expect(r.er).toBe(10);
  });

  it("kurang dari 3 posting sah: ER dan rata-rata views null, bukan 0", () => {
    const r = hitungErAkun([posting(), posting(), posting({ disematkan: true })], SEKARANG);
    expect(r).toEqual({ er: null, avgViews: null, postsCounted: 2 });
    expect(hitungErAkun([], SEKARANG)).toEqual({ er: null, avgViews: null, postsCounted: 0 });
  });

  it("posting yang sama (id sama) dihitung sekali", () => {
    const p = posting();
    const r = hitungErAkun([p, p, p, posting(), posting()], SEKARANG);
    expect(r.postsCounted).toBe(3);
  });

  it("video viral di atas batas Int: ER tetap dihitung, rata-rata views dipangkas ke batas kolom Int", () => {
    const r = hitungErAkun(
      [1, 2, 3].map(() => posting({ views: 5_000_000_000, like: 500_000_000, komentar: 0, share: 0, save: 0 })),
      SEKARANG,
    );
    expect(r.er).toBe(10);
    expect(r.avgViews).toBe(2_147_483_647);
  });

  it("ER di atas batas kolom Decimal(6,2) dipangkas, bukan meledakkan penyimpanan", () => {
    const r = hitungErAkun(
      [1, 2, 3].map(() => posting({ views: 1, like: 500_000 })),
      SEKARANG,
    );
    expect(r.er).toBe(9999.99);
  });
});
