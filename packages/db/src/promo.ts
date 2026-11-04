export type PromoType = "PERCENT" | "FIXED" | "TIERED" | "BONUS";
export type PromoLevel = "LINE" | "ORDER";
export type PromoTierInput = { minQty: number; unitPrice: number };
export type PromoInput = {
  id: string;
  type: PromoType;
  level: PromoLevel;
  value: number | null;
  minQty: number | null;
  minOrderSubtotal: number | null;
  minOrderQty: number | null;
  priority: number;
  itemIds: string[];
  tiers: PromoTierInput[];
  /** BONUS saja: setiap kelipatan `bonusBuyQty` yang dibeli memberi `bonusFreeQty` gratis. */
  bonusBuyQty?: number | null;
  bonusFreeQty?: number | null;
  /** BONUS saja: barang hadiah. Kosong = barang yang sama dengan yang dibeli. */
  bonusItemId?: string | null;
  /**
   * Opsional. Pengambil promo dari basis data sudah menyaring jendela tanggal dan
   * toko; kalau kolom ini ikut diisi, `computeBonusLines` menyaringnya lagi sendiri
   * (dipakai tes dan pemanggil yang memegang daftar promo mentah).
   */
  startsAt?: Date | null;
  endsAt?: Date | null;
  allStores?: boolean;
  storeIds?: string[];
};
export type PromoOrderLine = { itemId: string; qty: number; unitPrice: number; avgCost: number };
export type PromoLineResult = { discountAmount: number; appliedPromoId: string | null; belowCost: boolean };
export type PromoOrderResult = { lines: PromoLineResult[]; orderDiscountAmount: number; appliedOrderPromoId: string | null };

// Deterministic pick of the highest-discount candidate; tiebreak higher priority then lexicographically-lower id.
function pickBest<T extends { discount: number; promo: PromoInput }>(cands: T[]): T | null {
  let best: T | null = null;
  for (const c of cands) {
    if (c.discount <= 0) continue;
    if (
      !best ||
      c.discount > best.discount ||
      (c.discount === best.discount && c.promo.priority > best.promo.priority) ||
      (c.discount === best.discount && c.promo.priority === best.promo.priority && c.promo.id < best.promo.id)
    ) {
      best = c;
    }
  }
  return best;
}

function lineDiscount(promo: PromoInput, line: PromoOrderLine): number {
  const lineTotal = line.qty * line.unitPrice;
  if (promo.minQty !== null && line.qty < promo.minQty) return 0;
  if (promo.type === "PERCENT") return promo.value === null ? 0 : (lineTotal * promo.value) / 100;
  if (promo.type === "FIXED") return promo.value === null ? 0 : Math.min(promo.value * line.qty, lineTotal);
  if (promo.type === "TIERED") {
    let tierPrice: number | null = null;
    let bestMin = -1;
    for (const t of promo.tiers) {
      if (line.qty >= t.minQty && t.minQty > bestMin) {
        bestMin = t.minQty;
        tierPrice = t.unitPrice;
      }
    }
    if (tierPrice === null) return 0;
    return Math.max(0, lineTotal - tierPrice * line.qty);
  }
  return 0;
}

export function computeOrderPromos(input: { lines: PromoOrderLine[]; activePromos: PromoInput[] }): PromoOrderResult {
  // Promo BONUS memberi BARANG (lihat computeBonusLines), tidak pernah potongan harga.
  const diskon = input.activePromos.filter((p) => p.type !== "BONUS");
  const linePromos = diskon.filter((p) => p.level === "LINE");
  const orderPromos = diskon.filter((p) => p.level === "ORDER");

  const lines: PromoLineResult[] = input.lines.map((line) => {
    const lineTotal = line.qty * line.unitPrice;
    const cands = linePromos
      .filter((p) => p.itemIds.includes(line.itemId))
      .map((promo) => ({ promo, discount: Math.min(lineDiscount(promo, line), lineTotal) }));
    const best = pickBest(cands);
    const discountAmount = best ? best.discount : 0;
    const netUnit = line.qty > 0 ? (lineTotal - discountAmount) / line.qty : 0;
    return { discountAmount, appliedPromoId: best ? best.promo.id : null, belowCost: line.qty > 0 && netUnit < line.avgCost };
  });

  const subtotal = input.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const lineDiscTotal = lines.reduce((s, l) => s + l.discountAmount, 0);
  const netSubtotal = subtotal - lineDiscTotal;
  const totalQty = input.lines.reduce((s, l) => s + l.qty, 0);

  const orderCands = orderPromos
    .filter((p) => (p.minOrderSubtotal === null || netSubtotal >= p.minOrderSubtotal) && (p.minOrderQty === null || totalQty >= p.minOrderQty))
    .map((promo) => {
      let discount = 0;
      if (promo.type === "PERCENT" && promo.value !== null) discount = (netSubtotal * promo.value) / 100;
      else if (promo.type === "FIXED" && promo.value !== null) discount = Math.min(promo.value, netSubtotal);
      // TIERED is line-level only (backoffice validation enforces level=LINE for TIERED); order-level TIERED yields no discount.
      return { promo, discount: Math.min(discount, netSubtotal) };
    });
  const bestOrder = netSubtotal > 0 ? pickBest(orderCands) : null;

  return {
    lines,
    orderDiscountAmount: bestOrder ? bestOrder.discount : 0,
    appliedOrderPromoId: bestOrder ? bestOrder.promo.id : null,
  };
}

// ── Promo bonus barang ("beli X gratis Y") ─────────────────────────────────

export type BonusOrderLine = { itemId: string; variantSku: string; qty: number };

export type BonusLineResult = {
  promoId: string;
  /** Barang yang diberikan gratis. */
  itemId: string;
  /**
   * Varian barang gratis. `null` = barang hadiah tidak ada di pesanan, jadi
   * variannya tidak bisa diturunkan dari pesanan — pemanggil memilihnya dari stok.
   */
  variantSku: string | null;
  qty: number;
  /** Barang pesanan yang dihitung untuk promo ini (dan tidak lagi ikut promo bonus lain). */
  itemIds: string[];
  /** Jumlah pcs yang dihitung (varian dijumlah per barang). */
  qtyDibeli: number;
};

const bulatPositif = (n: number | null | undefined): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1;

function bonusBerlaku(p: PromoInput, now: Date | undefined, storeId: string | undefined): boolean {
  if (now) {
    if (p.startsAt && p.startsAt.getTime() > now.getTime()) return false;
    if (p.endsAt && p.endsAt.getTime() < now.getTime()) return false;
  }
  if (storeId && p.allStores === false && p.storeIds && !p.storeIds.includes(storeId)) return false;
  return true;
}

/** Varian dengan jumlah pesan terbesar; seri → yang pertama muncul di pesanan. */
function varianTerbanyak(lines: BonusOrderLine[], itemId: string): string | null {
  const qtyPerVarian = new Map<string, number>();
  for (const l of lines) {
    if (l.itemId !== itemId || l.qty <= 0) continue;
    qtyPerVarian.set(l.variantSku, (qtyPerVarian.get(l.variantSku) ?? 0) + l.qty);
  }
  let terpilih: string | null = null;
  let terbesar = 0;
  for (const [varian, qty] of qtyPerVarian) {
    if (qty > terbesar) {
      terpilih = varian;
      terbesar = qty;
    }
  }
  return terpilih;
}

/**
 * Baris gratis dari promo BONUS untuk satu pesanan. Murni — stok TIDAK dilihat di
 * sini; pemanggil membatasi jumlahnya ke stok yang ada.
 *
 * Aturan:
 * - Jumlah dibeli = total pcs barang-barang promo di pesanan, varian dijumlah per
 *   barang (sama dengan aturan minimum pesan). Gratis = floor(dibeli / beli) × gratis.
 * - Satu barang hanya ikut SATU promo bonus. Yang dipilih lebih dulu adalah promo
 *   dengan pcs gratis terbanyak (seri → prioritas lebih tinggi → id lebih kecil),
 *   lalu barangnya "terpakai" dan promo berikutnya dihitung ulang tanpa barang itu.
 * - Hadiahnya `bonusItemId`, atau barang promo yang paling banyak dipesan kalau
 *   kosong. Variannya = varian hadiah yang paling banyak dipesan; `null` kalau
 *   hadiahnya tidak ada di pesanan.
 */
export function computeBonusLines(input: {
  lines: BonusOrderLine[];
  activePromos: PromoInput[];
  now?: Date;
  storeId?: string;
}): BonusLineResult[] {
  const qtyPerBarang = new Map<string, number>();
  const urutanBarang: string[] = [];
  for (const l of input.lines) {
    if (l.qty <= 0) continue;
    if (!qtyPerBarang.has(l.itemId)) urutanBarang.push(l.itemId);
    qtyPerBarang.set(l.itemId, (qtyPerBarang.get(l.itemId) ?? 0) + l.qty);
  }

  const calon = input.activePromos.filter(
    (p) =>
      p.type === "BONUS" &&
      bulatPositif(p.bonusBuyQty) &&
      bulatPositif(p.bonusFreeQty) &&
      bonusBerlaku(p, input.now, input.storeId),
  );

  const terpakai = new Set<string>();
  const dipakai = new Set<string>();
  const hasil: BonusLineResult[] = [];

  for (;;) {
    let terbaik: { promo: PromoInput; itemIds: string[]; dibeli: number; gratis: number } | null = null;
    for (const promo of calon) {
      if (dipakai.has(promo.id)) continue;
      const itemIds = urutanBarang.filter((id) => promo.itemIds.includes(id) && !terpakai.has(id));
      const dibeli = itemIds.reduce((s, id) => s + (qtyPerBarang.get(id) ?? 0), 0);
      const gratis = Math.floor(dibeli / (promo.bonusBuyQty as number)) * (promo.bonusFreeQty as number);
      if (gratis <= 0) continue;
      if (
        !terbaik ||
        gratis > terbaik.gratis ||
        (gratis === terbaik.gratis && promo.priority > terbaik.promo.priority) ||
        (gratis === terbaik.gratis && promo.priority === terbaik.promo.priority && promo.id < terbaik.promo.id)
      ) {
        terbaik = { promo, itemIds, dibeli, gratis };
      }
    }
    if (!terbaik) break;
    dipakai.add(terbaik.promo.id);
    for (const id of terbaik.itemIds) terpakai.add(id);

    let hadiah = terbaik.promo.bonusItemId ?? null;
    if (!hadiah) {
      // Barang promo yang paling banyak dipesan; seri → yang pertama di pesanan.
      let terbesar = 0;
      for (const id of terbaik.itemIds) {
        const qty = qtyPerBarang.get(id) ?? 0;
        if (qty > terbesar) {
          hadiah = id;
          terbesar = qty;
        }
      }
    }
    if (!hadiah) continue;
    hasil.push({
      promoId: terbaik.promo.id,
      itemId: hadiah,
      variantSku: varianTerbanyak(input.lines, hadiah),
      qty: terbaik.gratis,
      itemIds: terbaik.itemIds,
      qtyDibeli: terbaik.dibeli,
    });
  }
  return hasil;
}
