"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Scale, Trash2 } from "lucide-react";
import { putuskanBarangHilangAction, ubahKeputusanHilangAction } from "@/app/actions/barang-hilang";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import {
  bacaIsianRupiah,
  BATAS_TEKS_HILANG,
  keSen,
  PENANGGUNG,
  penanggungOrang,
  periksaBagian,
  presetBagian,
  terapkanDiskonPegawai,
  tulisIsianRupiah,
  type IsianBagian,
  type JenisPreset,
  type Penanggung,
} from "@/lib/spg/hilang";
import type { RincianHilangKantor } from "@/lib/spg/hilang-queries";
import { formatIDR } from "@/lib/sales-orders/format";
import { cn } from "@/lib/utils";

type Baris = { k: string; bearer: Penanggung; bearerUserId: string; amount: string };
type Orang = { spg: { id: string; nama: string; toko: string | null }[]; sales: { id: string; nama: string }[] };

const PRESET: JenisPreset[] = ["ELORAE", "TOKO", "SPG_TOKO", "SALES_TOKO"];

const keBaris = (b: IsianBagian[]): Baris[] =>
  b.map((x) => ({ k: newLocalId(), bearer: x.bearer, bearerUserId: x.bearerUserId ?? "", amount: tulisIsianRupiah(x.amount) }));

/**
 * Formulir keputusan penanggung: tombol cepat (Elorae / toko / SPG toko ini
 * dibagi rata / sales pemegang toko) atau bagi bebas. Jumlah bagian harus sama
 * dengan total; total boleh diubah dengan alasan. Pemeriksaan di layar memakai
 * aturan murni yang sama dengan server (`periksaBagian`).
 *
 * Keringanan diskon pegawai: baris bagian adalah pembagian SEBELUM keringanan.
 * Kalau dinyalakan, layar menunjukkan hasilnya (`terapkanDiskonPegawai`), tetapi
 * yang dikirim tetap pembagian sebelum keringanan + persennya — server yang
 * menghitung ulang. "Ubah keputusan" mulai dari pembagian sebelum keringanan
 * yang tercatat di jejak, supaya keringanan tidak diterapkan dua kali.
 */
export function KeputusanHilangDialog({
  rincian: r,
  orang,
  mode,
}: {
  rincian: RincianHilangKantor;
  orang: Orang;
  mode: "PUTUSKAN" | "UBAH";
}) {
  const t = useTranslations("barangHilang");
  const td = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [sibuk, mulai] = useTransition();
  const [total, setTotal] = useState(() => tulisIsianRupiah(r.total));
  const ringanLama = mode === "UBAH" ? r.keringanan : null;
  const [baris, setBaris] = useState<Baris[]>(() =>
    mode !== "UBAH"
      ? []
      : ringanLama && ringanLama.sebelum.length > 0
        ? keBaris(ringanLama.sebelum)
        : keBaris(r.bagian.map((b) => ({ bearer: b.bearer, bearerUserId: b.orang?.id ?? null, amount: b.nilai }))),
  );
  const [catatan, setCatatan] = useState("");
  const [ringan, setRingan] = useState(ringanLama !== null);
  // Tanpa persen bawaan: pemilik mengetik persennya sendiri setiap kali.
  const [persenRingan, setPersenRingan] = useState(() => (ringanLama ? String(ringanLama.persen) : ""));

  const totalAngka = bacaIsianRupiah(total);
  const totalBerubah = totalAngka !== null && keSen(totalAngka) !== keSen(r.total);
  const alasanWajib = mode === "UBAH" || totalBerubah;
  const spgIds = r.toko?.spg.map((s) => s.id) ?? [];
  const konteks = { total: totalAngka ?? 0, adaToko: r.toko !== null, spgIds, salesmanId: r.toko?.pemegang?.id ?? null };

  const isian = baris.map((b) => ({ bearer: b.bearer, bearerUserId: penanggungOrang(b.bearer) ? b.bearerUserId || null : null, amount: bacaIsianRupiah(b.amount) ?? NaN }));
  const dibagiSen = isian.reduce((n, b) => n + (Number.isFinite(b.amount) ? keSen(b.amount) : 0), 0);
  const sisaSen = totalAngka === null ? 0 : keSen(totalAngka) - dibagiSen;
  const periksa = totalAngka === null ? null : periksaBagian(isian, totalAngka, r.toko !== null);

  const angkaRingan = persenRingan.trim() === "" ? NaN : Number(persenRingan);
  const persenRinganSah = Number.isInteger(angkaRingan) && angkaRingan >= 1 && angkaRingan <= 100;
  const adaOrang = baris.some((b) => penanggungOrang(b.bearer));
  const hasilRingan = ringan && persenRinganSah && periksa?.ok ? terapkanDiskonPegawai(periksa.bagian, angkaRingan) : null;
  const namaOrang = (id: string | null) =>
    (id && (orang.spg.find((s) => s.id === id)?.nama ?? orang.sales.find((s) => s.id === id)?.nama)) || t("keputusan.orangTanpaNama");

  // Alasan pertama yang membuat tombol simpan nonaktif, menurut urutan formulir.
  const kurang =
    totalAngka === null || totalAngka <= 0
      ? t("keputusan.kurangTotal")
      : baris.length === 0
        ? t("keputusan.kurangBagian")
        : periksa && !periksa.ok
          ? td(`kodeBagian.${periksa.kode}`)
          : ringan && !adaOrang
            ? t("keputusan.kurangRinganOrang")
            : ringan && !persenRinganSah
              ? t("keputusan.kurangRinganPersen")
              : alasanWajib && catatan.trim() === ""
                ? mode === "UBAH"
                  ? t("keputusan.kurangAlasanUbah")
                  : t("keputusan.kurangAlasanTotal")
                : null;

  const pakaiPreset = (p: JenisPreset) => {
    const isi = presetBagian(p, konteks);
    if (isi) setBaris(keBaris(isi));
  };

  const ubahBaris = (k: string, ubah: Partial<Baris>) => setBaris((xs) => xs.map((x) => (x.k === k ? { ...x, ...ubah } : x)));

  const pilihanOrang = (bearer: Penanggung) =>
    bearer === "SPG"
      ? [
          // SPG toko ini lebih dulu.
          ...orang.spg.filter((s) => spgIds.includes(s.id)),
          ...orang.spg.filter((s) => !spgIds.includes(s.id)),
        ].map((s) => ({ value: s.id, label: s.toko ? `${s.nama} · ${s.toko}` : s.nama }))
      : orang.sales.map((s) => ({ value: s.id, label: r.toko?.pemegang?.id === s.id ? `${s.nama} · ${t("keputusan.pemegang")}` : s.nama }));

  const kirim = () =>
    mulai(async () => {
      if (!periksa?.ok || totalAngka === null) return;
      const isi = {
        lossId: r.id,
        bagian: periksa.bagian,
        total: totalAngka,
        catatan: catatan.trim() || null,
        keringananPersen: ringan && persenRinganSah ? angkaRingan : null,
      };
      let h: { ok: true } | { ok: false; code: string };
      try {
        h = mode === "PUTUSKAN" ? await putuskanBarangHilangAction(isi) : await ubahKeputusanHilangAction(isi);
      } catch {
        toast.error(t("err.NETWORK"));
        return;
      }
      if (!h.ok) {
        toast.error(td(`err.${h.code}`));
        if (h.code === "SUDAH_DIPUTUSKAN" || h.code === "BERUBAH" || h.code === "SUDAH_ADA_POTONGAN") router.refresh();
        return;
      }
      toast.success(mode === "PUTUSKAN" ? t("keputusan.okPutuskan") : t("keputusan.okUbah"));
      setBuka(false);
      router.refresh();
    });

  return (
    <Dialog open={buka} onOpenChange={setBuka}>
      <DialogTrigger asChild>
        <Button variant={mode === "PUTUSKAN" ? "default" : "outline"}>
          <Scale className="mr-1.5 h-4 w-4" />
          {mode === "PUTUSKAN" ? t("keputusan.tombolPutuskan") : t("keputusan.tombolUbah")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "PUTUSKAN" ? t("keputusan.judulPutuskan") : t("keputusan.judulUbah")}</DialogTitle>
          <DialogDescription>{t("keputusan.deskripsi")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="hilang-total">{t("keputusan.total")}</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rp</span>
              <Input
                id="hilang-total"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value.replace(/[^\d.,]/g, "").slice(0, 20))}
                className="w-48 text-right tabular-nums"
                aria-invalid={totalAngka === null}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("keputusan.totalIsi", { nilai: formatIDR(r.nilaiBarang) })}
              {totalBerubah ? ` ${t("keputusan.totalBerubah")}` : ""}
            </p>
          </div>

          <div className="space-y-2">
            <Label id="hilang-preset">{t("keputusan.cepat")}</Label>
            <div aria-labelledby="hilang-preset" className="grid gap-2 sm:grid-cols-2">
              {PRESET.map((p) => {
                const bisa = presetBagian(p, konteks) !== null;
                return (
                  <Button key={p} type="button" variant="outline" disabled={!bisa} onClick={() => pakaiPreset(p)} className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2.5 text-left">
                    <span className="font-medium">{td(`preset.${p}`)}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {bisa ? td(`presetIsi.${p}`, { n: spgIds.length, nama: r.toko?.pemegang?.nama ?? "" }) : td(`presetTidak.${p}`)}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>{t("keputusan.bagian")}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setBaris((xs) => [...xs, { k: newLocalId(), bearer: "ELORAE", bearerUserId: "", amount: sisaSen > 0 ? tulisIsianRupiah(sisaSen / 100) : "" }])}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("keputusan.tambahBagian")}
              </Button>
            </div>
            {baris.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t("keputusan.bagianKosong")}</p>
            ) : (
              <ul className="space-y-2">
                {baris.map((b) => (
                  <li key={b.k} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                    <Select value={b.bearer} onValueChange={(v) => ubahBaris(b.k, { bearer: v as Penanggung, bearerUserId: "" })}>
                      <SelectTrigger className="w-36" aria-label={t("keputusan.penanggung")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PENANGGUNG.map((p) => (
                          <SelectItem key={p} value={p} disabled={p === "TOKO" && !r.toko}>
                            {td(`penanggung.${p}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {penanggungOrang(b.bearer) ? (
                      <SearchableCombobox
                        options={pilihanOrang(b.bearer)}
                        value={b.bearerUserId}
                        onValueChange={(v) => ubahBaris(b.k, { bearerUserId: v })}
                        placeholder={t("keputusan.pilihOrang")}
                        searchPlaceholder={t("keputusan.cariOrang")}
                        emptyMessage={t("keputusan.orangKosong")}
                        triggerClassName="w-56"
                      />
                    ) : (
                      <span className="w-56 text-sm text-muted-foreground">{b.bearer === "TOKO" ? r.toko?.name : t("keputusan.hapusBuku")}</span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      <span className="text-sm text-muted-foreground">Rp</span>
                      <Input
                        inputMode="decimal"
                        aria-label={t("keputusan.jumlah")}
                        value={b.amount}
                        onChange={(e) => ubahBaris(b.k, { amount: e.target.value.replace(/[^\d.,]/g, "").slice(0, 20) })}
                        className="w-36 text-right tabular-nums"
                        aria-invalid={bacaIsianRupiah(b.amount) === null}
                      />
                    </span>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("keputusan.hapusBagian")} onClick={() => setBaris((xs) => xs.filter((x) => x.k !== b.k))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {totalAngka !== null && baris.length > 0 ? (
              <p className={cn("text-right text-sm tabular-nums", sisaSen === 0 ? "text-muted-foreground" : "font-medium text-destructive")}>
                {sisaSen === 0
                  ? t("keputusan.pas")
                  : sisaSen > 0
                    ? t("keputusan.belumDibagi", { nilai: formatIDR(sisaSen / 100) })
                    : t("keputusan.lebihDibagi", { nilai: formatIDR(-sisaSen / 100) })}
              </p>
            ) : null}
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="hilang-ringan" className="cursor-pointer">
                  {t("keputusan.ringanLabel")}
                </Label>
                <p className="text-xs text-muted-foreground">{t("keputusan.ringanIsi")}</p>
              </div>
              <Switch id="hilang-ringan" checked={ringan} onCheckedChange={setRingan} />
            </div>
            {ringan ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="hilang-ringan-persen" className="text-sm font-normal">
                    {t("keputusan.ringanPersen")}
                  </Label>
                  <Input
                    id="hilang-ringan-persen"
                    inputMode="numeric"
                    value={persenRingan}
                    onChange={(e) => setPersenRingan(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                    placeholder={t("keputusan.ringanPersenContoh")}
                    autoFocus={!ringanLama}
                    className="w-20 text-right tabular-nums"
                    aria-invalid={persenRingan !== "" && !persenRinganSah}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                {hasilRingan && hasilRingan.diserapSen > 0 ? (
                  <div className="space-y-1 text-sm">
                    <ul className="space-y-0.5 text-muted-foreground">
                      {hasilRingan.perOrang.map((p) => (
                        <li key={`${p.bearer}:${p.bearerUserId ?? ""}`} className="flex flex-wrap justify-between gap-x-3 tabular-nums">
                          <span>
                            {td(`penanggung.${p.bearer}`)} · {namaOrang(p.bearerUserId)}
                          </span>
                          <span>
                            {formatIDR(p.sebelum)} → {formatIDR(p.sesudah)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="font-medium">{t("keputusan.ringanDiserap", { nilai: `Rp ${tulisIsianRupiah(hasilRingan.diserapSen / 100)}` })}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hilang-alasan">{alasanWajib ? t("keputusan.alasanWajib") : t("keputusan.catatanOpsional")}</Label>
            <Textarea id="hilang-alasan" value={catatan} maxLength={BATAS_TEKS_HILANG} onChange={(e) => setCatatan(e.target.value)} rows={3} />
          </div>

          <p className="text-xs text-muted-foreground">{t("keputusan.akibat")}</p>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {kurang ? <p className="text-xs text-muted-foreground sm:mr-auto">{kurang}</p> : null}
          <Button onClick={kirim} disabled={sibuk || kurang !== null}>
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {mode === "PUTUSKAN" ? t("keputusan.simpanPutuskan") : t("keputusan.simpanUbah")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
