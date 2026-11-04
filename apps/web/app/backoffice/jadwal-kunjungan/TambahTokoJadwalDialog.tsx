"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search } from "lucide-react";
import { cariTokoJadwalAction } from "@/app/actions/jadwal-kunjungan";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAKS_CATATAN_JADWAL, MAKS_TOKO_PER_HARI } from "@/lib/salesman/jadwal";
import type { TokoPilihanJadwal } from "@/lib/salesman/jadwal-queries";
import { cn } from "@/lib/utils";

const SEMUA = "__semua__";

/**
 * Pilih toko untuk satu hari: cari (nama, kode, alamat) dan saring per area;
 * toko yang dipegang sales ini tampil lebih dulu. Toko yang sudah terjadwal di
 * hari itu tampil tapi tidak bisa dipilih. Satu catatan opsional untuk semua
 * toko terpilih.
 */
export function TambahTokoJadwalDialog({
  open,
  onOpenChange,
  salesmanId,
  labelHari,
  sudah,
  area,
  menyimpan,
  onTambah,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  salesmanId: string;
  labelHari: string;
  sudah: string[];
  area: { id: string; kode: string; nama: string }[];
  menyimpan: boolean;
  onTambah: (storeIds: string[], note: string | null) => void;
}) {
  const t = useTranslations("jadwalKunjungan");
  const [q, setQ] = useState("");
  const [areaId, setAreaId] = useState(SEMUA);
  // Hasil disimpan bersama kunci pencariannya: selama kunci sekarang belum
  // punya hasil, layar menunjukkan "mencari" — tanpa setState di badan efek.
  const [dimuat, setDimuat] = useState<{ kunci: string; toko: TokoPilihanJadwal[]; gagal: boolean } | null>(null);
  const [pilih, setPilih] = useState<string[]>([]);
  const [catatan, setCatatan] = useState("");

  const sudahSet = useMemo(() => new Set(sudah), [sudah]);
  const sisa = Math.max(0, MAKS_TOKO_PER_HARI - sudah.length);

  const kunciCari = `${salesmanId}|${areaId}|${q}`;
  const memuat = dimuat?.kunci !== kunciCari;
  const gagal = !memuat && (dimuat?.gagal ?? false);
  const hasil = memuat ? [] : (dimuat?.toko ?? []);

  // Pencarian ke server, ditunda sedikit supaya tidak satu permintaan per ketukan.
  useEffect(() => {
    let batal = false;
    const jeda = setTimeout(async () => {
      const r = await cariTokoJadwalAction({ salesmanId, q, groupId: areaId === SEMUA ? null : areaId }).catch(() => null);
      if (batal) return;
      setDimuat({ kunci: `${salesmanId}|${areaId}|${q}`, toko: r && r.ok ? r.toko : [], gagal: !r || !r.ok });
    }, 250);
    return () => {
      batal = true;
      clearTimeout(jeda);
    };
  }, [salesmanId, q, areaId]);

  const bisaDipilih = hasil.filter((x) => !sudahSet.has(x.id));
  const penuh = pilih.length >= sisa;
  const ubahPilih = (id: string, centang: boolean) =>
    setPilih((p) => (centang ? (p.includes(id) || p.length >= sisa ? p : [...p, id]) : p.filter((x) => x !== id)));
  const pilihSemua = () =>
    setPilih((p) => {
      const tambah = bisaDipilih.map((x) => x.id).filter((id) => !p.includes(id));
      return [...p, ...tambah].slice(0, sisa);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("dialog.judul", { tanggal: labelHari })}</DialogTitle>
          <DialogDescription>{t("dialog.deskripsi", { sisa, maks: MAKS_TOKO_PER_HARI })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("dialog.cari")}
              aria-label={t("dialog.cari")}
              className="pl-9"
              autoFocus
            />
          </div>
          {area.length > 0 ? (
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger className="w-full sm:w-[200px]" aria-label={t("kolom.area")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEMUA}>{t("dialog.semuaArea")}</SelectItem>
                {area.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{t("dialog.terpilih", { count: pilih.length })}</span>
          <div className="flex gap-1">
            {pilih.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setPilih([])}>
                {t("dialog.hapusPilihan")}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={pilihSemua} disabled={bisaDipilih.length === 0 || penuh}>
              {t("dialog.pilihSemua")}
            </Button>
          </div>
        </div>

        <div className="min-h-[12rem] flex-1 overflow-y-auto rounded-md border">
          {memuat ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("dialog.memuat")}
            </p>
          ) : gagal ? (
            <p className="py-10 text-center text-sm text-destructive">{t("err.GAGAL")}</p>
          ) : hasil.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("dialog.kosong")}</p>
          ) : (
            <ul className="divide-y">
              {hasil.map((x) => {
                const ada = sudahSet.has(x.id);
                const dicentang = pilih.includes(x.id);
                const id = `jadwal-toko-${x.id}`;
                return (
                  <li key={x.id} className={cn("flex items-start gap-3 px-3 py-2.5", ada && "opacity-60")}>
                    <Checkbox
                      id={id}
                      checked={ada || dicentang}
                      disabled={ada || (!dicentang && penuh)}
                      onCheckedChange={(v) => ubahPilih(x.id, v === true)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={id} className="flex-1 cursor-pointer flex-col items-start gap-0.5 font-normal">
                      <span className="font-medium">{x.nama}</span>
                      <span className="text-xs text-muted-foreground">
                        {[
                          x.kode,
                          x.area,
                          x.milikSales ? t("dialog.tokoSendiri") : x.pemegang ? t("dialog.dipegang", { nama: x.pemegang }) : t("dialog.tanpaPemegang"),
                          ada ? t("dialog.sudah") : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {x.alamat ? <span className="text-xs text-muted-foreground">{x.alamat}</span> : null}
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {!memuat && hasil.length >= MAKS_TOKO_PER_HARI ? (
          <p className="text-xs text-muted-foreground">{t("dialog.hasilTerbatas", { count: hasil.length })}</p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="jadwal-catatan-baru">{t("dialog.catatan")}</Label>
          <Input
            id="jadwal-catatan-baru"
            value={catatan}
            maxLength={MAKS_CATATAN_JADWAL}
            placeholder={t("catatanPlaceholder")}
            onChange={(e) => setCatatan(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={menyimpan}>
            {t("batal")}
          </Button>
          <Button onClick={() => onTambah(pilih, catatan.trim() === "" ? null : catatan)} disabled={menyimpan || pilih.length === 0}>
            {menyimpan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("dialog.tambahkan", { count: pilih.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
