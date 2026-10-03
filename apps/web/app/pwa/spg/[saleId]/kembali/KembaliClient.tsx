"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CloudOff, Minus, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { catatReturPembeliAction } from "@/app/actions/spg-retur";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { formatDisplayDateTime } from "@/lib/date-only";
import type { NotaUntukKembali } from "@/lib/spg/retur-pembeli";
import { denganBatasWaktu, tanpaSinyal } from "@/lib/pwa/offline/batas-waktu";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { antreReturPembeli, returPembeliTertahanUntuk } from "@/lib/pwa/offline/luring-antrean";

const KONDISI = ["LAYAK", "RUSAK"] as const;
type Kondisi = (typeof KONDISI)[number];

/**
 * Barang yang dikembalikan pembeli ke counter. Kasir toko yang mengembalikan
 * uangnya — layar ini hanya mencatat barang, jumlah, kondisi, dan alasannya.
 * Barang layak kembali ke stok rak toko; yang rusak tercatat tanpa masuk rak.
 */
export function KembaliClient({ nota, storeId }: { nota: NotaUntukKembali; storeId: string }) {
  const t = useTranslations("spgRetur.pembeli");
  const tl = useTranslations("pwaLuring.stok");
  const tk = dinamis(useTranslations("spgRetur"));
  const te = dinamis(t);
  const router = useRouter();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  // Satu kunci per formulir: ketukan ganda atau kiriman ulang tidak mencatat dua kali.
  const [kunci] = useState(newLocalId);
  const [isian, setIsian] = useState<Record<string, { qty: number; kondisi: Kondisi }>>(() =>
    Object.fromEntries(nota.baris.map((b) => [b.saleLineId, { qty: 0, kondisi: "LAYAK" as Kondisi }])),
  );
  const [alasan, setAlasan] = useState("");
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
  /** Sisa yang masih bisa dikembalikan, sesudah yang sudah tercatat di HP. */
  const sisaDari = (b: { saleLineId: string; sisa: number }) => Math.max(0, b.sisa - (tertahan.get(b.saleLineId) ?? 0));

  const ubah = (id: string, sisa: number, qty: number) =>
    setIsian((lama) => ({ ...lama, [id]: { ...lama[id], qty: Math.min(sisa, Math.max(0, Math.floor(qty) || 0)) } }));

  const dipilih = nota.baris.filter((b) => (isian[b.saleLineId]?.qty ?? 0) > 0);
  const semuaSudahKembali = nota.baris.every((b) => sisaDari(b) === 0);
  const kurang = pending
    ? null
    : dipilih.length === 0
      ? t("kurangBarang")
      : alasan.trim() === ""
        ? t("kurangAlasan")
        : null;

  const kirim = () => {
    const baris = dipilih
      .map((b) => ({
        saleLineId: b.saleLineId,
        // Dijepit ke sisa sesudah yang sudah tercatat di HP.
        qty: Math.min(isian[b.saleLineId].qty, sisaDari(b)),
        condition: isian[b.saleLineId].kondisi,
      }))
      .filter((b) => b.qty > 0);
    /**
     * Ke antrean HP: tanpa sinyal, atau jawaban server tidak datang. Kunci yang
     * sama dengan kiriman langsung — kalau ternyata sudah sampai, antrean hanya
     * mendapat catatan yang ada. Retur pembeli tidak butuh check-in.
     */
    const simpanDiHp = async () => {
      try {
        await antreReturPembeli({
          localId: kunci,
          storeId,
          spgSaleId: nota.id,
          docNo: nota.docNo,
          waktu: Date.now(),
          alasan,
          baris: baris.map((b) => ({ ...b, productName: nota.baris.find((x) => x.saleLineId === b.saleLineId)?.productName ?? "" })),
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
      let hasil: Awaited<ReturnType<typeof catatReturPembeliAction>>;
      try {
        hasil = await denganBatasWaktu(catatReturPembeliAction({ spgSaleId: nota.id, alasan, idempotencyKey: kunci, baris }));
      } catch {
        await simpanDiHp();
        return;
      }
      if (!hasil.ok) {
        toast.error(te(`err${hasil.kode}`));
        return;
      }
      toast.success(t("ok"));
      router.replace(`/pwa/spg/${nota.id}/nota`);
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
        <h1 className="text-2xl font-bold">{t("judul")}</h1>
        <p className="text-sm text-muted-foreground">
          {nota.docNo} · {formatDisplayDateTime(nota.waktu, locale)}
        </p>
        <p className="text-sm text-muted-foreground">{t("penjelasan")}</p>
      </div>

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
                </div>
                {sisa === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("sudahSemua")}</p>
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
          <CardContent className="space-y-2 py-4">
            <Label htmlFor="kb-alasan">{t("alasan")}</Label>
            <Textarea
              id="kb-alasan"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              rows={2}
              placeholder={t("alasanContoh")}
            />
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
