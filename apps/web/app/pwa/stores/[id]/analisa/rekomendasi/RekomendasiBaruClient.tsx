"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Lightbulb, Loader2, Minus, Plus, Send } from "lucide-react";
import { buatRekomendasiAction } from "@/app/actions/rekomendasi-toko";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { pesanGagalRekomendasi } from "@/app/pwa/rekomendasi/tampilan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { BATAS_TEKS_REKOMENDASI, QTY_MAKS_REKOMENDASI } from "@/lib/salesman/rekomendasi-aturan";
import type { BahanFormRekomendasi, InfoKandidat, KandidatRekomendasi } from "@/lib/salesman/rekomendasi-queries";

const URUTAN_KELOMPOK: InfoKandidat["kode"][] = ["ISI_ULANG", "ANDALAN_TOKO", "LARIS_DI_AREA", "BARU", "DI_TOKO"];
const kunciBaris = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

/**
 * Formulir rekomendasi: kandidat dikelompokkan menurut alasannya; setiap
 * ukuran punya jumlahnya sendiri, dan hanya baris berjumlah > 0 yang dikirim.
 * Barang yang cepat terserap dan hampir habis sudah terisi saran isi ulangnya.
 *
 * Kunci kiriman dibuat sekali per formulir dan TETAP saat kiriman gagal,
 * supaya kiriman ulang setelah jaringan putus tidak mencatat dua rekomendasi.
 * Tidak ada harga di layar ini — rekomendasi hanya barang dan jumlah.
 */
export function RekomendasiBaruClient({ bahan }: { bahan: BahanFormRekomendasi }) {
  const t = useTranslations("pwaRekomendasi.baru");
  const tr = dinamis(useTranslations("pwaRekomendasi"));
  const locale = useLocale();
  const router = useRouter();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 0 });
  const [pending, mulai] = useTransition();
  const [kunci] = useState(() => newLocalId());
  const [catatan, setCatatan] = useState("");
  const [qty, setQty] = useState<Record<string, number>>(() => {
    const awal: Record<string, number> = {};
    for (const k of bahan.kandidat) for (const b of k.baris) if (b.qtyAwal > 0) awal[kunciBaris(k.itemId, b.variantSku)] = b.qtyAwal;
    return awal;
  });

  const kelompok = useMemo(
    () =>
      URUTAN_KELOMPOK.map((kode) => ({ kode, kandidat: bahan.kandidat.filter((k) => k.info.kode === kode) })).filter((g) => g.kandidat.length > 0),
    [bahan.kandidat],
  );

  const terpilih = bahan.kandidat.flatMap((k) =>
    k.baris
      .filter((b) => (qty[kunciBaris(k.itemId, b.variantSku)] ?? 0) > 0)
      .map((b) => ({ itemId: k.itemId, variantSku: b.variantSku, qty: qty[kunciBaris(k.itemId, b.variantSku)], alasan: k.alasan })),
  );
  const jumlahBarang = new Set(terpilih.map((b) => b.itemId)).size;
  const jumlahPcs = terpilih.reduce((n, b) => n + b.qty, 0);
  const kurang = terpilih.length === 0 ? t("kurangBaris") : null;

  const ubah = (itemId: string, variantSku: string, nilai: number) => {
    const n = Number.isFinite(nilai) ? Math.max(0, Math.min(QTY_MAKS_REKOMENDASI, Math.floor(nilai))) : 0;
    setQty((lama) => ({ ...lama, [kunciBaris(itemId, variantSku)]: n }));
  };

  const kirim = () =>
    mulai(async () => {
      try {
        const r = await buatRekomendasiAction({ storeId: bahan.toko.id, baris: terpilih, catatan: catatan.trim() || null, idempotencyKey: kunci });
        if (!r.ok) {
          toast.error(pesanGagalRekomendasi(r, tr));
          return;
        }
        toast.success(t("ok"));
        router.replace(`/pwa/rekomendasi/${r.id}`);
      } catch {
        toast.error(tr("err.JARINGAN"));
      }
    });

  const kembali = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <TautanKembali cadangan={`/pwa/stores/${bahan.toko.id}/analisa`} />
    </Button>
  );

  if (!bahan.boleh) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <section className="beranda-kartu space-y-2">
          <h1 className="text-lg font-semibold">{t("judul")}</h1>
          <p className="text-sm text-muted-foreground">{t("bukanPemegang", { toko: bahan.toko.nama })}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4">
      {kembali}

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("judul")}</h1>
        <p className="text-sm text-muted-foreground">{bahan.toko.nama}</p>
        <p className="text-sm text-muted-foreground">{t("penjelasan")}</p>
      </header>

      {bahan.kandidat.length === 0 ? (
        <section className="beranda-kartu flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Lightbulb className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold leading-tight">{t("kosongJudul")}</h2>
            <p className="text-sm text-muted-foreground">{t("kosongIsi")}</p>
          </div>
        </section>
      ) : (
        kelompok.map((g) => (
          <section key={g.kode} className="space-y-2" aria-labelledby={`kelompok-${g.kode}`}>
            <div className="px-1">
              <h2 id={`kelompok-${g.kode}`} className="beranda-judul">
                {tr(`baru.kelompok.${g.kode}`)}
              </h2>
              <p className="text-xs text-muted-foreground">{tr(`baru.kelompokPenjelasan.${g.kode}`)}</p>
            </div>
            {g.kandidat.map((k) => (
              <KartuKandidat key={k.itemId} k={k} qty={qty} ubah={ubah} angka={angka} pending={pending} />
            ))}
          </section>
        ))
      )}

      {bahan.kandidat.length > 0 ? (
        <Card className="py-0">
          <CardContent className="space-y-2 py-4">
            <Label htmlFor="rekomendasi-catatan">{t("catatan")}</Label>
            <Textarea
              id="rekomendasi-catatan"
              value={catatan}
              rows={2}
              maxLength={BATAS_TEKS_REKOMENDASI}
              placeholder={t("catatanContoh")}
              onChange={(e) => setCatatan(e.target.value)}
              disabled={pending}
            />
          </CardContent>
        </Card>
      ) : null}

      {bahan.kandidat.length > 0 ? (
        <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto space-y-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <p className="text-sm tabular-nums">{t("ringkas", { barang: jumlahBarang, pcs: angka.format(jumlahPcs) })}</p>
          <Button className="w-full" size="lg" disabled={pending || kurang !== null} onClick={kirim}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {t("kirim")}
          </Button>
          <KeteranganKirim teks={kurang} />
        </div>
      ) : null}
    </div>
  );
}

function KartuKandidat({
  k,
  qty,
  ubah,
  angka,
  pending,
}: {
  k: KandidatRekomendasi;
  qty: Record<string, number>;
  ubah: (itemId: string, variantSku: string, nilai: number) => void;
  angka: Intl.NumberFormat;
  pending: boolean;
}) {
  const t = useTranslations("pwaRekomendasi.baru");
  const td = dinamis(useTranslations("pwaRekomendasi"));
  const tanpaVarian = k.baris.length === 1 && k.baris[0].variantSku === "";

  return (
    <Card className="py-0">
      <CardContent className="space-y-3 py-4">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 font-medium leading-tight">{k.nama}</p>
            <Badge variant="outline" className="shrink-0">
              {td(`alasan.${k.alasan}`)}
            </Badge>
          </div>
          {k.sku ? <p className="truncate font-mono text-[11px] text-muted-foreground">{k.sku}</p> : null}
          <p className="text-xs text-muted-foreground">{infoKandidat(k.info, td, angka)}</p>
        </div>
        <ul className="space-y-2">
          {k.baris.map((b) => {
            const kunci = kunciBaris(k.itemId, b.variantSku);
            const n = qty[kunci] ?? 0;
            const label = tanpaVarian ? t("jumlah") : (b.label ?? b.variantSku);
            return (
              <li key={kunci} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-tight">{label}</p>
                  {b.laku !== null || b.sisa !== null ? (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {t("ukuranInfo", { laku: angka.format(b.laku ?? 0), sisa: angka.format(b.sisa ?? 0) })}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("kurangi", { nama: label })}
                  disabled={pending || n <= 0}
                  onClick={() => ubah(k.itemId, b.variantSku, n - 1)}
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </Button>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={QTY_MAKS_REKOMENDASI}
                  className="w-16 text-center tabular-nums"
                  aria-label={t("jumlahUntuk", { nama: label })}
                  value={n}
                  disabled={pending}
                  onChange={(e) => ubah(k.itemId, b.variantSku, Number(e.target.value))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("tambah", { nama: label })}
                  disabled={pending || n >= QTY_MAKS_REKOMENDASI}
                  onClick={() => ubah(k.itemId, b.variantSku, n + 1)}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function infoKandidat(i: InfoKandidat, td: ReturnType<typeof dinamis>, angka: Intl.NumberFormat): string {
  switch (i.kode) {
    case "ISI_ULANG":
      return td("baru.info.ISI_ULANG", { laku: angka.format(i.laku), sisa: angka.format(i.sisa), pct: i.persen ?? 0 });
    case "DI_TOKO":
      return td("baru.info.DI_TOKO", { laku: angka.format(i.laku), sisa: angka.format(i.sisa), pct: i.persen ?? 0 });
    case "ANDALAN_TOKO":
      return td("baru.info.ANDALAN_TOKO", { jeda: i.jedaBiasa, hari: i.hariSejakPesan });
    case "LARIS_DI_AREA":
      return td("baru.info.LARIS_DI_AREA", { pcs: angka.format(i.pcs), toko: i.toko, hari: i.hari });
    case "BARU":
      return td("baru.info.BARU", { hari: i.umurHari });
  }
}
