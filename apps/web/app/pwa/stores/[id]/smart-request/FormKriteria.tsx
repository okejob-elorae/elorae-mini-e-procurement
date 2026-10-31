"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";
import type { PackRatioRow } from "@elorae/db/pack-ratio";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { MIN_PCS_LARIS } from "@/lib/salesman/saran-tawar";
import {
  ARTIKEL_BAWAAN,
  HARI_BARU_MAKS,
  MAKS_ANGGARAN,
  MAKS_ARTIKEL,
  MAKS_PCS_ARTIKEL,
  MAKS_SISA_LEWATI,
  PCS_CEPAT,
  SISA_LEWATI_BAWAAN,
  SUMBER_BAWAAN,
  SUMBER_RENCANA,
  type JumlahPerArtikel,
  type KriteriaBangun,
  type KriteriaTersimpan,
  type SumberRencana,
} from "@/lib/field-sales/smart-request/kriteria";
import type { DasarLaku } from "@/lib/field-sales/smart-request/rencana-queries";
import { cn } from "@/lib/utils";

/**
 * Formulir kriteria rencana kirim. Isian awalnya dari `awal` (kriteria
 * terakhir untuk toko ini, dibaca pemanggil dari penyimpanan HP) — dipakai
 * sekali saat dipasang; pemanggil memasang ulang komponen ini (`key`) bila
 * isian tersimpan baru terbaca sesudah hidrasi.
 *
 * Tombol susun menyebut kekurangan PERTAMA menurut urutan isian di layar.
 */

type Kategori = { id: string; name: string };
type PilihanJumlah = "PACK" | `${(typeof PCS_CEPAT)[number]}` | "LAIN";

const angkaSaja = (s: string) => s.replace(/\D/g, "").slice(0, 12);
const bulatDalam = (s: string, min: number, maks: number): number | null => {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= maks ? n : null;
};

function pilihanAwal(jumlah: JumlahPerArtikel | undefined, adaRasio: boolean): { pilihan: PilihanJumlah; pcsLain: string } {
  if (!jumlah) return { pilihan: adaRasio ? "PACK" : "6", pcsLain: "24" };
  if (jumlah.mode === "PACK") return { pilihan: adaRasio ? "PACK" : "6", pcsLain: "24" };
  if ((PCS_CEPAT as readonly number[]).includes(jumlah.pcs)) return { pilihan: String(jumlah.pcs) as PilihanJumlah, pcsLain: "24" };
  return { pilihan: "LAIN", pcsLain: String(jumlah.pcs) };
}

export function FormKriteria({
  konsi,
  categories,
  ratio,
  hariBaruBawaan,
  dasarLaku,
  awal,
  menyusun,
  onSusun,
}: {
  konsi: boolean;
  categories: Kategori[];
  ratio: PackRatioRow[];
  hariBaruBawaan: number;
  dasarLaku: DasarLaku;
  awal: KriteriaTersimpan | null;
  menyusun: boolean;
  onSusun: (kriteria: KriteriaBangun, simpan: KriteriaTersimpan) => void;
}) {
  const t = useTranslations("pwa.rencanaKirim");
  const td = dinamis(t);

  const adaRasio = ratio.length > 0;
  const sisaDiketahui = dasarLaku !== "RIWAYAT_PESANAN";
  const teksRasio = ratio.map((r) => `${r.size} ${r.qty}`).join(" · ");
  const mulaiJumlah = pilihanAwal(awal?.jumlah, adaRasio);

  const [kategoriDipilih, setKategoriDipilih] = useState<Set<string>>(() => new Set(awal?.kategoriIds ?? []));
  const [pilihanJumlah, setPilihanJumlah] = useState<PilihanJumlah>(mulaiJumlah.pilihan);
  const [pcsLain, setPcsLain] = useState(mulaiJumlah.pcsLain);
  const [sumber, setSumber] = useState<Set<SumberRencana>>(() => new Set(awal?.sumber ?? SUMBER_BAWAAN));
  const [hariBaru, setHariBaru] = useState(String(awal?.hariBaru ?? hariBaruBawaan));
  const [maksArtikel, setMaksArtikel] = useState(String(awal?.maksArtikel ?? ARTIKEL_BAWAAN));
  const [lewatiAktif, setLewatiAktif] = useState(awal?.lewatiSisa.aktif ?? true);
  const [lewatiMin, setLewatiMin] = useState(String(awal?.lewatiSisa.min ?? SISA_LEWATI_BAWAAN));
  const [anggaran, setAnggaran] = useState(awal?.anggaran == null ? "" : String(awal.anggaran));

  const jumlah: JumlahPerArtikel | null = (() => {
    if (pilihanJumlah === "PACK") return adaRasio ? { mode: "PACK" } : null;
    if (pilihanJumlah === "LAIN") {
      const n = bulatDalam(pcsLain, 1, MAKS_PCS_ARTIKEL);
      return n === null ? null : { mode: "PCS", pcs: n };
    }
    return { mode: "PCS", pcs: Number(pilihanJumlah) };
  })();
  const hariBaruN = bulatDalam(hariBaru, 1, HARI_BARU_MAKS);
  const maksN = bulatDalam(maksArtikel, 1, MAKS_ARTIKEL);
  const lewatiN = bulatDalam(lewatiMin, 1, MAKS_SISA_LEWATI);
  const anggaranN = anggaran === "" ? null : bulatDalam(anggaran, 1, MAKS_ANGGARAN);

  const kurang: string | null =
    kategoriDipilih.size === 0
      ? t("kurangKategori")
      : jumlah === null
        ? t("kurangPcs", { maks: MAKS_PCS_ARTIKEL })
        : sumber.size === 0
          ? t("kurangSumber")
          : sumber.has("BARANG_BARU") && hariBaruN === null
            ? t("kurangHariBaru", { maks: HARI_BARU_MAKS })
            : maksN === null
              ? t("kurangMaks", { maks: MAKS_ARTIKEL })
              : sisaDiketahui && lewatiAktif && lewatiN === null
                ? t("kurangSisa", { maks: MAKS_SISA_LEWATI })
                : !konsi && anggaran !== "" && anggaranN === null
                  ? t("kurangAnggaran")
                  : null;

  function alihkan<T>(setter: (f: (lama: Set<T>) => Set<T>) => void, nilai: T) {
    setter((lama) => {
      const baru = new Set(lama);
      if (baru.has(nilai)) baru.delete(nilai);
      else baru.add(nilai);
      return baru;
    });
  }

  function susun() {
    if (kurang !== null || jumlah === null || maksN === null) return;
    // Urutan giliran kategori = urutan di layar; urutan sumber = urutan prioritas.
    const kategoriIds = categories.filter((c) => kategoriDipilih.has(c.id)).map((c) => c.id);
    const sumberDipilih = SUMBER_RENCANA.filter((s) => sumber.has(s));
    const hari = hariBaruN ?? hariBaruBawaan;
    onSusun(
      {
        kategoriIds,
        sumber: sumberDipilih,
        jumlah,
        hariBaru: hari,
        lewatiSisaMin: sisaDiketahui && lewatiAktif ? lewatiN : null,
        maksArtikel: maksN,
        anggaran: konsi ? null : anggaranN,
      },
      {
        kategoriIds,
        jumlah,
        sumber: sumberDipilih,
        hariBaru: hari,
        lewatiSisa: { aktif: lewatiAktif, min: lewatiN ?? SISA_LEWATI_BAWAAN },
        maksArtikel: maksN,
        anggaran: anggaranN,
      },
    );
  }

  const bantuSumber = (s: SumberRencana): string =>
    s === "LAKU_DI_SINI"
      ? td(`dasarLaku.${dasarLaku}`)
      : s === "LAKU_DI_TOKO_LAIN"
        ? t("sumberBantuIsi.LAKU_DI_TOKO_LAIN", { n: MIN_PCS_LARIS })
        : td(`sumberBantuIsi.${s}`);

  const pilihanJumlahDaftar: PilihanJumlah[] = ["PACK", ...PCS_CEPAT.map((n) => String(n) as PilihanJumlah), "LAIN"];

  return (
    <>
      {/* Jenis barang */}
      <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="rk-kategori">
        <div className="px-4 pb-3 pt-4">
          <h2 id="rk-kategori" className="beranda-judul">
            {t("jenisBarang")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("jenisBarangBantu")}</p>
        </div>
        {categories.length === 0 ? (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">{t("kategoriKosong")}</p>
        ) : (
          <ul className="divide-y border-t">
            {categories.map((c) => {
              const aktif = kategoriDipilih.has(c.id);
              return (
                <li key={c.id}>
                  <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5", aktif && "bg-primary/[0.04]")}>
                    <Checkbox checked={aktif} onCheckedChange={() => alihkan(setKategoriDipilih, c.id)} />
                    <span className="min-w-0 flex-1 text-sm font-medium">{c.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Jumlah per artikel */}
      <section className="beranda-kartu space-y-3" aria-labelledby="rk-jumlah">
        <h2 id="rk-jumlah" className="beranda-judul">
          {t("jumlahJudul")}
        </h2>
        <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="rk-jumlah">
          {pilihanJumlahDaftar.map((p) => (
            <Button
              key={p}
              type="button"
              variant={pilihanJumlah === p ? "default" : "outline"}
              aria-pressed={pilihanJumlah === p}
              disabled={p === "PACK" && !adaRasio}
              onClick={() => setPilihanJumlah(p)}
              className="h-11"
            >
              {p === "PACK" ? t("jumlahPack") : p === "LAIN" ? t("jumlahLain") : t("jumlahPcs", { n: p })}
            </Button>
          ))}
        </div>
        {pilihanJumlah === "LAIN" ? (
          <div className="space-y-2">
            <Label htmlFor="rk-pcs">{t("jumlahLainLabel")}</Label>
            <Input
              id="rk-pcs"
              inputMode="numeric"
              value={pcsLain}
              onChange={(e) => setPcsLain(angkaSaja(e.target.value))}
              aria-invalid={jumlah === null}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {pilihanJumlah === "PACK" ? t("jumlahPackRasio", { rasio: teksRasio }) : adaRasio ? t("jumlahPcsBantu") : t("jumlahPackTanpaRasio")}
        </p>
      </section>

      {/* Sumber barang, urut prioritas */}
      <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="rk-sumber">
        <div className="px-4 pb-3 pt-4">
          <h2 id="rk-sumber" className="beranda-judul">
            {t("sumberJudul")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("sumberBantu")}</p>
        </div>
        <ul className="divide-y border-t">
          {SUMBER_RENCANA.map((s, i) => {
            const aktif = sumber.has(s);
            return (
              <li key={s} className={cn(aktif && "bg-primary/[0.04]")}>
                <label className="flex min-h-12 cursor-pointer items-start gap-3 px-4 py-3">
                  <Checkbox className="mt-0.5" checked={aktif} onCheckedChange={() => alihkan(setSumber, s)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {i + 1}. {td(`sumber.${s}`)}
                    </span>
                    <span className="block text-xs text-muted-foreground">{bantuSumber(s)}</span>
                  </span>
                </label>
                {s === "BARANG_BARU" && aktif ? (
                  <div className="space-y-2 px-4 pb-3 pl-11">
                    <Label htmlFor="rk-hari-baru">{t("hariBaruLabel")}</Label>
                    <Input
                      id="rk-hari-baru"
                      inputMode="numeric"
                      value={hariBaru}
                      onChange={(e) => setHariBaru(angkaSaja(e.target.value))}
                      aria-invalid={hariBaruN === null}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Batasan */}
      <section className="beranda-kartu space-y-4" aria-labelledby="rk-batasan">
        <h2 id="rk-batasan" className="beranda-judul">
          {t("batasanJudul")}
        </h2>
        <div className="space-y-2">
          <Label htmlFor="rk-maks">{t("maksArtikelLabel")}</Label>
          <Input
            id="rk-maks"
            inputMode="numeric"
            value={maksArtikel}
            onChange={(e) => setMaksArtikel(angkaSaja(e.target.value))}
            aria-invalid={maksN === null}
          />
        </div>

        {sisaDiketahui ? (
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox className="mt-0.5" checked={lewatiAktif} onCheckedChange={(v) => setLewatiAktif(v === true)} />
              <span className="min-w-0 flex-1 text-sm font-medium">{t("lewatiSisaLabel")}</span>
            </label>
            {lewatiAktif ? (
              <div className="space-y-2 pl-7">
                <Label htmlFor="rk-sisa">{t("lewatiSisaMinLabel")}</Label>
                <Input
                  id="rk-sisa"
                  inputMode="numeric"
                  value={lewatiMin}
                  onChange={(e) => setLewatiMin(angkaSaja(e.target.value))}
                  aria-invalid={lewatiN === null}
                  aria-describedby="rk-sisa-bantu"
                />
                <p id="rk-sisa-bantu" className="text-xs text-muted-foreground">
                  {t("lewatiSisaBantu")}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("lewatiSisaTidakDiketahui")}</p>
        )}

        {konsi ? null : (
          <div className="space-y-2">
            <Label htmlFor="rk-anggaran">{t("anggaranLabel")}</Label>
            <Input
              id="rk-anggaran"
              inputMode="numeric"
              value={anggaran}
              onChange={(e) => setAnggaran(angkaSaja(e.target.value))}
              aria-invalid={anggaran !== "" && anggaranN === null}
              aria-describedby="rk-anggaran-bantu"
            />
            <p id="rk-anggaran-bantu" className="text-xs text-muted-foreground">
              {anggaranN !== null ? `${formatIDR(anggaranN)} · ` : null}
              {t("anggaranBantu")}
            </p>
          </div>
        )}
      </section>

      <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto space-y-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button type="button" className="w-full" size="lg" disabled={kurang !== null || menyusun} onClick={susun}>
          {menyusun ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("menyusun")}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              {t("susun")}
            </>
          )}
        </Button>
        <KeteranganKirim teks={kurang} />
      </div>
    </>
  );
}
