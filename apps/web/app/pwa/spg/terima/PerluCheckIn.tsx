"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tautanCheckInLaluKembali } from "@/lib/pwa/kembali-setelah-checkin";

/**
 * Pesan "check-in dulu" untuk pekerjaan yang hanya sah dilakukan DI toko
 * (terima kiriman, opname). Sengaja ditampilkan, bukan redirect diam-diam:
 * SPG yang dilempar kembali ke beranda tanpa penjelasan mengira aplikasinya
 * rusak. Teksnya dari pemanggil, supaya tiap layar memakai namespace-nya sendiri.
 *
 * Tombolnya membawa alamat layar ini (`/pwa?kembali=<layar>`): sesudah
 * check-in di beranda, SPG dikembalikan ke sini, bukan dibiarkan mencari
 * jalannya sendiri. `kembali` dari pemanggil menimpa alamat layar saat ini.
 */
export function PerluCheckIn({ judul, isi, tombol, kembali }: { judul: string; isi: string; tombol: string; kembali?: string }) {
  const path = usePathname();
  return (
    <section className="beranda-kartu space-y-3" role="status">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <MapPin className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight">{judul}</h2>
          <p className="text-sm text-muted-foreground">{isi}</p>
        </div>
      </div>
      <Button asChild className="w-full">
        <Link href={tautanCheckInLaluKembali(kembali ?? path)}>{tombol}</Link>
      </Button>
    </section>
  );
}
