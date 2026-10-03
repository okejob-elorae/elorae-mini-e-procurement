"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search, UserPlus, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cariPelangganSpgAction, type PelangganCari } from "@/app/actions/spg-pelanggan-cari";
import type { PembeliKeranjang } from "./keranjang";

/** Jeda ketik sebelum mencari — satu panggilan per jeda, bukan per huruf. */
const JEDA_CARI_MS = 300;

/** "62812…" (bentuk tersimpan) → "0812…" untuk dibaca orang. */
export function tampilHp(hp: string): string {
  return hp.startsWith("62") ? `0${hp.slice(2)}` : hp;
}

type Cari = { keadaan: "memuat" } | { keadaan: "gagal" } | { keadaan: "ada"; hasil: PelangganCari[] };

/**
 * Pembeli pada nota (opsional): pilih pelanggan toko ini dari pencarian, atau
 * catat pembeli baru. Pembeli baru WAJIB setuju dihubungi lewat WhatsApp —
 * tanpa centang itu nota tidak bisa disimpan (persetujuan, UU PDP).
 *
 * Pencarian butuh sinyal; tanpa sinyal layar mengatakannya, dan pembeli baru
 * tetap bisa dicatat (ikut terkirim bersama notanya).
 */
export function IsianPembeli({
  pembeli,
  onUbah,
  online,
  disabled,
}: {
  pembeli: PembeliKeranjang | null;
  onUbah: (p: PembeliKeranjang | null) => void;
  online: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("pwa.spgJual.pembeli");
  const [mencari, setMencari] = useState(false);
  const [q, setQ] = useState("");
  const [cari, setCari] = useState<Cari | null>(null);
  const jeda = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Jawaban yang datang terlambat (ketikan lama) tidak menimpa hasil ketikan terbaru.
  const urutan = useRef(0);

  useEffect(
    () => () => {
      if (jeda.current) clearTimeout(jeda.current);
    },
    [],
  );

  function jalankanCari(teks: string) {
    const ke = ++urutan.current;
    setCari({ keadaan: "memuat" });
    cariPelangganSpgAction(teks)
      .then((res) => {
        if (ke !== urutan.current) return;
        setCari(res.ok ? { keadaan: "ada", hasil: res.hasil } : { keadaan: "gagal" });
      })
      .catch(() => {
        if (ke === urutan.current) setCari({ keadaan: "gagal" });
      });
  }

  function mulaiCari() {
    setMencari(true);
    setQ("");
    // Tanpa kata kunci: pelanggan toko yang terakhir berbelanja.
    if (online) jalankanCari("");
  }

  function ketik(teks: string) {
    setQ(teks);
    if (jeda.current) clearTimeout(jeda.current);
    if (!online) return;
    jeda.current = setTimeout(() => jalankanCari(teks), JEDA_CARI_MS);
  }

  function tutupCari() {
    if (jeda.current) clearTimeout(jeda.current);
    urutan.current += 1;
    setMencari(false);
    setCari(null);
    setQ("");
  }

  if (pembeli?.jenis === "ada") {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <UserRound className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{pembeli.nama}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{tampilHp(pembeli.hp)}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onUbah(null)}>
          {t("change")}
        </Button>
      </div>
    );
  }

  if (pembeli?.jenis === "baru") {
    const ubah = (bagian: Partial<Extract<PembeliKeranjang, { jenis: "baru" }>>) => onUbah({ ...pembeli, ...bagian });
    return (
      <section className="space-y-3 rounded-lg border p-3" aria-labelledby="spg-pembeli-baru">
        <div className="flex items-center justify-between gap-2">
          <h3 id="spg-pembeli-baru" className="text-sm font-semibold">
            {t("newTitle")}
          </h3>
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onUbah(null)}>
            <X className="h-4 w-4" aria-hidden />
            {t("cancel")}
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="spg-pembeli-nama">{t("name")}</Label>
          <Input
            id="spg-pembeli-nama"
            autoComplete="off"
            maxLength={100}
            value={pembeli.nama}
            disabled={disabled}
            onChange={(e) => ubah({ nama: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="spg-pembeli-hp">{t("phone")}</Label>
          <Input
            id="spg-pembeli-hp"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={30}
            value={pembeli.hp}
            disabled={disabled}
            placeholder="0812…"
            onChange={(e) => ubah({ hp: e.target.value })}
          />
        </div>
        <label htmlFor="spg-pembeli-setuju" className="flex items-start gap-3 text-sm">
          <Checkbox
            id="spg-pembeli-setuju"
            className="mt-0.5"
            checked={pembeli.setuju}
            disabled={disabled}
            onCheckedChange={(v) => ubah({ setuju: v === true })}
          />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("consent")}</span>
            <span className="block text-xs text-muted-foreground">{t("consentHint")}</span>
          </span>
        </label>
      </section>
    );
  }

  if (mencari) {
    return (
      <section className="space-y-2 rounded-lg border p-3" aria-labelledby="spg-pembeli-cari">
        <div className="flex items-center justify-between gap-2">
          <h3 id="spg-pembeli-cari" className="text-sm font-semibold">
            {t("searchTitle")}
          </h3>
          <Button type="button" variant="ghost" size="sm" onClick={tutupCari}>
            <X className="h-4 w-4" aria-hidden />
            {t("cancel")}
          </Button>
        </div>
        {online ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                autoComplete="off"
                enterKeyHint="search"
                className="pl-9"
                aria-label={t("searchPlaceholder")}
                placeholder={t("searchPlaceholder")}
                value={q}
                onChange={(e) => ketik(e.target.value)}
              />
            </div>
            {cari?.keadaan === "memuat" ? (
              <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("searching")}
              </p>
            ) : cari?.keadaan === "gagal" ? (
              <p className="py-2 text-sm text-destructive">{t("searchFailed")}</p>
            ) : cari?.keadaan === "ada" && cari.hasil.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{q.trim() ? t("noMatch") : t("noCustomers")}</p>
            ) : cari?.keadaan === "ada" ? (
              <ul className="divide-y rounded-md border">
                {cari.hasil.map((c) => (
                  <li key={c.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-11 w-full justify-start rounded-none px-3 py-2 text-left"
                      onClick={() => {
                        tutupCari();
                        onUbah({ jenis: "ada", id: c.id, nama: c.name, hp: c.phone });
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">{tampilHp(c.phone)}</span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("searchOffline")}</p>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            tutupCari();
            onUbah({ jenis: "baru", nama: q.trim() && !/\d/.test(q) ? q.trim() : "", hp: /^\+?[\d\s-]+$/.test(q.trim()) ? q.trim() : "", setuju: false });
          }}
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          {t("newButton")}
        </Button>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal py-2" disabled={disabled} onClick={mulaiCari}>
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        {t("searchButton")}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-11 whitespace-normal py-2"
        disabled={disabled}
        onClick={() => onUbah({ jenis: "baru", nama: "", hp: "", setuju: false })}
      >
        <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
        {t("newButton")}
      </Button>
    </div>
  );
}
