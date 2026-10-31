"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search, UserPlus, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cariPelangganSpgAction, type PelangganCari } from "@/app/actions/spg-pelanggan-cari";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import { BATAS_NAMA_PELANGGAN, hpLokal, rapikanNamaPelanggan } from "@/lib/spg/pelanggan";

/**
 * Pilih pembeli untuk titip pesan: cari pelanggan toko ini (nama atau nomor),
 * atau catat pembeli baru langsung di formulir. Pembeli baru WAJIB setuju
 * dihubungi lewat WhatsApp; nomor yang ternyata sudah terdaftar ditawarkan
 * untuk dipakai — server pun tidak pernah membuat pelanggan kedua untuknya.
 *
 * Pencarian lewat `cariPelangganSpgAction`: hanya pelanggan toko SPG sendiri.
 */

export type PilihanPelanggan =
  | { jenis: "ada"; id: string; nama: string; hp: string }
  | { jenis: "baru"; nama: string; hp: string; setuju: boolean };

/** Bentuk `pembeli` untuk aksi server, atau null kalau pilihannya belum lengkap. */
export function pembeliDariPilihan(p: PilihanPelanggan | null): { id: string } | { nama: string; hp: string; setuju: boolean } | null {
  if (!p) return null;
  if (p.jenis === "ada") return { id: p.id };
  const nama = rapikanNamaPelanggan(p.nama);
  if (!nama || nama.length > BATAS_NAMA_PELANGGAN || !nomorWhatsApp(p.hp) || !p.setuju) return null;
  return { nama, hp: p.hp, setuju: true };
}

/** Kekurangan pertama pilihan pembeli, untuk `KeteranganKirim`; null kalau sudah lengkap. */
export function kurangPilihan(p: PilihanPelanggan | null): "PILIH" | "NAMA" | "HP" | "SETUJU" | null {
  if (!p) return "PILIH";
  if (p.jenis === "ada") return null;
  if (!rapikanNamaPelanggan(p.nama)) return "NAMA";
  if (!nomorWhatsApp(p.hp)) return "HP";
  if (!p.setuju) return "SETUJU";
  return null;
}

export function PilihPelanggan({
  nilai,
  onChange,
  disabled,
  idAwalan = "pilih-pelanggan",
}: {
  nilai: PilihanPelanggan | null;
  onChange: (p: PilihanPelanggan | null) => void;
  disabled?: boolean;
  idAwalan?: string;
}) {
  const t = useTranslations("spgPelanggan.pilih");
  const [q, setQ] = useState("");
  // Hasil disimpan bersama kata kuncinya; yang tampil hanya hasil untuk kata
  // kunci SEKARANG — jawaban lama yang datang terlambat tidak pernah tampil.
  const [hasilUntuk, setHasilUntuk] = useState<{ q: string; hasil: PelangganCari[] } | null>(null);
  const [terdaftarUntuk, setTerdaftarUntuk] = useState<{ hp: string; p: PelangganCari | null } | null>(null);

  const teks = q.trim();
  const hasil = teks.length >= 2 && hasilUntuk?.q === teks ? hasilUntuk.hasil : [];
  const mencari = teks.length >= 2 && hasilUntuk?.q !== teks;

  // Cari pelanggan toko ini saat SPG mengetik (jeda singkat).
  useEffect(() => {
    if (teks.length < 2) return;
    let batal = false;
    const jeda = setTimeout(async () => {
      let r: PelangganCari[] = [];
      try {
        const jawab = await cariPelangganSpgAction(teks);
        r = jawab.ok ? jawab.hasil : [];
      } catch {
        r = [];
      }
      if (!batal) setHasilUntuk({ q: teks, hasil: r });
    }, 300);
    return () => {
      batal = true;
      clearTimeout(jeda);
    };
  }, [teks]);

  // Pembeli baru: kalau nomornya sudah terdaftar di toko ini, tawarkan pelanggan itu.
  const hpBaru = nilai?.jenis === "baru" ? nomorWhatsApp(nilai.hp) : null;
  const terdaftar = hpBaru && terdaftarUntuk?.hp === hpBaru ? terdaftarUntuk.p : null;
  useEffect(() => {
    if (!hpBaru) return;
    let batal = false;
    const jeda = setTimeout(async () => {
      let p: PelangganCari | null = null;
      try {
        const r = await cariPelangganSpgAction(hpBaru);
        p = r.ok ? (r.hasil.find((x) => x.phone === hpBaru) ?? null) : null;
      } catch {
        p = null;
      }
      if (!batal) setTerdaftarUntuk({ hp: hpBaru, p });
    }, 400);
    return () => {
      batal = true;
      clearTimeout(jeda);
    };
  }, [hpBaru]);

  if (nilai?.jenis === "ada") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 p-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <UserRound className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium leading-tight">{nilai.nama}</span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">{hpLokal(nilai.hp)}</span>
        </span>
        <Button type="button" variant="ghost" onClick={() => onChange(null)} disabled={disabled}>
          <X className="h-4 w-4" aria-hidden />
          {t("ganti")}
        </Button>
      </div>
    );
  }

  if (nilai?.jenis === "baru") {
    const hpSalah = nilai.hp.trim() !== "" && !nomorWhatsApp(nilai.hp);
    return (
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{t("baruJudul")}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} disabled={disabled}>
            {t("batalBaru")}
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idAwalan}-nama`}>{t("nama")}</Label>
          <Input
            id={`${idAwalan}-nama`}
            value={nilai.nama}
            onChange={(e) => onChange({ ...nilai, nama: e.target.value })}
            maxLength={BATAS_NAMA_PELANGGAN}
            autoComplete="off"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idAwalan}-hp`}>{t("hp")}</Label>
          <Input
            id={`${idAwalan}-hp`}
            type="tel"
            inputMode="tel"
            value={nilai.hp}
            onChange={(e) => onChange({ ...nilai, hp: e.target.value })}
            placeholder="0812…"
            autoComplete="off"
            aria-invalid={hpSalah}
            disabled={disabled}
          />
          <p className={hpSalah ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{hpSalah ? t("hpSalah") : t("hpPetunjuk")}</p>
        </div>
        {terdaftar ? (
          <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
            <p>{t("sudahTerdaftar", { nama: terdaftar.name })}</p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => onChange({ jenis: "ada", id: terdaftar.id, nama: terdaftar.name, hp: terdaftar.phone })}
              disabled={disabled}
            >
              {t("pakaiTerdaftar")}
            </Button>
          </div>
        ) : null}
        <label htmlFor={`${idAwalan}-setuju`} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <Checkbox
            id={`${idAwalan}-setuju`}
            checked={nilai.setuju}
            onCheckedChange={(v) => onChange({ ...nilai, setuju: v === true })}
            disabled={disabled}
            className="mt-0.5"
          />
          <span className="min-w-0 space-y-0.5">
            <span className="block text-sm font-medium leading-tight">{t("setuju")}</span>
            <span className="block text-xs text-muted-foreground">{t("setujuPetunjuk")}</span>
          </span>
        </label>
      </div>
    );
  }

  const angka = q.replace(/\D/g, "");
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id={`${idAwalan}-cari`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("cari")}
          aria-label={t("cari")}
          autoComplete="off"
          enterKeyHint="search"
          className="pl-9"
          disabled={disabled}
        />
      </div>
      {mencari ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t("mencari")}
        </p>
      ) : teks.length >= 2 && hasil.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("tidakAda")}</p>
      ) : null}
      {hasil.length > 0 ? (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {hasil.map((p) => (
            <li key={p.id}>
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-12 w-full justify-start rounded-none px-3 py-2 text-left"
                onClick={() => {
                  onChange({ jenis: "ada", id: p.id, nama: p.name, hp: p.phone });
                  setQ("");
                }}
                disabled={disabled}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground tabular-nums">{hpLokal(p.phone)}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() =>
          // Nomor yang sudah diketik di pencarian ikut terisi; nama juga kalau yang diketik nama.
          onChange({ jenis: "baru", nama: angka.length >= 4 ? "" : q.trim(), hp: angka.length >= 4 ? q.trim() : "", setuju: false })
        }
        disabled={disabled}
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        {t("tambahBaru")}
      </Button>
    </div>
  );
}
