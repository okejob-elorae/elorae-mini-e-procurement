"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, PackageOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { catatHitunganGudangAction } from "@/app/actions/store-returns";
import { dinamis } from "@/lib/i18n/dinamis";
import { nilaiHitunganAwal, type NotaHitung } from "./nilai";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

function hariIniWib(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

const KONDISI = ["LAYAK", "RUSAK", "EXPIRED"] as const;
type Kondisi = (typeof KONDISI)[number];
type Hitung = { qty: string; kondisi: Kondisi };
/** Hasil yang diperlihatkan sesudah hitungan tersimpan — baru di sini klaim toko tampil. */
type HasilHitung = {
  noNri: string;
  noNrt: string;
  klaim: { nilai: number; qty: number } | null;
  fisik: { nilai: number; qty: number };
};

export function GudangClient({ baris }: { baris: NotaHitung[] }) {
  const t = useTranslations("pwaGudang");
  const tk = dinamis(useTranslations("spgRetur"));
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dipilih, setDipilih] = useState<NotaHitung | null>(null);
  const [hitung, setHitung] = useState<Hitung[]>([]);
  // Nilai fisik: terisi dari hitungan per baris, boleh diubah. `null` = belum diubah.
  const [nilaiKetik, setNilaiKetik] = useState<string | null>(null);
  const [catatan, setCatatan] = useState("");
  const [diterima, setDiterima] = useState(hariIniWib());
  const [hasilHitung, setHasilHitung] = useState<HasilHitung | null>(null);

  const perBaris = dipilih ? dipilih.baris.length > 0 : false;
  // Kolom kosong = belum dihitung (NaN), bukan nol. Nol hanya kalau diketik.
  const qtyHitung = hitung.map((h) => (h.qty.trim() === "" ? Number.NaN : Number(h.qty)));
  const hitungSah = qtyHitung.every((q) => Number.isInteger(q) && q >= 0);
  const nilaiAwal = dipilih && perBaris ? nilaiHitunganAwal(dipilih.baris, qtyHitung, dipilih.nilaiPerPotong) : 0;
  const nilai = nilaiKetik ?? (perBaris ? String(nilaiAwal) : "");

  const buka = (b: NotaHitung) => {
    setDipilih(b);
    // Mulai KOSONG. Mengisi dengan qty klaim membuat satu "Simpan" mencatat
    // fisik = klaim tanpa ada yang menghitung.
    setHitung(b.baris.map((x) => ({ qty: "", kondisi: x.condition })));
    setNilaiKetik(null);
    setCatatan("");
    setDiterima(hariIniWib());
  };

  const simpan = () => {
    if (!dipilih) return;
    startTransition(async () => {
      // Harga baris ikut hanya kalau nilainya tidak diubah dan barisnya berharga.
      // Selain itu barisnya dikirim tanpa harga dan nilai yang diketik menang
      // (`nilaiDariRincian` di penulis) — jadi angka di layar = angka yang tersimpan.
      const pakaiHarga = nilaiKetik === null && dipilih.baris.some((x) => x.price > 0);
      const hasil = await catatHitunganGudangAction({
        storeReturnId: dipilih.id,
        receivedAt: diterima,
        deliveryMethod: dipilih.caraKirim as "SALES" | "TOKO" | "EKSPEDISI",
        physicalAmount: Number(nilai),
        items: perBaris
          ? dipilih.baris.map((x, i) => ({
              itemId: x.itemId,
              variantSku: x.variantSku,
              itemName: x.itemName,
              qty: qtyHitung[i],
              price: pakaiHarga ? x.price : 0,
              condition: hitung[i].kondisi,
            }))
          : undefined,
        note: catatan,
      });
      if (!hasil.ok) {
        toast.error(td(`err${hasil.kode}`));
        return;
      }
      toast.success(t("okCounted"));
      setHasilHitung({ noNri: hasil.noNri, noNrt: dipilih.noNrt, klaim: hasil.klaim, fisik: hasil.fisik });
      setDipilih(null);
      router.refresh();
    });
  };

  const bisaSimpan =
    !pending && diterima !== "" && nilai !== "" && Number(nilai) >= 0 && (!perBaris || hitungSah);

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("summary", { count: baris.length })}</p>
      </header>

      {baris.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <PackageOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="anim-stagger space-y-3">
          {baris.map((b) => (
            <Card key={b.id} className="py-0">
              <CardContent className="space-y-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {b.noNrt}
                      {b.dariSpg && <Badge variant="secondary">{t("dariSpg")}</Badge>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {b.storeName} · {tanggal(b.tanggal)} · {td(`via${b.caraKirim}`)}
                      {b.adaFoto && <Camera className="ml-1 inline h-3 w-3 align-[-1px]" />}
                    </span>
                    {b.baris.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {t("jumlahBarisSaja", { baris: b.baris.length })}
                      </span>
                    )}
                  </span>
                </div>
                <Button className="w-full" disabled={pending || b.milikSendiri} onClick={() => buka(b)}>
                  {t("count")}
                </Button>
                {b.milikSendiri && <p className="text-xs text-muted-foreground">{t("milikSendiri")}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dipilih !== null} onOpenChange={(o) => !o && setDipilih(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("countTitle")}</DialogTitle>
            <DialogDescription>
              {dipilih && t("countBodyButa", { doc: dipilih.noNrt, store: dipilih.storeName })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {dipilih && perBaris && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("perBarisHint")}</p>
                {dipilih.baris.map((x, i) => (
                  <div key={`${x.itemId}-${x.variantSku}-${i}`} className="space-y-2 rounded-lg border p-3">
                    <p className="min-w-0 text-sm font-medium">{x.itemName}</p>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        placeholder="—"
                        className="w-20 text-center tabular-nums"
                        aria-label={t("qtyDiterima")}
                        value={hitung[i]?.qty ?? ""}
                        onChange={(e) =>
                          setHitung((lama) => lama.map((h, j) => (j === i ? { ...h, qty: e.target.value } : h)))
                        }
                      />
                      <Select
                        value={hitung[i]?.kondisi ?? "LAYAK"}
                        onValueChange={(v) =>
                          setHitung((lama) => lama.map((h, j) => (j === i ? { ...h, kondisi: v as Kondisi } : h)))
                        }
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
                    {hitung[i] && hitung[i].kondisi !== "LAYAK" && (
                      <p className="text-xs text-muted-foreground">{t("tidakMasukStok")}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="g-diterima">{t("receivedAtLabel")}</Label>
              <TanggalInput
                id="g-diterima"
                value={diterima}
                max={hariIniWib()}
                required
                onChange={(e) => setDiterima(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="g-nilai">{t("countedAmount")}</Label>
              <Input
                id="g-nilai"
                type="number"
                inputMode="numeric"
                min={0}
                value={nilai}
                onChange={(e) => setNilaiKetik(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{perBaris ? t("nilaiPerBarisHint") : t("countHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="g-catatan">{t("noteLabel")}</Label>
              <Textarea id="g-catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button disabled={!bisaSimpan} onClick={simpan}>
              {t("save")}
            </Button>
            {perBaris && !hitungSah && <p className="text-xs text-muted-foreground">{t("qtyBelumDiisi")}</p>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sesudah tersimpan: baru di sini klaim toko diperlihatkan berdampingan dengan fisiknya. */}
      <Dialog open={hasilHitung !== null} onOpenChange={(o) => !o && setHasilHitung(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("hasilTitle")}</DialogTitle>
            <DialogDescription>
              {hasilHitung && t("hasilBody", { nri: hasilHitung.noNri, doc: hasilHitung.noNrt })}
            </DialogDescription>
          </DialogHeader>
          {hasilHitung && (
            <div className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">{t("hasilFisik")}</span>
                <span className="text-right tabular-nums">
                  <span className="block font-semibold">{rupiah(hasilHitung.fisik.nilai)}</span>
                  {hasilHitung.fisik.qty > 0 && (
                    <span className="block text-xs text-muted-foreground">{t("hasilPotong", { qty: hasilHitung.fisik.qty })}</span>
                  )}
                </span>
              </div>
              {hasilHitung.klaim && (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t("hasilKlaim")}</span>
                  <span className="text-right tabular-nums">
                    <span className="block font-semibold">{rupiah(hasilHitung.klaim.nilai)}</span>
                    {hasilHitung.klaim.qty > 0 && (
                      <span className="block text-xs text-muted-foreground">{t("hasilPotong", { qty: hasilHitung.klaim.qty })}</span>
                    )}
                  </span>
                </div>
              )}
              {hasilHitung.klaim &&
                (hasilHitung.klaim.nilai > hasilHitung.fisik.nilai ? (
                  <p className="font-medium text-destructive">
                    {t("hasilSelisih", { value: rupiah(hasilHitung.klaim.nilai - hasilHitung.fisik.nilai) })}
                  </p>
                ) : (
                  <p className="text-muted-foreground">{t("hasilCocok")}</p>
                ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHasilHitung(null)}>
              {t("tutup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
