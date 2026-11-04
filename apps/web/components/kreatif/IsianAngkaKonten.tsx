"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { catatAngkaAction } from "@/app/actions/kreatif-konten";
import { bacaBilanganBulat } from "@/lib/creative/angka-masuk";
import { angkaTitik, type AngkaKonten } from "@/lib/creative/angka-konten";
import { KOLOM_ANGKA, type KolomAngka } from "@/lib/creative/konten-kol";
import { cn } from "@/lib/utils";
import { useKabarKonten } from "./kabar-konten";

const KOSONG: Record<KolomAngka, string> = { views: "", likes: "", comments: "", shares: "", saves: "" };

/**
 * Isian angka konten di baris: views, likes, komentar, share, save → Simpan.
 *
 * Setiap simpan menjadi BARIS ANGKA BARU (yang lama tidak pernah ditimpa).
 * Kotak yang dibiarkan kosong memakai angka terakhirnya (tampil sebagai
 * placeholder), jadi orang cukup mengetik yang berubah. Isian pemaaf:
 * "52k", "1,2jt", "88.000" terbaca.
 */
export function IsianAngkaKonten({
  kontenId,
  terakhir,
  berlabel = false,
  className,
}: {
  kontenId: string;
  terakhir: AngkaKonten | null;
  /** Label kecil di atas tiap kotak (panel); di tabel labelnya ada di kepala kolom. */
  berlabel?: boolean;
  className?: string;
}) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const router = useRouter();
  const kabar = useKabarKonten();
  const [isian, setIsian] = useState(KOSONG);
  const [pending, start] = useTransition();
  const semuaKosong = KOLOM_ANGKA.every((k) => !isian[k].trim());

  const simpan = () => {
    if (semuaKosong || pending) return;
    const nilai = {} as Record<KolomAngka, number>;
    for (const k of KOLOM_ANGKA) {
      const s = isian[k].trim();
      if (!s) {
        nilai[k] = terakhir?.[k] ?? 0;
        continue;
      }
      const n = bacaBilanganBulat(s);
      if (n === null) {
        toast.error(t("angka.tidakTerbaca", { kolom: t(`kolom.${k}`) }));
        return;
      }
      nilai[k] = n;
    }
    start(async () => {
      const r = await catatAngkaAction({ kontenId, ...nilai });
      if (r.ok) {
        kabar.sukses("kontenKol.ok.angka", r.maju);
        setIsian(KOSONG);
        router.refresh();
      } else {
        kabar.gagal(r.kode);
      }
    });
  };

  return (
    <div className={cn("flex flex-wrap items-end gap-1.5", className)}>
      {KOLOM_ANGKA.map((k) => (
        <label key={k} className="space-y-0.5">
          {berlabel ? <span className="block text-[11px] text-muted-foreground">{t(`kolom.${k}`)}</span> : null}
          <Input
            value={isian[k]}
            onChange={(e) => setIsian((s) => ({ ...s, [k]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                simpan();
              }
            }}
            inputMode="decimal"
            aria-label={t(`kolom.${k}`)}
            placeholder={terakhir ? angkaTitik(terakhir[k]) : berlabel ? "0" : t(`kolom.${k}`)}
            className="h-8 w-[78px] px-2 text-right text-sm tabular-nums"
            disabled={pending}
          />
        </label>
      ))}
      <Button size="sm" onClick={simpan} disabled={pending || semuaKosong}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {t("angka.simpan")}
      </Button>
    </div>
  );
}
