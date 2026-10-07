// Penolong murni: warna hitam & putih katalog Pantone (aman untuk klien).
//
// Tag rona bawaan katalog (`filterTags.hue`, packages/db/src/pantone/classify.ts)
// hampir tidak pernah memberi "Black"/"White": batasnya L* ≤ 12 dan L* ≥ 90
// dengan saturasi HSL, sedangkan hitam TCX ber-L* 15–21 (Jet Black 18,2).
// Hasilnya cip "Hitam (0)" dan "Putih (3)". Di sini aturannya dibaca dari L*a*b*
// yang tersimpan, dan DIGABUNG dengan tag lama (tidak menggantikannya).

/** Hitam: L* di bawah ini dan a*, b* dalam ±BATAS_KROMA_HITAM. */
export const BATAS_L_HITAM = 22;
export const BATAS_KROMA_HITAM = 12;
/** Putih: L* di atas ini dan a*, b* dalam ±BATAS_KROMA_PUTIH. */
export const BATAS_L_PUTIH = 92;
export const BATAS_KROMA_PUTIH = 8;

type Lab = { labL: number | null; labA: number | null; labB: number | null };

/** "Black" / "White" menurut L*a*b*, atau null. */
export function hueNetralDariLab(lab: Lab): "Black" | "White" | null {
  const { labL: l, labA: a, labB: b } = lab;
  if (l == null || a == null || b == null) return null;
  if (l < BATAS_L_HITAM && Math.abs(a) <= BATAS_KROMA_HITAM && Math.abs(b) <= BATAS_KROMA_HITAM) return "Black";
  if (l > BATAS_L_PUTIH && Math.abs(a) <= BATAS_KROMA_PUTIH && Math.abs(b) <= BATAS_KROMA_PUTIH) return "White";
  return null;
}

/** Tag rona efektif: tag tersimpan ∪ hitam/putih dari L*a*b*. */
export function hueEfektif(tersimpan: string[] | undefined, lab: Lab): string[] {
  const hasil = [...(tersimpan ?? [])];
  const netral = hueNetralDariLab(lab);
  if (netral && !hasil.includes(netral)) hasil.push(netral);
  return hasil;
}

/** Potongan `where` Prisma untuk warna yang aturan L*a*b*-nya hitam/putih. */
export function whereHueNetral(hue: string) {
  if (hue === "Black") {
    return {
      labL: { lt: BATAS_L_HITAM },
      labA: { gte: -BATAS_KROMA_HITAM, lte: BATAS_KROMA_HITAM },
      labB: { gte: -BATAS_KROMA_HITAM, lte: BATAS_KROMA_HITAM },
    };
  }
  if (hue === "White") {
    return {
      labL: { gt: BATAS_L_PUTIH },
      labA: { gte: -BATAS_KROMA_PUTIH, lte: BATAS_KROMA_PUTIH },
      labB: { gte: -BATAS_KROMA_PUTIH, lte: BATAS_KROMA_PUTIH },
    };
  }
  return null;
}
