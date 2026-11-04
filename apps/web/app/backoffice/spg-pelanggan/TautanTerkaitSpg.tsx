"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Tiga layar yang saling terkait: titip pesan pembeli (menunggu barang),
 * barang yang dicari pembeli (tidak ada di rak), dan permintaan kiriman SPG
 * ke salesman/kantor — permintaan pembeli bisa berujung jadi permintaan
 * kiriman. Setiap layar menautkan dua lainnya.
 */
const TAUTAN = [
  { kunci: "titip", href: "/backoffice/spg-pelanggan?tab=titip" },
  { kunci: "dicari", href: "/backoffice/spg-lost-sales" },
  { kunci: "permintaan", href: "/backoffice/spg-requests" },
] as const;

export type HalamanTerkaitSpg = (typeof TAUTAN)[number]["kunci"];

export function TautanTerkaitSpg({ kecuali }: { kecuali: HalamanTerkaitSpg }) {
  const t = useTranslations("spgTerkait");
  return (
    <div className="flex flex-wrap gap-2">
      {TAUTAN.filter((x) => x.kunci !== kecuali).map((x) => (
        <Button key={x.kunci} asChild variant="outline" size="sm">
          <Link href={x.href}>{t(x.kunci)}</Link>
        </Button>
      ))}
    </div>
  );
}
