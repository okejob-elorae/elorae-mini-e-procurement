"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getItemAvgCosts } from "@/app/actions/inventory";
import { perkiraanNilaiRetur, pisahTautanBukti, type BarisPerkiraan } from "./perkiraan-nilai";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;

/**
 * Perkiraan nilai retur, dihitung ulang setiap barang/qty berubah. Harga rata-rata
 * dibaca dari server (butuh izin inventori); tanpa izin hanya keterangannya yang tampil.
 */
export function PerkiraanNilaiRetur({ baris }: { baris: BarisPerkiraan[] }) {
  const t = useTranslations("vendorReturn.form");
  const [harga, setHarga] = useState<Record<string, number> | null>(null);
  const [memuat, setMemuat] = useState(false);
  const idBarang = useMemo(
    () => [...new Set(baris.filter((b) => b.type !== "FG_REJECT" && b.itemId).map((b) => b.itemId))].sort(),
    [baris],
  );
  const kunci = idBarang.join("|");

  useEffect(() => {
    if (!kunci) return;
    let batal = false;
    const id = window.setTimeout(() => {
      setMemuat(true);
      getItemAvgCosts(kunci.split("|"))
        .then((h) => {
          if (!batal) setHarga(h);
        })
        .catch(() => {
          if (!batal) setHarga(null);
        })
        .finally(() => {
          if (!batal) setMemuat(false);
        });
    }, 300);
    return () => {
      batal = true;
      window.clearTimeout(id);
    };
  }, [kunci]);

  const hasil = harga ? perkiraanNilaiRetur(baris, harga) : null;
  return (
    <div className="mt-2 space-y-1 text-sm">
      {kunci && memuat && !hasil ? (
        <p className="text-muted-foreground">{t("perkiraanMemuat")}</p>
      ) : hasil && kunci ? (
        <p className="font-medium tabular-nums">{t("perkiraanNilai", { nilai: rp(hasil.nilai) })}</p>
      ) : null}
      <p className="text-muted-foreground">{t("perkiraanNilaiKet")}</p>
    </div>
  );
}

/**
 * Bukti retur: unggah foto/berkas (dulu hanya kolom URL yang harus diketik),
 * dengan kolom tautan tetap ada untuk bukti yang sudah ada di tempat lain.
 */
export function BuktiRetur({ teks, onTeksChange }: { teks: string; onTeksChange: (teks: string) => void }) {
  const t = useTranslations("vendorReturn.form");
  const inputRef = useRef<HTMLInputElement>(null);
  const [mengunggah, setMengunggah] = useState(false);
  const [galat, setGalat] = useState(false);
  const [terunggah, setTerunggah] = useState(0);

  const unggah = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setMengunggah(true);
    setGalat(false);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/upload/grn-photo", { method: "POST", body: fd });
      if (!res.ok) throw new Error("UNGGAH_GAGAL");
      const data = (await res.json()) as { urls?: string[] };
      const urls = (data.urls ?? []).filter(Boolean);
      if (urls.length === 0) throw new Error("UNGGAH_GAGAL");
      onTeksChange([...pisahTautanBukti(teks), ...urls].join("\n"));
      setTerunggah((n) => n + urls.length);
    } catch {
      setGalat(true);
    } finally {
      setMengunggah(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="bukti-retur-berkas">{t("buktiOpsional")}</Label>
      <input
        ref={inputRef}
        id="bukti-retur-berkas"
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={unggah}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={mengunggah}>
          {mengunggah ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
          {mengunggah ? t("mengunggah") : t("unggahBukti")}
        </Button>
        {terunggah > 0 && <span className="text-sm text-muted-foreground">{t("buktiTerunggah", { count: terunggah })}</span>}
      </div>
      {galat && (
        <p className="text-sm text-destructive" role="alert">
          {t("unggahGagal")}
        </p>
      )}
      <Label htmlFor="bukti-retur-tautan" className="text-sm font-normal text-muted-foreground">
        {t("tautanBukti")}
      </Label>
      <Textarea
        id="bukti-retur-tautan"
        value={teks}
        onChange={(e) => onTeksChange(e.target.value)}
        placeholder={t("evidencePlaceholder")}
        rows={3}
      />
    </div>
  );
}
