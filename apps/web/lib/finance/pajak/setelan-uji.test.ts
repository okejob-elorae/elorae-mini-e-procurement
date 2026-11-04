import { afterEach, describe, expect, it } from "vitest";
import { PPN_BAWAAN } from "./ppn";
import { PROFIL_PAJAK_BAWAAN } from "./profil";
import { bacaPengaturanPpn } from "./ppn-pengaturan";
import { bacaProfilPajak } from "./profil-pengaturan";

/**
 * Pemilik menyalakan PKP di server lokal (2026-10-08). Basis data itu juga
 * dipakai tes, jadi di bawah vitest pembaca pengaturan pajak TIDAK membaca
 * baris sungguhan kecuali tes memintanya.
 */

const envAsli = process.env.UJI_PENGATURAN_PAJAK;
afterEach(() => {
  if (envAsli === undefined) delete process.env.UJI_PENGATURAN_PAJAK;
  else process.env.UJI_PENGATURAN_PAJAK = envAsli;
});

function klienBerisi(nilai: Record<string, unknown>) {
  const dibaca: string[] = [];
  return {
    dibaca,
    systemSetting: {
      findUnique: (async ({ where }: { where: { key: string } }) => {
        dibaca.push(where.key);
        return { value: JSON.stringify(nilai[where.key]) };
      }) as never,
    },
  };
}

const PKP = { statusPkp: "PKP", tarifPersen: 12, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true, berlakuSejak: "2026-02-18" };
const PT = { bentukUsaha: "PT", rezimPph: "NORMAL", sejak: null };

describe("pengaturan pajak di bawah vitest", () => {
  it("tanpa permintaan: bawaan, dan basis data tidak disentuh sama sekali", async () => {
    delete process.env.UJI_PENGATURAN_PAJAK;
    const klien = klienBerisi({ "pajak.ppn": PKP, "pajak.profil": PT });
    expect(await bacaPengaturanPpn(klien)).toEqual(PPN_BAWAAN);
    expect(await bacaProfilPajak(klien)).toEqual(PROFIL_PAJAK_BAWAAN);
    expect(klien.dibaca).toEqual([]);
  });

  it("dengan UJI_PENGATURAN_PAJAK=setelan: membaca pengaturan dari klien", async () => {
    process.env.UJI_PENGATURAN_PAJAK = "setelan";
    const klien = klienBerisi({ "pajak.ppn": PKP, "pajak.profil": PT });
    expect(await bacaPengaturanPpn(klien)).toEqual(PKP);
    expect(await bacaProfilPajak(klien)).toEqual(PT);
    expect(klien.dibaca).toEqual(["pajak.ppn", "pajak.profil"]);
  });
});
