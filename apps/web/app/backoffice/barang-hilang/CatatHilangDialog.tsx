"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { buatBarangHilangAction, cariBarangHilangAction, type BarangHilangCari } from "@/app/actions/barang-hilang";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { BATAS_TEKS_HILANG } from "@/lib/spg/hilang";

type Baris = { k: string; itemId: string; nama: string; varian: { variantSku: string; label: string | null }[]; variantSku: string; qty: string };

const TANPA_TOKO = "__tanpa__";

/**
 * Kantor mencatat barang hilang yang tidak datang dari opname, mutasi, atau
 * penerimaan (mis. hilang di gudang toko, dicuri). Toko boleh kosong; catatan
 * wajib. Satu kunci kiriman per formulir — klik ganda tidak membuat dua catatan.
 */
export function CatatHilangDialog({ toko }: { toko: { id: string; name: string }[] }) {
  const t = useTranslations("barangHilang");
  const td = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [kunci, setKunci] = useState(() => newLocalId());
  const [storeId, setStoreId] = useState(TANPA_TOKO);
  const [cari, setCari] = useState("");
  const [hasil, setHasil] = useState<BarangHilangCari[]>([]);
  const [mencari, mulaiCari] = useTransition();
  const [baris, setBaris] = useState<Baris[]>([]);
  const [catatan, setCatatan] = useState("");
  const [sibuk, mulai] = useTransition();

  useEffect(() => {
    const q = cari.trim();
    if (q.length < 2) return;
    // Jawaban untuk ketikan yang sudah diganti diabaikan.
    let usang = false;
    const jeda = setTimeout(() => {
      mulaiCari(async () => {
        const r = await cariBarangHilangAction(q);
        if (usang) return;
        if (r.ok) setHasil(r.barang);
        else toast.error(td(`err.${r.code}`));
      });
    }, 300);
    return () => {
      usang = true;
      clearTimeout(jeda);
    };
  }, [cari, td]);

  const reset = () => {
    setKunci(newLocalId());
    setStoreId(TANPA_TOKO);
    setCari("");
    setHasil([]);
    setBaris([]);
    setCatatan("");
  };

  const tambah = (b: BarangHilangCari) => {
    setBaris((xs) => [...xs, { k: newLocalId(), itemId: b.itemId, nama: b.nama, varian: b.varian, variantSku: b.varian[0]?.variantSku ?? "", qty: "1" }]);
    setCari("");
    setHasil([]);
  };

  const qtySah = (s: string) => /^\d+$/.test(s) && Number(s) > 0 && Number(s) <= 100_000;
  const kurang =
    baris.length === 0 ? t("manual.kurangBarang") : baris.some((b) => !qtySah(b.qty)) ? t("manual.kurangJumlah") : catatan.trim() === "" ? t("manual.kurangCatatan") : null;

  const kirim = () =>
    mulai(async () => {
      let r: Awaited<ReturnType<typeof buatBarangHilangAction>>;
      try {
        r = await buatBarangHilangAction({
          storeId: storeId === TANPA_TOKO ? null : storeId,
          baris: baris.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, qty: Number(b.qty) })),
          catatan,
          idempotencyKey: kunci,
        });
      } catch {
        toast.error(t("err.NETWORK"));
        return;
      }
      if (!r.ok) {
        toast.error(td(`err.${r.code}`));
        return;
      }
      toast.success(t("manual.ok"));
      setBuka(false);
      reset();
      router.push(`/backoffice/barang-hilang/${r.id}`);
    });

  const hasilTampil = cari.trim().length >= 2 ? hasil : [];

  return (
    <Dialog
      open={buka}
      onOpenChange={(o) => {
        setBuka(o);
        if (!o && !sibuk) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1.5 h-4 w-4" />
          {t("manual.tombol")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("manual.judul")}</DialogTitle>
          <DialogDescription>{t("manual.deskripsi")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hilang-toko">{t("manual.toko")}</Label>
            <SearchableCombobox
              id="hilang-toko"
              options={[{ value: TANPA_TOKO, label: t("manual.tanpaToko") }, ...toko.map((x) => ({ value: x.id, label: x.name }))]}
              value={storeId}
              onValueChange={(v) => setStoreId(v || TANPA_TOKO)}
              placeholder={t("manual.pilihToko")}
              searchPlaceholder={t("manual.cariToko")}
              emptyMessage={t("manual.tokoKosong")}
              triggerClassName="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hilang-cari">{t("manual.barang")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input id="hilang-cari" value={cari} onChange={(e) => setCari(e.target.value)} placeholder={t("manual.cariBarang")} className="pl-8" />
              {mencari ? <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>
            {hasilTampil.length > 0 ? (
              <ul className="max-h-48 overflow-y-auto rounded-md border">
                {hasilTampil.map((b) => (
                  <li key={b.itemId}>
                    <Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left" onClick={() => tambah(b)}>
                      <span>
                        <span className="block font-medium">{b.nama}</span>
                        <span className="block text-xs text-muted-foreground">{b.sku}</span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {baris.length > 0 ? (
            <ul className="space-y-2">
              {baris.map((b) => (
                <li key={b.k} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <span className="min-w-[10rem] flex-1 text-sm font-medium">{b.nama}</span>
                  {b.varian.length > 1 || b.varian[0]?.variantSku ? (
                    <Select value={b.variantSku} onValueChange={(v) => setBaris((xs) => xs.map((x) => (x.k === b.k ? { ...x, variantSku: v } : x)))}>
                      <SelectTrigger className="w-44" aria-label={t("manual.varian")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {b.varian.map((v) => (
                          <SelectItem key={v.variantSku} value={v.variantSku}>
                            {v.label ?? v.variantSku}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Input
                    inputMode="numeric"
                    aria-label={t("manual.jumlah")}
                    value={b.qty}
                    onChange={(e) => setBaris((xs) => xs.map((x) => (x.k === b.k ? { ...x, qty: e.target.value.replace(/[^\d]/g, "").slice(0, 6) } : x)))}
                    className="w-20 text-right"
                    aria-invalid={!qtySah(b.qty)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("manual.hapusBaris")}
                    onClick={() => setBaris((xs) => xs.filter((x) => x.k !== b.k))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="hilang-catatan">{t("manual.catatan")}</Label>
            <Textarea
              id="hilang-catatan"
              value={catatan}
              maxLength={BATAS_TEKS_HILANG}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder={t("manual.catatanContoh")}
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("manual.nilaiCatatan")}</p>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {kurang ? <p className="text-xs text-muted-foreground sm:mr-auto">{kurang}</p> : null}
          <Button onClick={kirim} disabled={sibuk || kurang !== null}>
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {t("manual.simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
