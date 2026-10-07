import { masukkanKeCampaignAction } from "@/app/actions/kreatif-kolaborasi";

/*
 * Sambungan "Masukkan ke campaign" ke aksi milik layar Kolaborasi
 * (`masukkanKeCampaignAction`): satu-satunya tempat daftar KOL menyentuh aksi
 * itu. KOL yang sudah punya kolaborasi di campaign itu, dan yang diblokir,
 * dilewati oleh aksinya.
 */

export type TahapAwalCampaign = "PROSPEK" | "DIHUBUNGI" | "NEGO" | "DEAL";

export const TAHAP_AWAL_CAMPAIGN: readonly TahapAwalCampaign[] = ["PROSPEK", "DIHUBUNGI", "NEGO", "DEAL"];

export type HasilMasukCampaign =
  | { ok: true; dibuat: number; sudahAda: number; diblokir: number }
  | { ok: false; kode: string };

export type MasukkanKeCampaign = (kolIds: string[], campaignId: string, tahapAwal: TahapAwalCampaign) => Promise<HasilMasukCampaign>;

export const masukkanKeCampaign: MasukkanKeCampaign | null = async (kolIds, campaignId, tahapAwal) => {
  const r = await masukkanKeCampaignAction(kolIds, campaignId, tahapAwal);
  return r.ok ? { ok: true, dibuat: r.dibuat, sudahAda: r.sudahAda, diblokir: r.diblokir } : { ok: false, kode: r.kode };
};
