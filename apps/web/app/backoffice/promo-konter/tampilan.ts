import type { StatusTone } from "@/components/ui/status-pill";
import type { StatusPromoKonter } from "@/lib/spg/promo-konter-kantor";

/** Warna status promo: hanya yang berlaku yang hijau. */
export const NADA_STATUS_PROMO: Record<StatusPromoKonter, StatusTone> = {
  BERLAKU: "settled",
  TERJADWAL: "progress",
  BERAKHIR: "inactive",
  NONAKTIF: "inactive",
};

const persen = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

/** Angka persen gaya Indonesia: "33,33". */
export const formatPersen = (v: number) => persen.format(v);
