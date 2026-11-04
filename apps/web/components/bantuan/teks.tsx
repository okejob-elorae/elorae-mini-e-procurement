"use client";

import { useTranslations } from "next-intl";
import { sebagaiDaftar, type EntriBantuan, type Teks } from "@/lib/bantuan/jenis";

/** Mengubah `Teks` daftar Bantuan menjadi kalimat: teks biasa apa adanya, kunci lewat i18n. */
export function useTeksBantuan(): (x: Teks) => string {
  const t = useTranslations();
  return (x) => (typeof x === "string" ? x : t(x.kunci as never));
}

/** Isi satu entri — dipakai panel ⓘ dan halaman Bantuan, supaya keduanya sama. */
export function IsiEntri({ entri, judulKartu }: { entri: Pick<EntriBantuan, "isi" | "kartu">; judulKartu: string }) {
  const teks = useTeksBantuan();
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {sebagaiDaftar(entri.isi).map((p, i) => (
          <p key={i}>{teks(p)}</p>
        ))}
      </div>
      {entri.kartu && entri.kartu.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{judulKartu}</h4>
          <dl className="space-y-3">
            {entri.kartu.map((k, i) => (
              <div key={i} className="space-y-1">
                <dt className="font-medium">{teks(k.judul)}</dt>
                {sebagaiDaftar(k.isi).map((p, j) => (
                  <dd key={j} className="text-muted-foreground">
                    {teks(p)}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
