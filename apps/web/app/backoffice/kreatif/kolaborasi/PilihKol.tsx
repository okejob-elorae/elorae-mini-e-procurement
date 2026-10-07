"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { cariKolAction } from "@/app/actions/kreatif-kolaborasi";
import { angkaTitik } from "@/lib/creative/angka-konten";
import type { HasilCariKol } from "@/lib/creative/kolaborasi-queries";
import { cn } from "@/lib/utils";
import { subKol } from "./bagian";

/** Jeda ketik sebelum mencari (sama dengan KOL Manager). */
const JEDA_MS = 260;

/**
 * Autocomplete KOL: minimal 2 huruf, 12 hasil, nama atau @username. KOL yang
 * diblokir tampil tetapi tidak bisa dipilih (penulis juga menolaknya).
 */
export function PilihKol({
  nilai,
  onPilih,
  invalid,
}: {
  nilai: HasilCariKol | null;
  onPilih: (kol: HasilCariKol | null) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("kreatifRuang.kolaborasi.form");
  const idDaftar = useId();
  const [kata, setKata] = useState("");
  const [hasil, setHasil] = useState<HasilCariKol[] | null>(null);
  const [mencari, setMencari] = useState(false);

  useEffect(() => {
    const q = kata.trim();
    if (q.length < 2) return;
    let batal = false;
    const pewaktu = setTimeout(() => {
      setMencari(true);
      cariKolAction(q)
        .then((r) => {
          if (!batal) setHasil(r.ok ? r.hasil : []);
        })
        .catch(() => {
          if (!batal) setHasil([]);
        })
        .finally(() => {
          if (!batal) setMencari(false);
        });
    }, JEDA_MS);
    return () => {
      batal = true;
      clearTimeout(pewaktu);
    };
  }, [kata]);

  if (nilai) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{nilai.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[subKol(nilai), nilai.followers ? t("pengikut", { n: angkaTitik(nilai.followers) }) : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onPilih(null)}>
          <X className="mr-1 h-3.5 w-3.5" />
          {t("kolGanti")}
        </Button>
      </div>
    );
  }

  const tampil = kata.trim().length >= 2;
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={kata}
          onChange={(e) => {
            setKata(e.target.value);
            if (e.target.value.trim().length < 2) setHasil(null);
          }}
          placeholder={t("kolCari")}
          className="pl-9"
          aria-invalid={invalid}
          aria-controls={idDaftar}
          aria-label={t("kol")}
          autoComplete="off"
        />
        {mencari ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
      </div>
      {tampil && hasil ? (
        <ul id={idDaftar} className="max-h-56 overflow-y-auto rounded-md border">
          {hasil.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t("kolTidakAda")}</li>
          ) : (
            hasil.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  disabled={k.diblokir}
                  onClick={() => {
                    onPilih(k);
                    setKata("");
                    setHasil(null);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    k.diblokir && "cursor-not-allowed opacity-60 hover:bg-transparent",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{k.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[subKol(k), k.followers ? t("pengikut", { n: angkaTitik(k.followers) }) : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {k.diblokir ? <StatusPill tone="attention">{t("kolDiblokir")}</StatusPill> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
