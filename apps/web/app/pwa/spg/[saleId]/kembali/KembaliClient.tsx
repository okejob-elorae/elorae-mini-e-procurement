"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ClipboardList, CloudOff, Hourglass, Minus, PackageX, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { catatReturPembeliAction } from "@/app/actions/retur-spg";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { formatDisplayDateTime } from "@/lib/date-only";
import type { NotaUntukKembali } from "@/lib/spg/retur-pembeli";
import { unggahFotoReturPembeli } from "@/lib/spg/foto-retur-pembeli-klien";
import type { JenisFotoReturPembeli } from "@/lib/spg/foto-retur-pembeli-kunci";
import { BatasWaktuHabis, denganBatasWaktu, tanpaSinyal } from "@/lib/pwa/offline/batas-waktu";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { antreReturPembeli, returPembeliTertahanUntuk } from "@/lib/pwa/offline/luring-antrean";
import type { FotoR2Tertunda } from "@/lib/pwa/offline/db";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
import { FotoReturTunda, type FotoTunda } from "@/app/pwa/spg/retur-pembeli/FotoReturTunda";
import { cn } from "@/lib/utils";

const KONDISI = ["LAYAK", "RUSAK"] as const;
type Kondisi = (typeof KONDISI)[number];
type JawabanUang = "BELUM" | "SUDAH";

/** Galat unggah yang tidak akan berhasil diulang (4xx). Sinyal putus, batas waktu, sesi habis, atau server sibuk → antrean HP. */
function ditolakServer(err: unknown): string | null {
  if (err instanceof TypeError || err instanceof BatasWaktuHabis) return null;
  if (err instanceof Error && err.message && err.message !== "GAGAL") return err.message;
  return null;
}

/**
 * Barang yang dikembalikan pembeli ke counter (keputusan pemilik 2026-11-02).
 * SPG MELAPORKAN barang, jumlah, kondisi, alasan, dan foto barangnya (wajib,
 * P14/P77), lalu menjawab apakah kasir sudah mengembalikan uang pembeli. Uang
 * baru boleh dikembalikan SESUDAH kantor menyetujui (P13a) — kalau ternyata
 * sudah, foto struk wajib dan bila laporannya ditolak uang itu menjadi beban
 * SPG. Selama menunggu, barangnya DISISIHKAN (P12): tidak ke rak, tidak dijual,
 * tidak dihitung.
 *
 * `sisa` dari server sudah dikurangi potong yang masih menunggu kantor atau
 * ditahan beban di laporan mana pun, jadi potong yang sama tidak bisa
 * dilaporkan dua kali. Foto diunggah saat dikirim (kunci = kunci formulir);
 * tanpa sinyal, foto dan laporannya disimpan di HP dan dikirim saat sinyal kembali.
 */
export function KembaliClient({ nota, storeId }: { nota: NotaUntukKembali; storeId: string }) {
  const t = useTranslations("spgRetur.pembeli");
  const tl = useTranslations("pwaLuring.stok");
  const tf = dinamis(useTranslations("foto"));
  const tk = dinamis(useTranslations("spgRetur"));
  const te = dinamis(t);
  const router = useRouter();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  // Satu kunci per formulir: ketukan ganda atau kiriman ulang tidak mencatat dua kali.
  // Kunci yang sama menjadi folder foto laporan ini di R2.
  const [kunci] = useState(newLocalId);
  const [isian, setIsian] = useState<Record<string, { qty: number; kondisi: Kondisi }>>(() =>
    Object.fromEntries(nota.baris.map((b) => [b.saleLineId, { qty: 0, kondisi: "LAYAK" as Kondisi }])),
  );
  const [alasan, setAlasan] = useState("");
  const [fotoBarang, setFotoBarang] = useState<FotoTunda | null>(null);
  const [uang, setUang] = useState<JawabanUang | null>(null);
  const [fotoStruk, setFotoStruk] = useState<FotoTunda | null>(null);
  // Barang kembali dari nota ini yang sudah dicatat TANPA sinyal dan masih di
  // HP: jumlahnya dikurangkan dari sisa di layar, supaya tidak dicatat dua kali
  // (server menolak yang melebihi sisa — MELEBIHI_SISA).
  const [tertahan, setTertahan] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let hidup = true;
    const muat = () => {
      void returPembeliTertahanUntuk(nota.id).then((daftar) => {
        if (!hidup) return;
        const m = new Map<string, number>();
        for (const r of daftar) {
          if (r.syncState === "failed") continue;
          for (const b of r.baris) m.set(b.saleLineId, (m.get(b.saleLineId) ?? 0) + b.qty);
        }
        setTertahan(m);
      });
    };
    muat();
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, muat);
    };
  }, [nota.id]);
  const potongTertahan = [...tertahan.values()].reduce((a, b) => a + b, 0);
  /** Sisa yang masih bisa dilaporkan: sisa server (tanpa yang menunggu kantor atau ditahan) dikurangi yang tercatat di HP. */
  const sisaDari = (b: { saleLineId: string; sisa: number }) => Math.max(0, b.sisa - (tertahan.get(b.saleLineId) ?? 0));

  const ubah = (id: string, sisa: number, qty: number) =>
    setIsian((lama) => ({ ...lama, [id]: { ...lama[id], qty: Math.min(sisa, Math.max(0, Math.floor(qty) || 0)) } }));

  const dipilih = nota.baris.filter((b) => (isian[b.saleLineId]?.qty ?? 0) > 0);
  const semuaSudahKembali = nota.baris.every((b) => sisaDari(b) === 0);
  // Urutan sama dengan urutan isian di layar: barang, alasan, foto barang, jawaban uang, foto struk.
  const kurang = pending
    ? null
    : dipilih.length === 0
      ? t("kurangBarang")
      : alasan.trim() === ""
        ? t("kurangAlasan")
        : !fotoBarang
          ? t("kurangFotoBarang")
          : uang === null
            ? t("kurangJawabUang")
            : uang === "SUDAH" && !fotoStruk
              ? t("kurangFotoStruk")
              : null;

  const kirim = () => {
    if (!fotoBarang || uang === null) return;
    const waktu = Date.now();
    const uangSudah = uang === "SUDAH";
    const baris = dipilih
      .map((b) => ({
        saleLineId: b.saleLineId,
        // Dijepit ke sisa sesudah yang sudah tercatat di HP.
        qty: Math.min(isian[b.saleLineId].qty, sisaDari(b)),
        condition: isian[b.saleLineId].kondisi,
      }))
      .filter((b) => b.qty > 0);
    const kunciFoto: Record<JenisFotoReturPembeli, string | null> = { barang: null, struk: null };
    const tertunda = (jenis: JenisFotoReturPembeli, f: FotoTunda): FotoR2Tertunda =>
      kunciFoto[jenis] ? { nama: f.nama, key: kunciFoto[jenis] ?? undefined } : { nama: f.nama, blob: f.berkas };

    /**
     * Ke antrean HP: tanpa sinyal, atau unggah/jawaban server tidak datang. Kunci
     * yang sama dengan kiriman langsung — kalau ternyata sudah sampai, antrean
     * hanya mendapat catatan yang ada. Foto yang sudah naik disimpan kuncinya,
     * yang belum disimpan berkasnya. Retur pembeli tidak butuh check-in.
     */
    const simpanDiHp = async () => {
      try {
        await antreReturPembeli({
          localId: kunci,
          storeId,
          spgSaleId: nota.id,
          docNo: nota.docNo,
          waktu,
          alasan,
          baris: baris.map((b) => ({ ...b, productName: nota.baris.find((x) => x.saleLineId === b.saleLineId)?.productName ?? "" })),
          uangSudahDikembalikan: uangSudah,
          fotoBarang: tertunda("barang", fotoBarang),
          ...(uangSudah && fotoStruk ? { fotoStruk: tertunda("struk", fotoStruk) } : {}),
        });
      } catch {
        toast.error(tl("gagalSimpan"));
        return;
      }
      toast.success(tl("tersimpanKembali"));
      router.replace(`/pwa/spg/${nota.id}/nota`);
    };

    startTransition(async () => {
      if (tanpaSinyal()) {
        await simpanDiHp();
        return;
      }
      try {
        kunciFoto.barang = (await denganBatasWaktu(unggahFotoReturPembeli({ berkas: fotoBarang.berkas, nama: fotoBarang.nama, jenis: "barang", kunci }))).key;
        if (uangSudah && fotoStruk) {
          kunciFoto.struk = (await denganBatasWaktu(unggahFotoReturPembeli({ berkas: fotoStruk.berkas, nama: fotoStruk.nama, jenis: "struk", kunci }))).key;
        }
      } catch (err) {
        const kode = ditolakServer(err);
        if (kode) {
          toast.error(tf(`err${kode}`));
          return;
        }
        await simpanDiHp();
        return;
      }
      let hasil: Awaited<ReturnType<typeof catatReturPembeliAction>>;
      try {
        hasil = await denganBatasWaktu(
          catatReturPembeliAction({
            spgSaleId: nota.id,
            alasan,
            idempotencyKey: kunci,
            baris,
            fotoBarangKey: kunciFoto.barang,
            uangSudahDikembalikan: uangSudah,
            fotoStrukKey: uangSudah ? kunciFoto.struk : null,
          }),
        );
      } catch {
        await simpanDiHp();
        return;
      }
      if (!hasil.ok) {
        toast.error(te(`err${hasil.kode}`));
        return;
      }
      toast.success(t("ok"));
      router.replace("/pwa/spg/retur-pembeli");
    });
  };

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan={`/pwa/spg/${nota.id}/nota`} />
        </Button>
      </header>

      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <TombolBantuanHp judul={t("judul")} />
        </div>
        <p className="text-sm text-muted-foreground">
          {nota.docNo} · {formatDisplayDateTime(nota.waktu, locale)}
        </p>
        <p className="text-sm text-muted-foreground">{t("penjelasan")}</p>
        <Link
          href="/pwa/spg/retur-pembeli"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline decoration-primary decoration-2 underline-offset-4"
        >
          <ClipboardList className="h-4 w-4" aria-hidden />
          {t("lihatLaporan")}
        </Link>
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
        <PackageX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{t("disisihkan")}</span>
      </p>

      {potongTertahan > 0 ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{tl("kembaliTertahan", { pcs: potongTertahan })}</span>
        </p>
      ) : null}

      <div className="space-y-3">
        {nota.baris.map((b) => {
          const isi = isian[b.saleLineId];
          const sisa = sisaDari(b);
          return (
            <Card key={b.saleLineId} className="py-0">
              <CardContent className="space-y-3 py-4">
                <div className="space-y-1">
                  <p className="font-medium">{b.productName}</p>
                  {b.variantSku && <p className="text-xs text-muted-foreground">{b.variantSku}</p>}
                  <p className="text-xs text-muted-foreground">
                    {t("terjualKembali", { terjual: b.qty, kembali: b.returnedQty })}
                  </p>
                  {b.menunggu > 0 ? (
                    <p className="flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
                      <Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t("menungguKantor", { n: b.menunggu })}
                    </p>
                  ) : null}
                  {b.ditahan > 0 ? (
                    <p className="flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
                      <Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t("ditahanBeban", { n: b.ditahan })}
                    </p>
                  ) : null}
                </div>
                {sisa === 0 ? (
                  <p className="text-sm text-muted-foreground">{t(b.menunggu > 0 || b.ditahan > 0 ? "semuaDilaporkan" : "sudahSemua")}</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={tk("kurangi")}
                      disabled={pending || isi.qty <= 0}
                      onClick={() => ubah(b.saleLineId, sisa, isi.qty - 1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={sisa}
                      className="w-16 text-center tabular-nums"
                      aria-label={tk("qty")}
                      value={isi.qty}
                      onChange={(e) => ubah(b.saleLineId, sisa, Number(e.target.value))}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={tk("tambahSatu")}
                      disabled={pending || isi.qty >= sisa}
                      onClick={() => ubah(b.saleLineId, sisa, isi.qty + 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Select
                      value={isi.kondisi}
                      onValueChange={(v) => setIsian((lama) => ({ ...lama, [b.saleLineId]: { ...lama[b.saleLineId], kondisi: v as Kondisi } }))}
                    >
                      <SelectTrigger className="min-w-0 flex-1" aria-label={tk("kondisi")}>
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
                )}
                {isi.qty > 0 && isi.kondisi === "RUSAK" && <p className="text-xs text-muted-foreground">{t("rusakTidakKeRak")}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!semuaSudahKembali && (
        <Card className="py-0">
          <CardContent className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="kb-alasan">{t("alasan")}</Label>
              <Textarea
                id="kb-alasan"
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
                rows={2}
                placeholder={t("alasanContoh")}
              />
            </div>
            <FotoReturTunda
              id="kb-foto-barang"
              label={t("fotoBarang")}
              petunjuk={t("fotoBarangPetunjuk")}
              nilai={fotoBarang}
              onChange={setFotoBarang}
              disabled={pending}
            />
          </CardContent>
        </Card>
      )}

      {!semuaSudahKembali && (
        <Card className="py-0">
          <CardContent className="space-y-3 py-4">
            <p className="font-medium" id="kb-uang-tanya">
              {t("uangTanya")}
            </p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="kb-uang-tanya">
              {(["BELUM", "SUDAH"] as const).map((j) => (
                <Button
                  key={j}
                  type="button"
                  role="radio"
                  aria-checked={uang === j}
                  variant={uang === j ? "default" : "outline"}
                  className={cn("h-auto whitespace-normal py-3")}
                  disabled={pending}
                  onClick={() => setUang(j)}
                >
                  {j === "BELUM" ? t("uangBelum") : t("uangSudah")}
                </Button>
              ))}
            </div>
            {uang === "BELUM" ? <p className="text-sm text-muted-foreground">{t("uangBelumKet")}</p> : null}
            {uang === "SUDAH" ? (
              <>
                <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{t("uangSudahPeringatan")}</span>
                </p>
                <FotoReturTunda id="kb-foto-struk" label={t("fotoStruk")} nilai={fotoStruk} onChange={setFotoStruk} disabled={pending} />
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      {!semuaSudahKembali && (
        <div className="mt-auto space-y-2">
          <Button className="w-full" size="lg" disabled={pending || kurang !== null} onClick={kirim}>
            {t("kirim")}
          </Button>
          <KeteranganKirim teks={kurang} />
        </div>
      )}
    </div>
  );
}
