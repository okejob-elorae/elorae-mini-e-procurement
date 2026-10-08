"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
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
import { labelPemasok } from "@/lib/suppliers/label-pemasok";
import { SEMUA_KANAL_JURNAL, LABEL_KANAL_JURNAL, type KanalJurnal } from "@/lib/finance/journals/kanal";
import { bacaJenisPotongPemasok, INFO_POTONG_PEMASOK, SEMUA_JENIS_POTONG_PEMASOK, type JenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { bacaRupiahSen, hitungVoucher, type BarisVoucherSah, type JenisVoucher } from "@/lib/finance/kas/aturan";
import type { TarifPajakKreatif } from "@/lib/creative/pph";
import type { RekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import type { KategoriTampil } from "@/lib/finance/kas/kategori-writer";
import type { AkunPilihan } from "@/lib/finance/kas/voucher-queries";
import { catatVoucherAction } from "@/app/actions/finance-kas";
import { UnggahBukti } from "../_bersama/UnggahBukti";
import { pesanGalatKas } from "../_bersama/pesan-kas";

type Props = {
  jenisAwal: JenisVoucher;
  rekening: RekeningKasBank[];
  kategori: KategoriTampil[];
  akun: AkunPilihan[];
  pemasok: Array<{ id: string; kode: string; nama: string; jenisPotong: string | null; adaNpwp: boolean }>;
  tarif: TarifPajakKreatif;
  hariIni: string;
};

type BarisIsian = { kunci: string; pilih: string; jumlah: string; memo: string; kanal: string; kena: boolean };

const TANPA = "__tanpa__";
const barisKosong = (): BarisIsian => ({ kunci: newLocalId(), pilih: "", jumlah: "", memo: "", kanal: TANPA, kena: false });

export function FormVoucher({ jenisAwal, rekening, kategori, akun, pemasok, tarif, hariIni }: Props) {
  const t = useTranslations("financeKas");
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [jenis, setJenis] = useState<JenisVoucher>(jenisAwal);
  const [tanggal, setTanggal] = useState(hariIni);
  const [rekeningId, setRekeningId] = useState(rekening[0]?.id ?? "");
  const [tujuanId, setTujuanId] = useState("");
  const [jumlahTransfer, setJumlahTransfer] = useState("");
  const [pihak, setPihak] = useState("");
  const [pemasokId, setPemasokId] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [baris, setBaris] = useState<BarisIsian[]>(() => [barisKosong()]);
  const [potong, setPotong] = useState<string>(TANPA);
  const [adaNpwp, setAdaNpwp] = useState(true);
  const [foto, setFoto] = useState<string | null>(null);
  const [kunci, setKunci] = useState(() => newLocalId());

  const kategoriJenis = kategori.filter((k) => k.jenis === jenis);
  const opsi = [
    ...kategoriJenis.map((k) => ({ value: `k:${k.id}`, label: `${k.nama} — ${k.akunKode} ${k.akunNama}` })),
    ...akun.map((a) => ({ value: `a:${a.id}`, label: `${a.kode} · ${a.nama}` })),
  ];
  const kategoriDari = (pilih: string) => (pilih.startsWith("k:") ? kategori.find((k) => k.id === pilih.slice(2)) ?? null : null);

  const ubahBaris = (kunciBaris: string, ubah: Partial<BarisIsian>) => setBaris((bs) => bs.map((b) => (b.kunci === kunciBaris ? { ...b, ...ubah } : b)));

  const pilihAkun = (kunciBaris: string, pilih: string) => {
    const k = kategoriDari(pilih);
    ubahBaris(kunciBaris, { pilih, ...(k?.jenisPotong ? { kena: true } : {}) });
    // Kategori berpotongan (mis. Sewa → PPh 4(2)) mengisi jenis potongan bila belum dipilih.
    const j = bacaJenisPotongPemasok(k?.jenisPotong);
    if (jenis === "OUT" && j && potong === TANPA) setPotong(j);
  };

  const pilihPemasok = (id: string) => {
    setPemasokId(id);
    const p = pemasok.find((x) => x.id === id);
    if (!p) return;
    if (!pihak.trim()) setPihak(p.nama);
    setAdaNpwp(p.adaNpwp);
    const j = bacaJenisPotongPemasok(p.jenisPotong);
    if (j && jenis === "OUT") setPotong(j);
  };

  const jenisPotong: JenisPotongPemasok | null = jenis === "OUT" && potong !== TANPA ? bacaJenisPotongPemasok(potong) : null;
  const barisSah: Pick<BarisVoucherSah, "sen" | "kenaPotong">[] = [];
  let barisSalah = false;
  for (const b of baris) {
    const s = bacaRupiahSen(b.jumlah);
    if (!b.pilih || s == null || s <= 0) barisSalah = true;
    else barisSah.push({ sen: s, kenaPotong: b.kena || Boolean(kategoriDari(b.pilih)?.jenisPotong && bacaJenisPotongPemasok(kategoriDari(b.pilih)?.jenisPotong) === jenisPotong) });
  }
  const totalSen = jenis === "TRANSFER" ? (bacaRupiahSen(jumlahTransfer) ?? 0) : barisSah.reduce((s, b) => s + b.sen, 0);
  const hitung = hitungVoucher(
    { jenis, baris: barisSah.map((b) => ({ ...b, kategoriId: null, akunId: null, memo: null, kanal: null, tokoId: null })), totalSen, jenisPotong, adaNpwp },
    tarif,
  );

  const alasan = !rekeningId
    ? t("form.alasan.rekening")
    : jenis === "TRANSFER"
      ? !tujuanId
        ? t("form.alasan.tujuan")
        : tujuanId === rekeningId
          ? t("form.alasan.tujuanSama")
          : totalSen <= 0
            ? t("form.alasan.jumlah")
            : null
      : barisSalah
        ? t("form.alasan.baris")
        : null;

  const simpan = () =>
    mulai(async () => {
      const r = await catatVoucherAction({
        jenis,
        tanggal,
        rekeningId,
        rekeningTujuanId: jenis === "TRANSFER" ? tujuanId : null,
        jumlahTransfer: jenis === "TRANSFER" ? jumlahTransfer : null,
        pihak: pihak || null,
        pemasokId: jenis === "OUT" && pemasokId ? pemasokId : null,
        keterangan: keterangan || null,
        fotoUrl: foto,
        jenisPotong: jenisPotong ?? null,
        adaNpwp,
        baris:
          jenis === "TRANSFER"
            ? []
            : baris.map((b) => ({
                kategoriId: b.pilih.startsWith("k:") ? b.pilih.slice(2) : null,
                akunId: b.pilih.startsWith("a:") ? b.pilih.slice(2) : null,
                jumlah: b.jumlah,
                memo: b.memo || null,
                kanal: b.kanal === TANPA ? null : b.kanal,
                kenaPotong: b.kena,
              })),
        idempotencyKey: kunci,
      });
      if (!r.ok) return void toast.error(pesanGalatKas(t as unknown as Parameters<typeof pesanGalatKas>[0], r));
      toast.success(r.ulang ? t("form.sudahTercatat", { nomor: r.nomor }) : t("form.tersimpan", { nomor: r.nomor }));
      setKunci(newLocalId());
      router.push(`/backoffice/finance/kas/${r.id}`);
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(`form.judul.${jenis}`)}
        actions={
          <Link href="/backoffice/finance/kas">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("kembali")}
            </Button>
          </Link>
        }
      />

      <Card className="py-0">
        <CardContent className="grid gap-4 py-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("form.jenis")}</Label>
            <Select value={jenis} onValueChange={(v) => setJenis(v as JenisVoucher)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["OUT", "IN", "TRANSFER"] as const).map((j) => (
                  <SelectItem key={j} value={j}>
                    {t(`jenis.${j}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tanggal-voucher">{t("form.tanggal")}</Label>
            <TanggalInput id="tanggal-voucher" value={tanggal} max={hariIni} required onChange={(e) => setTanggal(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{jenis === "TRANSFER" ? t("form.rekeningAsal") : jenis === "OUT" ? t("form.rekeningKeluar") : t("form.rekeningMasuk")}</Label>
            <Select value={rekeningId} onValueChange={setRekeningId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("form.pilihRekening")} />
              </SelectTrigger>
              <SelectContent>
                {rekening.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.nama} ({r.kode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rekening.length === 0 && <p className="text-xs text-destructive">{t("form.tanpaRekening")}</p>}
          </div>
          {jenis === "TRANSFER" ? (
            <>
              <div className="space-y-2">
                <Label>{t("form.rekeningTujuan")}</Label>
                <Select value={tujuanId} onValueChange={setTujuanId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("form.pilihRekening")} />
                  </SelectTrigger>
                  <SelectContent>
                    {rekening
                      .filter((r) => r.id !== rekeningId)
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.nama} ({r.kode})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="jumlah-transfer">{t("form.jumlah")}</Label>
                <Input id="jumlah-transfer" inputMode="decimal" value={jumlahTransfer} onChange={(e) => setJumlahTransfer(e.target.value)} className="text-right tabular-nums" />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="pihak">{jenis === "OUT" ? t("form.dibayarKe") : t("form.diterimaDari")}</Label>
                <Input id="pihak" value={pihak} onChange={(e) => setPihak(e.target.value)} maxLength={191} />
              </div>
              {jenis === "OUT" && (
                <div className="space-y-2">
                  <Label>{t("form.pemasok")}</Label>
                  <SearchableCombobox
                    options={[{ value: TANPA, label: t("form.tanpaPemasok") }, ...pemasok.map((p) => ({ value: p.id, label: labelPemasok({ code: p.kode, name: p.nama }) }))]}
                    value={pemasokId || TANPA}
                    onValueChange={(v) => pilihPemasok(v === TANPA ? "" : v)}
                    triggerClassName="w-full"
                  />
                </div>
              )}
            </>
          )}
          <div className="space-y-2 md:col-span-2 xl:col-span-3">
            <Label htmlFor="keterangan">{t("form.keterangan")}</Label>
            <Textarea id="keterangan" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} maxLength={1000} rows={2} />
          </div>
        </CardContent>
      </Card>

      {jenis !== "TRANSFER" && (
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>{t("form.barisJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-6">
            {kategoriJenis.length === 0 && <p className="text-xs text-muted-foreground">{t("form.tanpaKategori")}</p>}
            {jenis === "OUT" && <p className="text-xs text-muted-foreground">{t("form.catatanAlur")}</p>}
            {baris.map((b, i) => (
              <div key={b.kunci} className="grid gap-2 rounded-md border p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-end">
                <div className="space-y-1">
                  <Label className="text-xs">{t("form.akunAtauKategori", { no: i + 1 })}</Label>
                  <SearchableCombobox options={opsi} value={b.pilih} onValueChange={(v) => pilihAkun(b.kunci, v)} placeholder={t("form.pilihAkun")} triggerClassName="w-full" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("form.jumlah")}</Label>
                  <Input inputMode="decimal" value={b.jumlah} onChange={(e) => ubahBaris(b.kunci, { jumlah: e.target.value })} className="text-right tabular-nums" aria-label={t("form.jumlahBaris", { no: i + 1 })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("form.memo")}</Label>
                  <Input value={b.memo} onChange={(e) => ubahBaris(b.kunci, { memo: e.target.value })} maxLength={191} aria-label={t("form.memoBaris", { no: i + 1 })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("form.kanal")}</Label>
                  <Select value={b.kanal} onValueChange={(v) => ubahBaris(b.kunci, { kanal: v })}>
                    <SelectTrigger className="w-full" aria-label={t("form.kanalBaris", { no: i + 1 })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TANPA}>{t("form.tanpaKanal")}</SelectItem>
                      {SEMUA_KANAL_JURNAL.map((k: KanalJurnal) => (
                        <SelectItem key={k} value={k}>
                          {LABEL_KANAL_JURNAL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  {jenisPotong && (
                    <label className="flex items-center gap-1.5 text-xs">
                      <Checkbox checked={b.kena} onCheckedChange={(v) => ubahBaris(b.kunci, { kena: v === true })} />
                      {t("form.kenaPotong")}
                    </label>
                  )}
                  <Button type="button" variant="ghost" size="icon" disabled={baris.length === 1} onClick={() => setBaris((bs) => bs.filter((x) => x.kunci !== b.kunci))} aria-label={t("form.hapusBaris", { no: i + 1 })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setBaris((bs) => [...bs, barisKosong()])}>
              <Plus className="mr-1 h-4 w-4" />
              {t("form.tambahBaris")}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {jenis === "OUT" ? (
          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle>{t("form.potongJudul")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pb-6">
              <Select value={potong} onValueChange={setPotong}>
                <SelectTrigger className="w-full" aria-label={t("form.potongJudul")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TANPA}>{t("form.tanpaPotong")}</SelectItem>
                  {SEMUA_JENIS_POTONG_PEMASOK.map((j) => (
                    <SelectItem key={j} value={j}>
                      {INFO_POTONG_PEMASOK[j].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {jenisPotong && (
                <>
                  <p className="text-xs text-muted-foreground">{INFO_POTONG_PEMASOK[jenisPotong].keterangan}</p>
                  {jenisPotong !== "PPH4_2" && (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={adaNpwp} onCheckedChange={(v) => setAdaNpwp(v === true)} />
                      {t("form.adaNpwp")}
                    </label>
                  )}
                  <p className="text-xs text-muted-foreground">{t("form.dasarPotongInfo", { nilai: formatRupiah(hitung.dasarPotongSen / 100) })}</p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="hidden lg:block" />
        )}
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>{t("form.ringkasan")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-6 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("form.total")}</span>
              <span className="tabular-nums">{formatRupiah(hitung.totalSen / 100)}</span>
            </div>
            {jenis === "OUT" && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t("form.potongan")}</span>
                <span className="tabular-nums">{hitung.potongSen > 0 ? `− ${formatRupiah(hitung.potongSen / 100)}` : "–"}</span>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t pt-2 font-semibold">
              <span>{jenis === "IN" ? t("form.netoMasuk") : t("form.netoKeluar")}</span>
              <span className="tabular-nums">{formatRupiah(hitung.netoSen / 100)}</span>
            </div>
            <div className="space-y-2 pt-3">
              <Label>{t("form.bukti")}</Label>
              <UnggahBukti value={foto} onChange={setFoto} disabled={pending} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col items-end gap-1">
        <Button onClick={simpan} disabled={pending || alasan != null}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("form.simpan")}
        </Button>
        {alasan && <p className="text-xs text-muted-foreground">{alasan}</p>}
      </div>
    </div>
  );
}
