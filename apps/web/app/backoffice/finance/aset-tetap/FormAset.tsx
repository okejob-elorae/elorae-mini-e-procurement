"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { ATURAN_KATEGORI, KATEGORI_ASET, METODE_PENYUSUTAN, tarifSaldoMenurunBawaan, type KategoriAset } from "@/lib/finance/aset/kelompok";
import { CARA_PEROLEHAN, periksaIsianAset, type CaraPerolehan, type IsianAset } from "@/lib/finance/aset/aturan";
import { akhirMasaManfaat, akumulasiTargetSampai, jadwalPenyusutan } from "@/lib/finance/aset/jadwal";
import { bacaKunciBulan, bulanSebelum, labelBulan } from "@/lib/finance/periode/periode";
import type { IsianAwalAset, PilihanAkun } from "@/lib/finance/aset/queries";
import { catatAsetAction, ubahAsetAction } from "@/app/actions/finance-aset";
import { pesanGalatAset } from "./pesan";

export type NilaiAwalAset = {
  nama: string;
  kategori: string;
  tanggalPerolehan: string;
  biaya: string;
  nilaiSisa: string;
  umurBulan: string;
  metode: string;
  tarifSaldoMenurun: string;
  mulaiDisusutkan: string;
  akumulasiAwal: string;
  cara: CaraPerolehan;
  akunAsetId: string;
  akunAkumulasiId: string;
  akunBebanId: string;
  lokasi: string;
  pemasokId: string;
  catatan: string;
};

type Props = {
  akun: PilihanAkun[];
  pemasok: Array<{ id: string; nama: string }>;
  hariIni: string;
  /** Mengubah aset yang sudah ada. */
  ubah?: { id: string; kode: string; nilai: NilaiAwalAset; nilaiTerkunci: "SUDAH_DISUSUTKAN" | "ADA_JURNAL_PEROLEHAN" | null };
  /** Aset baru: isian awal dari dokumen yang sudah menjurnal perolehannya (voucher kas / pembayaran pemasok). */
  isiAwal?: IsianAwalAset | null;
};

const TANPA = "__tanpa__";

export function FormAset({ akun, pemasok, hariIni, ubah, isiAwal }: Props) {
  const t = useTranslations("asetTetap");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [kunci] = useState(() => newLocalId());
  const awal: Partial<NilaiAwalAset> | undefined = ubah?.nilai ?? (isiAwal ? { ...isiAwal } : undefined);
  const [nama, setNama] = useState(awal?.nama ?? "");
  const [kategori, setKategori] = useState<KategoriAset>((awal?.kategori as KategoriAset) || "KELOMPOK_1");
  const [tanggal, setTanggal] = useState(awal?.tanggalPerolehan ?? hariIni);
  const [biaya, setBiaya] = useState(awal?.biaya ?? "");
  const [nilaiSisa, setNilaiSisa] = useState(awal?.nilaiSisa ?? "");
  const [umur, setUmur] = useState(awal?.umurBulan ?? "");
  const [metode, setMetode] = useState(awal?.metode ?? METODE_PENYUSUTAN.GARIS_LURUS);
  const [tarif, setTarif] = useState(awal?.tarifSaldoMenurun ?? "");
  const [mulaiTanggal, setMulaiTanggal] = useState(awal?.mulaiDisusutkan ? `${awal.mulaiDisusutkan}-01` : "");
  const [akumulasi, setAkumulasi] = useState(awal?.akumulasiAwal ?? "");
  const [cara, setCara] = useState<CaraPerolehan>(awal?.cara ?? "JURNAL");
  const [akunLawan, setAkunLawan] = useState("");
  const [akunKhusus, setAkunKhusus] = useState(!!(awal?.akunAsetId || awal?.akunAkumulasiId || awal?.akunBebanId));
  const [akunAset, setAkunAset] = useState(awal?.akunAsetId ?? "");
  const [akunAkum, setAkunAkum] = useState(awal?.akunAkumulasiId ?? "");
  const [akunBeban, setAkunBeban] = useState(awal?.akunBebanId ?? "");
  const [lokasi, setLokasi] = useState(awal?.lokasi ?? "");
  const [pemasokId, setPemasokId] = useState(awal?.pemasokId ?? "");
  const [catatan, setCatatan] = useState(awal?.catatan ?? "");

  const aturan = ATURAN_KATEGORI[kategori];
  const terkunci = !!ubah?.nilaiTerkunci;
  const metodeBerlaku = aturan.metodeBoleh.includes(metode as never) ? metode : aturan.metodeBoleh[0];
  const opsiAkun = (tipe: string[]) => akun.filter((a) => tipe.includes(a.tipe)).map((a) => ({ value: a.id, label: `${a.kode} — ${a.nama}` }));
  const opsiAset = useMemo(() => opsiAkun(["ASET"]), [akun]); // eslint-disable-line react-hooks/exhaustive-deps
  const opsiBeban = useMemo(() => opsiAkun(["BEBAN"]), [akun]); // eslint-disable-line react-hooks/exhaustive-deps
  const opsiLawan = useMemo(() => opsiAkun(["ASET", "LIABILITAS"]), [akun]); // eslint-disable-line react-hooks/exhaustive-deps
  const opsiPemasok = useMemo(() => [{ value: TANPA, label: t("form.tanpaPemasok") }, ...pemasok.map((p) => ({ value: p.id, label: p.nama }))], [pemasok, t]);

  const isian: IsianAset = {
    nama,
    kategori,
    tanggalPerolehan: tanggal,
    biaya,
    nilaiSisa: aturan.fiskal ? "" : nilaiSisa,
    umurBulan: aturan.umurBulan == null ? umur : null,
    metode: metodeBerlaku,
    tarifSaldoMenurun: aturan.tarifSaldoMenurun == null && metodeBerlaku === METODE_PENYUSUTAN.SALDO_MENURUN ? tarif : null,
    mulaiDisusutkan: mulaiTanggal ? mulaiTanggal.slice(0, 7) : null,
    akumulasiAwal: cara === "JURNAL" && !ubah ? "" : akumulasi,
    cara: ubah ? "SUDAH_DICATAT" : cara,
    akunLawanId: !ubah && cara === "JURNAL" ? akunLawan : null,
    akunAsetId: akunKhusus ? akunAset || null : null,
    akunAkumulasiId: akunKhusus ? akunAkum || null : null,
    akunBebanId: akunKhusus ? akunBeban || null : null,
    lokasi,
    pemasokId: pemasokId || null,
    catatan,
  };
  const periksa = periksaIsianAset(isian, hariIni);

  const pratinjau = useMemo(() => {
    if (!periksa.ok) return null;
    const a = periksa.aset;
    const spek = { biaya: a.biaya, nilaiSisa: a.nilaiSisa, umurBulan: a.umurBulan, metode: a.metode, tarifSaldoMenurun: a.tarifSaldoMenurun, mulai: a.mulaiDisusutkan };
    const jadwal = jadwalPenyusutan(spek);
    const akhir = akhirMasaManfaat(spek);
    const kini = bacaKunciBulan(hariIni.slice(0, 7));
    const lalu = kini ? bulanSebelum(kini) : null;
    return {
      pertama: jadwal[0]?.jumlah ?? 0,
      akhir: akhir ? labelBulan(akhir, locale) : null,
      jadwalSampaiLalu: lalu ? akumulasiTargetSampai(spek, lalu) : 0,
      labelLalu: lalu ? labelBulan(lalu, locale) : "",
    };
  }, [periksa, hariIni, locale]);

  const kirim = () =>
    mulai(async () => {
      if (!periksa.ok) return;
      const r = ubah ? await ubahAsetAction({ ...isian, id: ubah.id }) : await catatAsetAction({ ...isian, idempotencyKey: kunci });
      if (!r.ok) {
        toast.error(pesanGalatAset(t, r.kode, "peran" in r ? r.peran : undefined));
        return;
      }
      toast.success(ubah ? t("form.tersimpan") : t("form.tercatat"));
      router.push(`/backoffice/finance/aset-tetap/${r.id}`);
      router.refresh();
    });

  const labelMulai = mulaiTanggal ? bacaKunciBulan(mulaiTanggal.slice(0, 7)) : bacaKunciBulan(tanggal.slice(0, 7));

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href={ubah ? `/backoffice/finance/aset-tetap/${ubah.id}` : "/backoffice/finance/aset-tetap"}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>
      <PageHeader title={ubah ? t("form.judulUbah", { kode: ubah.kode }) : t("form.judulBaru")} />

      {terkunci ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{t(`form.terkunci.${ubah!.nilaiTerkunci}`)}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("form.bagianAset")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Bidang label={t("form.nama")} htmlFor="aset-nama">
              <Input id="aset-nama" value={nama} maxLength={191} onChange={(e) => setNama(e.target.value)} disabled={pending} />
            </Bidang>
            <Bidang label={t("form.kelompok")} htmlFor="aset-kelompok" petunjuk={t(`contoh.${kategori}`)}>
              <Select value={kategori} onValueChange={(v) => setKategori(v as KategoriAset)} disabled={pending || terkunci}>
                <SelectTrigger id="aset-kelompok" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KATEGORI_ASET.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`kategori.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Bidang>
            <Bidang label={t("form.tanggalPerolehan")} htmlFor="aset-tanggal">
              <TanggalInput id="aset-tanggal" value={tanggal} max={hariIni} required onChange={(e) => setTanggal(e.target.value)} disabled={pending || terkunci} />
            </Bidang>
            <Bidang label={t("form.biaya")} htmlFor="aset-biaya">
              <Input id="aset-biaya" inputMode="decimal" value={biaya} placeholder="0" onChange={(e) => setBiaya(e.target.value)} disabled={pending || terkunci} className="text-right" />
            </Bidang>
            <Bidang label={t("form.lokasi")} htmlFor="aset-lokasi">
              <Input id="aset-lokasi" value={lokasi} maxLength={191} onChange={(e) => setLokasi(e.target.value)} disabled={pending} />
            </Bidang>
            <Bidang label={t("form.pemasok")} htmlFor="aset-pemasok">
              <SearchableCombobox
                id="aset-pemasok"
                options={opsiPemasok}
                value={pemasokId || TANPA}
                onValueChange={(v) => setPemasokId(v === TANPA ? "" : v)}
                disabled={pending}
                triggerClassName="w-full"
              />
            </Bidang>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("form.bagianPenyusutan")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {kategori === "TANAH" ? (
            <p className="text-sm text-muted-foreground">{t("form.tanahTidakDisusutkan")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Bidang label={t("form.metode")} htmlFor="aset-metode">
                <Select value={metodeBerlaku} onValueChange={setMetode} disabled={pending || terkunci || aturan.metodeBoleh.length < 2}>
                  <SelectTrigger id="aset-metode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {aturan.metodeBoleh.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`metode.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Bidang>
              <Bidang label={t("form.umur")} htmlFor="aset-umur">
                {aturan.umurBulan == null ? (
                  <Input id="aset-umur" inputMode="numeric" value={umur} onChange={(e) => setUmur(e.target.value)} disabled={pending || terkunci} className="text-right" />
                ) : (
                  <p id="aset-umur" className="py-2 text-sm">
                    {t("form.umurTetap", { bulan: aturan.umurBulan, tahun: aturan.umurBulan / 12 })}
                  </p>
                )}
              </Bidang>
              {metodeBerlaku === METODE_PENYUSUTAN.SALDO_MENURUN ? (
                <Bidang label={t("form.tarif")} htmlFor="aset-tarif">
                  {aturan.tarifSaldoMenurun == null ? (
                    <Input
                      id="aset-tarif"
                      inputMode="decimal"
                      value={tarif}
                      placeholder={String(tarifSaldoMenurunBawaan(Number(umur) || 0))}
                      onChange={(e) => setTarif(e.target.value)}
                      disabled={pending || terkunci}
                      className="text-right"
                    />
                  ) : (
                    <p id="aset-tarif" className="py-2 text-sm">
                      {t("form.tarifTetap", { tarif: aturan.tarifSaldoMenurun })}
                    </p>
                  )}
                </Bidang>
              ) : null}
              {!aturan.fiskal ? (
                <Bidang label={t("form.nilaiSisa")} htmlFor="aset-sisa">
                  <Input id="aset-sisa" inputMode="decimal" value={nilaiSisa} placeholder="0" onChange={(e) => setNilaiSisa(e.target.value)} disabled={pending || terkunci} className="text-right" />
                </Bidang>
              ) : null}
              <Bidang label={t("form.mulai")} htmlFor="aset-mulai" petunjuk={labelMulai ? t("form.mulaiBulan", { bulan: labelBulan(labelMulai, locale) }) : undefined}>
                <TanggalInput id="aset-mulai" value={mulaiTanggal} min={tanggal} onChange={(e) => setMulaiTanggal(e.target.value)} disabled={pending || terkunci} />
              </Bidang>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("form.bagianPerolehan")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ubah ? (
            <p className="text-sm">{t(`cara.${ubah.nilai.cara}`)}</p>
          ) : (
            <Bidang label={t("form.cara")} htmlFor="aset-cara">
              <Select value={cara} onValueChange={(v) => setCara(v as CaraPerolehan)} disabled={pending}>
                <SelectTrigger id="aset-cara" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARA_PEROLEHAN.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`cara.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Bidang>
          )}
          {!ubah && cara === "JURNAL" ? (
            <Bidang label={t("form.akunLawan")} htmlFor="aset-lawan">
              <SearchableCombobox id="aset-lawan" options={opsiLawan} value={akunLawan} onValueChange={setAkunLawan} placeholder={t("form.pilihAkun")} disabled={pending} triggerClassName="w-full" />
            </Bidang>
          ) : null}
          {(ubah ? ubah.nilai.cara !== "JURNAL" : cara !== "JURNAL") && kategori !== "TANAH" ? (
            <Bidang label={t("form.akumulasiAwal")} htmlFor="aset-akum">
              <Input id="aset-akum" inputMode="decimal" value={akumulasi} placeholder="0" onChange={(e) => setAkumulasi(e.target.value)} disabled={pending || terkunci} className="text-right" />
            </Bidang>
          ) : null}

          <div className="flex items-center gap-2 pt-2">
            <Checkbox id="aset-akun-khusus" checked={akunKhusus} onCheckedChange={(v) => setAkunKhusus(v === true)} disabled={pending || terkunci} />
            <Label htmlFor="aset-akun-khusus">{t("form.akunKhusus")}</Label>
          </div>
          {akunKhusus ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Bidang label={t("form.akunAset")} htmlFor="aset-akun-aset">
                <SearchableCombobox id="aset-akun-aset" options={opsiAset} value={akunAset} onValueChange={setAkunAset} placeholder={t("form.ikutPeran")} disabled={pending || terkunci} triggerClassName="w-full" />
              </Bidang>
              <Bidang label={t("form.akunAkumulasi")} htmlFor="aset-akun-akum">
                <SearchableCombobox id="aset-akun-akum" options={opsiAset} value={akunAkum} onValueChange={setAkunAkum} placeholder={t("form.ikutPeran")} disabled={pending || terkunci} triggerClassName="w-full" />
              </Bidang>
              <Bidang label={t("form.akunBeban")} htmlFor="aset-akun-beban">
                <SearchableCombobox id="aset-akun-beban" options={opsiBeban} value={akunBeban} onValueChange={setAkunBeban} placeholder={t("form.ikutPeran")} disabled={pending || terkunci} triggerClassName="w-full" />
              </Bidang>
            </div>
          ) : null}

          <Bidang label={t("form.catatan")} htmlFor="aset-catatan">
            <Textarea id="aset-catatan" rows={2} maxLength={2000} value={catatan} onChange={(e) => setCatatan(e.target.value)} disabled={pending} />
          </Bidang>
        </CardContent>
      </Card>

      {pratinjau && kategori !== "TANAH" ? (
        <Card className="py-0">
          <CardContent className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">{t("form.pratinjau.pertama")}</p>
              <p className="font-semibold tabular-nums">{formatRupiah(pratinjau.pertama)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("form.pratinjau.akhir")}</p>
              <p className="font-semibold">{pratinjau.akhir ?? "—"}</p>
            </div>
            {(ubah ? ubah.nilai.cara !== "JURNAL" : cara !== "JURNAL") ? (
              <div>
                <p className="text-muted-foreground">{t("form.pratinjau.jadwalSampai", { bulan: pratinjau.labelLalu })}</p>
                <p className="font-semibold tabular-nums">{formatRupiah(pratinjau.jadwalSampaiLalu)}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        <Button onClick={kirim} disabled={pending || !periksa.ok}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {ubah ? t("form.simpan") : t("form.catat")}
        </Button>
        {!periksa.ok && !pending ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t(`err.${periksa.kode}`)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Bidang({ label, htmlFor, petunjuk, children }: { label: string; htmlFor: string; petunjuk?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {petunjuk ? <p className="text-xs text-muted-foreground">{petunjuk}</p> : null}
    </div>
  );
}
