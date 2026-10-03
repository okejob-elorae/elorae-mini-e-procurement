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
import { catatHitunganGudangAction } from "@/app/actions/store-returns";
import { dinamis } from "@/lib/i18n/dinamis";
import type { MenungguGudang } from "@/lib/receivables/pwa-queries";
import { nilaiHitunganAwal } from "./nilai";

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

export function GudangClient({ baris }: { baris: MenungguGudang[] }) {
  const t = useTranslations("pwaGudang");
  const tk = dinamis(useTranslations("spgRetur"));
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dipilih, setDipilih] = useState<MenungguGudang | null>(null);
  const [hitung, setHitung] = useState<Hitung[]>([]);
  // Nilai fisik: terisi dari hitungan per baris, boleh diubah. `null` = belum diubah.
  const [nilaiKetik, setNilaiKetik] = useState<string | null>(null);
  const [catatan, setCatatan] = useState("");

  const perBaris = dipilih ? dipilih.baris.length > 0 : false;
  const qtyHitung = hitung.map((h) => Math.max(0, Math.floor(Number(h.qty)) || 0));
  const hitungSah = hitung.every((h) => h.qty.trim() !== "" && Number.isInteger(Number(h.qty)) && Number(h.qty) >= 0);
  const nilaiAwal = dipilih && perBaris ? nilaiHitunganAwal(dipilih.baris, qtyHitung, dipilih.nilaiKlaim) : 0;
  const nilai = nilaiKetik ?? (perBaris ? String(nilaiAwal) : "");

  const buka = (b: MenungguGudang) => {
    setDipilih(b);
    setHitung(b.baris.map((x) => ({ qty: String(x.qty), kondisi: x.condition })));
    setNilaiKetik(null);
    setCatatan("");
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
        receivedAt: hariIniWib(),
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
      setDipilih(null);
      router.refresh();
    });
  };

  const bisaSimpan = !pending && nilai !== "" && Number(nilai) >= 0 && (!perBaris || hitungSah);

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
                        {t("jumlahBaris", { baris: b.baris.length, potong: b.baris.reduce((n, x) => n + x.qty, 0) })}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs text-muted-foreground">{t("claimed")}</span>
                    <span className="block font-bold tabular-nums">{rupiah(b.nilaiKlaim)}</span>
                  </span>
                </div>
                <Button className="w-full" disabled={pending} onClick={() => buka(b)}>
                  {t("count")}
                </Button>
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
              {dipilih && t("countBody", { doc: dipilih.noNrt, claimed: rupiah(dipilih.nilaiKlaim) })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {dipilih && perBaris && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("perBarisHint")}</p>
                {dipilih.baris.map((x, i) => (
                  <div key={`${x.itemId}-${x.variantSku}-${i}`} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-sm font-medium">{x.itemName}</p>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {t("diklaim", { qty: x.qty })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
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
          <DialogFooter>
            <Button disabled={!bisaSimpan} onClick={simpan}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
