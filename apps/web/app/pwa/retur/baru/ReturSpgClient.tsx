"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Minus, PackageX, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { catatReturTokoAction } from "@/app/actions/store-returns";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { cocokCari, type BarisPilihan } from "@/app/pwa/spg/stok/barang-pilihan";
import { dinamis } from "@/lib/i18n/dinamis";
import { unggahFoto } from "@/lib/foto/unggah";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { nasibUnggah } from "@/lib/pwa/offline/laporan-classify";
import { antreRetur } from "@/lib/pwa/offline/laporan-queue";
import { newLocalId } from "@/lib/pwa/offline/queue";
import { BarisRusakPembeli, type BarisRusakPembeliAwal } from "./BarisRusakPembeli";

function hariIniWib(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

const KIRIM = ["SALES", "TOKO", "EKSPEDISI"] as const;
const KONDISI = ["LAYAK", "RUSAK"] as const;
type Kondisi = (typeof KONDISI)[number];

type Baris = { kunci: string; barang: BarisPilihan; qty: number; kondisi: Kondisi };

export type AwalReturSpg = {
  dariId: string;
  dariNoNrt: string;
  noNrt: string;
  tanggal: string;
  caraKirim: (typeof KIRIM)[number];
  /** Hanya toko PUTUS — nilai toko KONSI tidak pernah sampai ke HP. */
  nilai: number | null;
  foto: { url: string; nama: string } | null;
  baris: { itemId: string; variantSku: string; qty: number; condition: string }[];
};

/**
 * Barang rusak kiriman yang gudang minta dikirim balik (`KEMBALI_GUDANG`):
 * kondisinya selalu RUSAK, jumlahnya paling banyak `sisa`, dan barisnya
 * menunjuk baris tanda terima — tidak mengurangi buku stok toko, karena barang
 * itu memang tidak pernah masuk buku.
 */
export type BarisRusakAwal = {
  receiptLineId: string;
  itemId: string;
  variantSku: string;
  nama: string;
  docNo: string;
  sisa: number;
  qty: number;
};

/**
 * Nota retur dari SPG: barang dari buku stok tokonya sendiri, per varian, dengan
 * kondisinya. Tokonya tetap (ditetapkan server); tidak ada harga di layar ini.
 *
 * - KONSI: nomor nota boleh kosong (sistem memberi `TRK/…`), nilainya dihitung
 *   kantor dari harga konsinyasi, foto tidak wajib.
 * - PUTUS: barangnya milik toko, jadi yang berlaku nota TOKO — nomor, foto, dan
 *   totalnya wajib; barisnya hanya qty.
 */
export function ReturSpgClient({
  toko,
  barang,
  bukuDimulai,
  awal = null,
  rusak = [],
  rusakPembeli = [],
  rusakTidakBisa = 0,
}: {
  toko: { id: string; name: string; termsType: "PUTUS" | "KONSI" };
  barang: BarisPilihan[];
  /** Buku stok toko sudah punya gerakan — saldonya berarti. */
  bukuDimulai: boolean;
  awal?: AwalReturSpg | null;
  /** Isian awal dari layar Terima kiriman (`?dariRusak=`) atau nota batal yang disalin. */
  rusak?: BarisRusakAwal[];
  /** Barang rusak dari pembeli di konter (`?dariReturPembeli=`) atau dari nota batal yang disalin. */
  rusakPembeli?: BarisRusakPembeliAwal[];
  /** Baris rusak yang diminta tapi sudah tidak bisa dikirim balik (sudah habis / bukan milik toko ini). */
  rusakTidakBisa?: number;
}) {
  const trk = useTranslations("spgRusak");
  const t = useTranslations("spgRetur");
  const tr = useTranslations("pwaRetur");
  const tFoto = useTranslations("foto");
  const td = dinamis(tr);
  const tk = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Satu kunci per formulir: kiriman ulang dari antrean tidak mencatat dua kali.
  const [kunci] = useState(newLocalId);
  const putus = toko.termsType === "PUTUS";

  const perKunci = useMemo(() => new Map(barang.map((b) => [b.kunci, b])), [barang]);
  const [baris, setBaris] = useState<Baris[]>(() =>
    (awal?.baris ?? []).flatMap((b) => {
      const pilihan = perKunci.get(`${b.itemId}::${b.variantSku}`) ?? perKunci.get(`${b.itemId}::`);
      if (!pilihan) return [];
      const kondisi: Kondisi = b.condition === "LAYAK" ? "LAYAK" : "RUSAK";
      return [{ kunci: `${pilihan.kunci}::${kondisi}`, barang: pilihan, qty: b.qty, kondisi }];
    }),
  );
  const [barisRusak, setBarisRusak] = useState<BarisRusakAwal[]>(rusak);
  const [barisPembeli, setBarisPembeli] = useState<BarisRusakPembeliAwal[]>(rusakPembeli);
  const [cari, setCari] = useState("");
  const [noNrt, setNoNrt] = useState(awal?.noNrt ?? "");
  const [tanggal, setTanggal] = useState(awal?.tanggal || hariIniWib());
  const [caraKirim, setCaraKirim] = useState<(typeof KIRIM)[number]>(awal?.caraKirim ?? "SALES");
  const [nilai, setNilai] = useState(awal?.nilai ? String(awal.nilai) : "");
  const [foto, setFoto] = useState<NilaiFoto>(awal?.foto ?? null);
  const [catatan, setCatatan] = useState("");

  // Tanpa kata kunci: barang yang ada di rak (saldo buku > 0). Dengan kata
  // kunci: semua yang cocok — barang bisa kembali walau bukunya belum mencatat.
  const hasil = useMemo(() => {
    const kata = cari.trim();
    const daftar = kata ? barang.filter((b) => cocokCari(b, kata)) : barang.filter((b) => b.stok > 0);
    return [...daftar].sort((a, b) => b.stok - a.stok).slice(0, kata ? 20 : 30);
  }, [barang, cari]);

  const qtyPerBarang = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of baris) m.set(b.barang.kunci, (m.get(b.barang.kunci) ?? 0) + b.qty);
    return m;
  }, [baris]);
  const lebih = (b: BarisPilihan) => bukuDimulai && (qtyPerBarang.get(b.kunci) ?? 0) > b.stok;
  const adaLebih = baris.some((b) => lebih(b.barang));

  const tambah = (b: BarisPilihan) => {
    setBaris((lama) => {
      const k = `${b.kunci}::LAYAK`;
      const ada = lama.find((x) => x.kunci === k);
      if (ada) return lama.map((x) => (x.kunci === k ? { ...x, qty: x.qty + 1 } : x));
      return [...lama, { kunci: k, barang: b, qty: 1, kondisi: "LAYAK" }];
    });
  };
  const ubahQty = (k: string, qty: number) =>
    setBaris((lama) => lama.map((x) => (x.kunci === k ? { ...x, qty: Math.max(1, Math.floor(qty) || 1) } : x)));
  const ubahKondisi = (k: string, kondisi: Kondisi) =>
    setBaris((lama) => {
      const x = lama.find((y) => y.kunci === k);
      if (!x) return lama;
      const kBaru = `${x.barang.kunci}::${kondisi}`;
      const sudah = lama.find((y) => y.kunci === kBaru);
      // Barang + kondisi yang sama digabung, bukan dua baris kembar.
      if (sudah) return lama.filter((y) => y.kunci !== k).map((y) => (y.kunci === kBaru ? { ...y, qty: y.qty + x.qty } : y));
      return lama.map((y) => (y.kunci === k ? { ...y, kunci: kBaru, kondisi } : y));
    });
  const hapus = (k: string) => setBaris((lama) => lama.filter((x) => x.kunci !== k));
  const ubahQtyRusak = (id: string, qty: number) =>
    setBarisRusak((lama) => lama.map((x) => (x.receiptLineId === id ? { ...x, qty: Math.min(x.sisa, Math.max(1, Math.floor(qty) || 1)) } : x)));
  const hapusRusak = (id: string) => setBarisRusak((lama) => lama.filter((x) => x.receiptLineId !== id));
  const ubahQtyPembeli = (id: string, qty: number) =>
    setBarisPembeli((lama) =>
      lama.map((x) => (x.spgSaleReturnLineId === id ? { ...x, qty: Math.min(x.sisa, Math.max(1, Math.floor(qty) || 1)) } : x)),
    );
  const hapusPembeli = (id: string) => setBarisPembeli((lama) => lama.filter((x) => x.spgSaleReturnLineId !== id));

  const kurang = pending
    ? null
    : baris.length === 0 && barisRusak.length === 0 && barisPembeli.length === 0
      ? t("kurangBaris")
      : putus && foto === null
        ? tr("kurangFoto")
        : putus && noNrt.trim() === ""
          ? tr("kurangNomor")
          : putus && !(Number(nilai) > 0)
            ? tr("kurangNilai")
            : adaLebih && catatan.trim() === ""
              ? t("kurangCatatan")
              : null;
  const bisaKirim = !pending && kurang === null;

  const kirim = () => {
    startTransition(async () => {
      const isi = {
        noNrt,
        claimDate: tanggal,
        deliveryMethod: caraKirim,
        claimedAmount: putus ? Number(nilai) : 0,
        note: catatan,
        menggantikanId: awal?.dariId ?? null,
        barisSpg: [
          ...baris.map((b) => ({
            itemId: b.barang.itemId,
            variantSku: b.barang.variantSku,
            qty: b.qty,
            condition: b.kondisi,
          })),
          ...barisRusak.map((b) => ({
            itemId: b.itemId,
            variantSku: b.variantSku,
            qty: b.qty,
            condition: "RUSAK" as const,
            storeReceiptLineId: b.receiptLineId,
          })),
          ...barisPembeli.map((b) => ({
            itemId: b.itemId,
            variantSku: b.variantSku,
            qty: b.qty,
            condition: b.kondisi,
            spgSaleReturnLineId: b.spgSaleReturnLineId,
          })),
        ],
      };

      // Tanpa sinyal: simpan di HP, terkirim sendiri begitu sinyal kembali.
      const antrekan = async () => {
        await antreRetur({
          localId: kunci,
          storeId: toko.id,
          storeName: toko.name,
          payload: isi,
          foto: foto ? (foto.berkas ? { nama: foto.nama, blob: foto.berkas } : { nama: foto.nama, url: foto.url }) : null,
        });
        window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
        toast.success(tr("okQueued"));
        router.replace("/pwa/retur");
      };

      if (!navigator.onLine) return antrekan();
      let hasil: Awaited<ReturnType<typeof catatReturTokoAction>>;
      try {
        const photoUrl = foto
          ? foto.berkas
            ? await unggahFoto(new File([foto.berkas], foto.nama, { type: foto.berkas.type || "image/jpeg" }))
            : foto.url
          : null;
        hasil = await catatReturTokoAction({ storeId: toko.id, ...isi, photoUrl, idempotencyKey: kunci });
      } catch (err) {
        // Foto yang DITOLAK server tidak akan lolos di antrean juga.
        if (nasibUnggah(err) === "terminal") {
          toast.error(tFoto(`err${err instanceof Error ? err.message : "GAGAL"}` as never));
          return;
        }
        return antrekan();
      }
      if (!hasil.ok) {
        toast.error(td(`err${hasil.kode}`));
        return;
      }
      toast.success(tr("okCreated"));
      router.replace("/pwa/retur");
    });
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/retur" />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("judul")}</h1>
        <p className="text-sm text-muted-foreground">{putus ? t("penjelasanPutus") : t("penjelasanKonsi")}</p>
      </header>

      {awal && (
        <p className="flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm">
          <Copy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t("salinan", { doc: awal.dariNoNrt })}</span>
        </p>
      )}

      <Card className="py-0">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold">{t("barangJudul")}</h2>
            <span className="text-sm text-muted-foreground">{toko.name}</span>
          </div>

          {rusakTidakBisa > 0 && (
            <p role="note" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              {trk("retur.tidakBisa", { count: rusakTidakBisa })}
            </p>
          )}

          {barisRusak.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{trk("retur.judul")}</p>
              {barisRusak.map((b) => (
                <div key={b.receiptLineId} className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                      <div className="min-w-0">
                        <p className="font-medium">{b.nama}</p>
                        {b.variantSku ? <p className="text-xs text-muted-foreground">{b.variantSku}</p> : null}
                        <p className="text-xs text-muted-foreground">{trk("retur.dari", { doc: b.docNo, n: b.sisa })}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("hapus")}
                      onClick={() => hapusRusak(b.receiptLineId)}
                      disabled={pending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("kurangi")}
                      onClick={() => ubahQtyRusak(b.receiptLineId, b.qty - 1)}
                      disabled={pending || b.qty <= 1}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={b.sisa}
                      className="w-16 text-center tabular-nums"
                      aria-label={t("qty")}
                      value={b.qty}
                      onChange={(e) => ubahQtyRusak(b.receiptLineId, Number(e.target.value))}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("tambahSatu")}
                      onClick={() => ubahQtyRusak(b.receiptLineId, b.qty + 1)}
                      disabled={pending || b.qty >= b.sisa}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <span className="min-w-0 flex-1 text-sm text-muted-foreground">{tk("kondisiRUSAK")}</span>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{trk("retur.penjelasan")}</p>
            </div>
          )}

          <BarisRusakPembeli baris={barisPembeli} pending={pending} onUbahQty={ubahQtyPembeli} onHapus={hapusPembeli} />

          {baris.length === 0 ? (
            barisRusak.length > 0 || barisPembeli.length > 0 ? null : <p className="text-sm text-muted-foreground">{t("belumAdaBaris")}</p>
          ) : (
            <div className="space-y-3">
              {baris.map((b) => (
                <div key={b.kunci} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{b.barang.nama}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.barang.kode}
                        {b.barang.varian ? ` · ${b.barang.varian}` : ""}
                      </p>
                      {bukuDimulai && (
                        <p className="text-xs text-muted-foreground">{t("saldoBuku", { n: b.barang.stok })}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" aria-label={t("hapus")} onClick={() => hapus(b.kunci)} disabled={pending}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("kurangi")}
                      onClick={() => ubahQty(b.kunci, b.qty - 1)}
                      disabled={pending || b.qty <= 1}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className="w-16 text-center tabular-nums"
                      aria-label={t("qty")}
                      value={b.qty}
                      onChange={(e) => ubahQty(b.kunci, Number(e.target.value))}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("tambahSatu")}
                      onClick={() => ubahQty(b.kunci, b.qty + 1)}
                      disabled={pending}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Select value={b.kondisi} onValueChange={(v) => ubahKondisi(b.kunci, v as Kondisi)}>
                      <SelectTrigger className="min-w-0 flex-1" aria-label={t("kondisi")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KONDISI.map((k) => (
                          <SelectItem key={k} value={k}>
                            {tk(`kondisi${k}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {lebih(b.barang) && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">{t("melebihiSaldo")}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 border-t pt-3">
            <Label htmlFor="rs-cari">{t("tambahBarang")}</Label>
            <Input
              id="rs-cari"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder={t("cariBarang")}
              autoComplete="off"
            />
            {hasil.length === 0 ? (
              <p className="text-sm text-muted-foreground">{cari.trim() ? t("tidakAdaHasil") : t("kosongRak")}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {hasil.map((b) => (
                  <li key={b.kunci}>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto w-full justify-between gap-3 rounded-none px-3 py-2 text-left font-normal whitespace-normal"
                      onClick={() => tambah(b)}
                      disabled={pending}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{b.nama}</span>
                        <span className="block text-xs text-muted-foreground">
                          {b.kode}
                          {b.varian ? ` · ${b.varian}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {bukuDimulai ? t("saldoSingkat", { n: b.stok }) : null}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="space-y-4 py-4">
          <UnggahFoto
            label={tr("photoLabel")}
            petunjuk={putus ? tr("photoHint") : t("fotoKonsiHint")}
            nilai={foto}
            onChange={setFoto}
            wajib={putus}
            disabled={pending}
            simpanDiHp
          />

          <div className="space-y-2">
            <Label htmlFor="rs-no">{putus ? tr("noNrt") : t("noNrtKonsi")}</Label>
            <Input
              id="rs-no"
              value={noNrt}
              onChange={(e) => setNoNrt(e.target.value)}
              placeholder={tr("noNrtPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{putus ? tr("noNrtHint") : t("noNrtKonsiHint")}</p>
          </div>

          {putus && (
            <div className="space-y-2">
              <Label htmlFor="rs-nilai">{tr("amount")}</Label>
              <Input
                id="rs-nilai"
                type="number"
                inputMode="numeric"
                min={1}
                value={nilai}
                onChange={(e) => setNilai(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("nilaiPutusHint")}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="rs-tgl">{tr("claimDate")}</Label>
            <TanggalInput id="rs-tgl" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rs-kirim">{tr("deliveryMethod")}</Label>
            <Select value={caraKirim} onValueChange={(v) => setCaraKirim(v as (typeof KIRIM)[number])}>
              <SelectTrigger id="rs-kirim" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIRIM.map((k) => (
                  <SelectItem key={k} value={k}>
                    {td(`via${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rs-catatan">{adaLebih ? t("catatanWajib") : tr("noteLabel")}</Label>
            <Textarea id="rs-catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Button className="w-full" size="lg" disabled={!bisaKirim} onClick={kirim}>
        {t("kirim")}
      </Button>
      <KeteranganKirim teks={kurang} />
    </div>
  );
}
