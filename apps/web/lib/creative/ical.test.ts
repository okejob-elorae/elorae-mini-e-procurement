import { describe, expect, it } from "vitest";
import { bangunIcs, escapeTeksIcs, hariBerikutIcs, lipatBarisIcs, tanggalIcs, waktuUtcIcs, type AcaraIcs } from "./ical";

const KAL = { nama: "Elorae · Kreatif", zonaWaktu: "Asia/Jakarta", segarkan: "PT1H", prodId: "-//Elorae//Kreatif//ID" };
const STAMP = new Date("2026-10-10T03:04:05.678Z");
const oktet = (s: string) => new TextEncoder().encode(s).length;

describe("escapeTeksIcs", () => {
  it("meloloskan garis miring terbalik lebih dulu, lalu koma, titik koma, dan baris baru", () => {
    expect(escapeTeksIcs("a\\b")).toBe("a\\\\b");
    expect(escapeTeksIcs("satu, dua; tiga")).toBe("satu\\, dua\\; tiga");
    expect(escapeTeksIcs("baris1\nbaris2\r\nbaris3\rbaris4")).toBe("baris1\\nbaris2\\nbaris3\\nbaris4");
    expect(escapeTeksIcs("\\,")).toBe("\\\\\\,");
  });

  it("membuang karakter kendali selain tab", () => {
    expect(escapeTeksIcs("a\u0000b\u0007c\td\u007f")).toBe("abc\td");
  });
});

describe("lipatBarisIcs", () => {
  it("baris sampai 75 oktet tidak dilipat", () => {
    const b = "X".repeat(75);
    expect(lipatBarisIcs(b)).toBe(b);
  });

  it("baris panjang dilipat per 75 oktet; lanjutan diawali satu spasi yang ikut dihitung", () => {
    const b = "Y".repeat(200);
    const hasil = lipatBarisIcs(b);
    const potong = hasil.split("\r\n");
    expect(potong[0]).toHaveLength(75);
    for (const p of potong.slice(1)) {
      expect(p.startsWith(" ")).toBe(true);
      expect(oktet(p)).toBeLessThanOrEqual(75);
    }
    expect(potong.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(b);
  });

  it("tidak pernah memotong di tengah karakter UTF-8 berbyte banyak", () => {
    const b = `SUMMARY:${"é".repeat(60)}${"😀".repeat(20)}`;
    const hasil = lipatBarisIcs(b);
    const potong = hasil.split("\r\n");
    for (const p of potong) {
      expect(oktet(p)).toBeLessThanOrEqual(75);
      // Setiap potongan sendiri adalah UTF-8 yang utuh (tanpa karakter pengganti).
      expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(p))).toBe(p);
      expect(p).not.toContain("�");
    }
    expect(potong.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(b);
  });
});

describe("format tanggal", () => {
  it("tanggal sepanjang hari tanpa tanda hubung; waktu dalam UTC dengan Z", () => {
    expect(tanggalIcs("2026-10-09")).toBe("20261009");
    expect(waktuUtcIcs(new Date("2026-10-09T02:30:00.999Z"))).toBe("20261009T023000Z");
  });

  it("hari berikut melewati akhir bulan dan tahun", () => {
    expect(hariBerikutIcs("2026-10-31")).toBe("2026-11-01");
    expect(hariBerikutIcs("2026-12-31")).toBe("2027-01-01");
    expect(hariBerikutIcs("2028-02-28")).toBe("2028-02-29");
  });
});

describe("bangunIcs", () => {
  const sepanjangHari: AcaraIcs = {
    uid: "tenggat-abc@elorae-kreatif",
    ringkasan: "⚠ Kirim sampel · @nadia, dll",
    keterangan: "BRIEF/2026/0001\nBuka di Elorae: https://elorae.cloud/backoffice/kreatif/kolaborasi/abc",
    url: "https://elorae.cloud/backoffice/kreatif/kolaborasi/abc",
    mulai: { tanggal: "2026-10-12" },
  };
  const berjam: AcaraIcs = {
    uid: "agenda-x1@elorae-kreatif",
    ringkasan: "Call; brief",
    mulai: { waktu: new Date("2026-10-12T03:00:00.000Z") },
    selesai: { waktu: new Date("2026-10-12T04:00:00.000Z") },
  };

  it("kepala kalender, akhiran CRLF di setiap baris, dan tidak ada LF telanjang", () => {
    const ics = bangunIcs(KAL, [sepanjangHari], STAMP);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const baris = ics.split("\r\n");
    expect(baris).toContain("X-WR-CALNAME:Elorae · Kreatif");
    expect(baris).toContain("X-WR-TIMEZONE:Asia/Jakarta");
    expect(baris).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(baris).toContain("X-PUBLISHED-TTL:PT1H");
    expect(baris).toContain("PRODID:-//Elorae//Kreatif//ID");
    expect(baris).toContain("CALSCALE:GREGORIAN");
    expect(baris).toContain("METHOD:PUBLISH");
  });

  it("acara sepanjang hari memakai VALUE=DATE dengan DTEND hari berikutnya", () => {
    const baris = bangunIcs(KAL, [sepanjangHari], STAMP).split("\r\n");
    expect(baris).toContain("DTSTART;VALUE=DATE:20261012");
    expect(baris).toContain("DTEND;VALUE=DATE:20261013");
    expect(baris).toContain("DTSTAMP:20261010T030405Z");
    expect(baris).toContain("UID:tenggat-abc@elorae-kreatif");
    expect(baris).toContain("SUMMARY:⚠ Kirim sampel · @nadia\\, dll");
    expect(baris).toContain("URL:https://elorae.cloud/backoffice/kreatif/kolaborasi/abc");
  });

  it("acara berjam memakai waktu UTC Z; tanpa selesai = satu jam", () => {
    const baris = bangunIcs(KAL, [berjam, { ...berjam, uid: "agenda-x2@elorae-kreatif", selesai: undefined }], STAMP).split("\r\n");
    expect(baris).toContain("DTSTART:20261012T030000Z");
    expect(baris).toContain("DTEND:20261012T040000Z");
    expect(baris).toContain("SUMMARY:Call\\; brief");
    expect(baris.filter((b) => b === "DTEND:20261012T040000Z")).toHaveLength(2);
  });

  it("keterangan panjang dilolos lalu dilipat, dan terbaca utuh sesudah dibuka lipatannya", () => {
    const panjang = `Buka di Elorae: https://elorae.cloud/backoffice/kreatif/kolaborasi/${"z".repeat(120)}`;
    const ics = bangunIcs(KAL, [{ ...sepanjangHari, keterangan: panjang }], STAMP);
    for (const b of ics.split("\r\n")) expect(oktet(b)).toBeLessThanOrEqual(75);
    const dibuka = ics.replace(/\r\n /g, "");
    expect(dibuka).toContain(`DESCRIPTION:${panjang}`);
  });

  it("urutan acara tetap: menurut mulai lalu UID", () => {
    const a = { ...sepanjangHari, uid: "b@x", mulai: { tanggal: "2026-10-12" } };
    const b = { ...sepanjangHari, uid: "a@x", mulai: { tanggal: "2026-10-12" } };
    const c = { ...sepanjangHari, uid: "c@x", mulai: { tanggal: "2026-10-11" } };
    const uid = bangunIcs(KAL, [a, b, c], STAMP)
      .split("\r\n")
      .filter((x) => x.startsWith("UID:"));
    expect(uid).toEqual(["UID:c@x", "UID:a@x", "UID:b@x"]);
  });

  it("kalender tanpa acara tetap sah", () => {
    const ics = bangunIcs(KAL, [], STAMP);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
