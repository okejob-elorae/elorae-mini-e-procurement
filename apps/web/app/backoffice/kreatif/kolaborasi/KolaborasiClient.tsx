"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Handshake, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PilihTampilan } from "@/components/tampilan/PilihTampilan";
import { LABEL_PLATFORM, SEMUA_PLATFORM, type Platform } from "@/lib/creative/aturan";
import type { PilihanCampaign } from "@/lib/creative/campaign-queries";
import {
  adaSaringan,
  alamatKolaborasi,
  TAHAP_KELUAR,
  TAMPILAN_KOLABORASI,
  type ParamKolaborasi,
  type SaringTahap,
  type TampilanKolaborasi,
} from "@/lib/creative/kolaborasi-param";
import type { DaftarKolaborasi, PilihanPengguna } from "@/lib/creative/kolaborasi-queries";
import { isJalurKeluar, SEMUA_TAHAP, URUTAN_TAHAP, type Tahap } from "@/lib/creative/tahap";
import { dinamis } from "@/lib/i18n/dinamis";
import { ambilTampilanTersimpan, ingatTampilan, kunciSimpanTampilan, type JenisTampilan } from "@/lib/tampilan/tampilan";
import { cn } from "@/lib/utils";
import { DialogAlasanPindah } from "./DialogAlasanPindah";
import { DialogKolaborasi } from "./DialogKolaborasi";
import { DialogMasukkanCampaign } from "./DialogMasukkanCampaign";
import { PapanKolaborasi } from "./PapanKolaborasi";
import { TabelKolaborasi } from "./TabelKolaborasi";
import { usePindahTahap, type SasaranPindah } from "./usePindahTahap";

const SEMUA = "__semua__";

type Props = {
  param: ParamKolaborasi;
  data: DaftarKolaborasi;
  campaigns: PilihanCampaign[];
  pics: PilihanPengguna[];
  hariIni: string;
  bolehMengelola: boolean;
  userId: string;
  tampilanDariAlamat: boolean;
};

/**
 * Daftar Kolaborasi: chip tahap ber-angka, cari, saring campaign/platform/PIC,
 * Tabel atau Papan (pilihan diingat per orang), pilih banyak → ubah tahap /
 * masukkan ke campaign. Semua keadaan ada di alamat (`router.replace`, jadi
 * tombol Kembali tidak berjalan mundur melewati setiap saringan).
 */
export function KolaborasiClient({ param, data, campaigns, pics, hariIni, bolehMengelola, userId, tampilanDariAlamat }: Props) {
  const t = useTranslations("kreatifRuang");
  const tk = dinamis(t);
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();
  const [cari, setCari] = useState(param.cari);
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [dialogBaru, setDialogBaru] = useState(false);
  const [dialogCampaign, setDialogCampaign] = useState(false);
  const pindah = usePindahTahap(data);
  const kunciTampilan = kunciSimpanTampilan("kolaborasi", userId);

  // Pilihan hilang saat daftar berganti (halaman, saringan, atau sesudah simpan).
  const [dataTerakhir, setDataTerakhir] = useState(data);
  if (dataTerakhir !== data) {
    setDataTerakhir(data);
    const ada = new Set(data.baris.map((b) => b.id));
    setDipilih((l) => new Set([...l].filter((id) => ada.has(id))));
  }

  const pergi = (ubah: Partial<ParamKolaborasi>) =>
    mulaiPindah(() => router.replace(alamatKolaborasi({ ...param, ...ubah }), { scroll: false }));

  // Kotak cari ditunda sebentar supaya tidak memuat ulang di setiap ketukan.
  useEffect(() => {
    if (cari.trim() === param.cari.trim()) return;
    const pewaktu = setTimeout(() => pergi({ cari, halaman: 1 }), 350);
    return () => clearTimeout(pewaktu);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pergi membaca param terbaru
  }, [cari]);

  // Tampilan tersimpan di perangkat ini, kecuali alamat sudah memilih sendiri.
  useEffect(() => {
    if (tampilanDariAlamat) return;
    let simpanan: Storage | null = null;
    try {
      simpanan = window.localStorage;
    } catch {
      simpanan = null;
    }
    const tersimpan = ambilTampilanTersimpan(simpanan, kunciTampilan, TAMPILAN_KOLABORASI);
    if (tersimpan && tersimpan !== param.tampilan) pergi({ tampilan: tersimpan as TampilanKolaborasi });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali saat halaman dibuka
  }, []);

  const ubahTampilan = (v: JenisTampilan) => {
    try {
      ingatTampilan(window.localStorage, kunciTampilan, v);
    } catch {
      // Hanya kenyamanan.
    }
    setDipilih(new Set());
    pergi({ tampilan: v as TampilanKolaborasi, halaman: 1 });
  };

  const terpilih = data.baris.filter((b) => dipilih.has(b.id));
  const sasaranTerpilih: SasaranPindah[] = terpilih.map((b) => ({
    id: b.id,
    tahap: pindah.tahapDari(b.id, b.tahap),
    kolNama: b.kol.name,
  }));
  const ubahPilih = (ids: string[], pilih: boolean) =>
    setDipilih((l) => {
      const baru = new Set(l);
      for (const id of ids) {
        if (pilih) baru.add(id);
        else baru.delete(id);
      }
      return baru;
    });

  const opsiCampaign = [
    { value: SEMUA, label: t("kolaborasi.semuaCampaign") },
    ...campaigns.map((c) => ({ value: c.id, label: c.arsip ? `${c.name} (${t("campaign.arsip")})` : c.name })),
  ];
  const papan = param.tampilan === "papan";
  const saringanAda = adaSaringan(param);

  const chip = (nilai: SaringTahap, label: string, n: number) => {
    const aktif = param.tahap === nilai;
    return (
      <button
        key={nilai ?? "semua"}
        type="button"
        aria-pressed={aktif}
        onClick={() => pergi({ tahap: nilai, halaman: 1 })}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          aktif ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
          !aktif && n === 0 && "text-muted-foreground",
        )}
      >
        {label}
        <span className={cn("tabular-nums text-xs", aktif ? "opacity-90" : "text-muted-foreground")}>{n}</span>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.kolaborasi")}
        meta={t("kolaborasi.meta", { n: data.jumlah.semua })}
        actions={
          <>
            <PilihTampilan nilai={param.tampilan} pilihan={TAMPILAN_KOLABORASI} onUbah={ubahTampilan} />
            {bolehMengelola ? (
              <Button onClick={() => setDialogBaru(true)}>
                <Plus className="mr-1 h-4 w-4" />
                {t("kolaborasi.baru")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative w-full lg:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder={t("kolaborasi.cari")} className="pl-9" aria-label={t("kolaborasi.cari")} />
        </div>
        <SearchableCombobox
          options={opsiCampaign}
          value={param.campaign ?? SEMUA}
          onValueChange={(v) => pergi({ campaign: v && v !== SEMUA ? v : null, halaman: 1 })}
          placeholder={t("kolaborasi.semuaCampaign")}
          searchPlaceholder={t("kolaborasi.cariCampaign")}
          emptyMessage={t("kolaborasi.campaignTidakAda")}
          triggerClassName="w-full lg:w-56"
        />
        <Select value={param.platform ?? SEMUA} onValueChange={(v) => pergi({ platform: v === SEMUA ? null : (v as Platform), halaman: 1 })}>
          <SelectTrigger className="w-full lg:w-40" aria-label={t("kolaborasi.semuaPlatform")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("kolaborasi.semuaPlatform")}</SelectItem>
            {SEMUA_PLATFORM.map((p) => (
              <SelectItem key={p} value={p}>
                {LABEL_PLATFORM[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={param.pic ?? SEMUA} onValueChange={(v) => pergi({ pic: v === SEMUA ? null : v, halaman: 1 })}>
          <SelectTrigger className="w-full lg:w-44" aria-label={t("kolaborasi.semuaPic")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("kolaborasi.semuaPic")}</SelectItem>
            {pics.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {saringanAda ? (
          <Button
            variant="ghost"
            onClick={() => {
              setCari("");
              pergi({ campaign: null, platform: null, pic: null, cari: "", halaman: 1 });
            }}
          >
            <X className="mr-1 h-4 w-4" />
            {t("kolaborasi.reset")}
          </Button>
        ) : null}
      </div>

      {!papan ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("kolaborasi.chipLabel")}>
          {chip(null, t("kolaborasi.chipSemua"), data.jumlah.semua)}
          {URUTAN_TAHAP.map((x) => chip(x, tk(`tahap.${x}`), data.jumlah.perTahap[x]))}
          {chip(TAHAP_KELUAR, t("kolaborasi.chipKeluar"), data.jumlah.keluar)}
        </div>
      ) : null}

      {bolehMengelola && terpilih.length > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
          <span className="text-sm font-medium tabular-nums">{t("kolaborasi.dipilih", { n: terpilih.length })}</span>
          <Select
            value=""
            onValueChange={(v) => {
              pindah.minta(sasaranTerpilih, v as Tahap);
            }}
          >
            <SelectTrigger size="sm" className="w-56" aria-label={t("kolaborasi.ubahTahapMassal")}>
              <SelectValue placeholder={t("kolaborasi.ubahTahapMassal")} />
            </SelectTrigger>
            <SelectContent>
              {SEMUA_TAHAP.filter((x) => !isJalurKeluar(x)).map((x) => (
                <SelectItem key={x} value={x}>
                  {tk(`tahap.${x}`)}
                </SelectItem>
              ))}
              <SelectSeparator />
              {SEMUA_TAHAP.filter((x) => isJalurKeluar(x)).map((x) => (
                <SelectItem key={x} value={x} className="text-destructive">
                  {tk(`tahap.${x}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setDialogCampaign(true)}>
            {t("kolaborasi.masukkanCampaign")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDipilih(new Set())}>
            {t("kolaborasi.batalPilih")}
          </Button>
        </div>
      ) : null}

      {papan ? (
        <div className={cn("space-y-2", berpindah && "opacity-60 transition-opacity")}>
          {data.terpotong ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t("kolaborasi.papan.terpotong", { n: data.baris.length, total: data.total })}
            </p>
          ) : null}
          <PapanKolaborasi
            baris={data.baris}
            jumlah={data.jumlah}
            hariIni={hariIni}
            bolehMengelola={bolehMengelola}
            tahapDari={pindah.tahapDari}
            onPindah={pindah.minta}
          />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Handshake className="h-5 w-5" aria-hidden />
              {param.tahap === TAHAP_KELUAR
                ? t("kolaborasi.chipKeluar")
                : param.tahap
                  ? tk(`tahap.${param.tahap}`)
                  : t("kolaborasi.kartuJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent className={cn(berpindah && "opacity-60 transition-opacity")}>
            {data.baris.length === 0 ? (
              data.jumlah.semua === 0 && !saringanAda ? (
                <EmptyState
                  icon={Handshake}
                  title={t("kolaborasi.kosongJudul")}
                  description={t("kolaborasi.kosongIsi")}
                  action={
                    bolehMengelola ? (
                      <Button onClick={() => setDialogBaru(true)}>
                        <Plus className="mr-1 h-4 w-4" />
                        {t("kolaborasi.baru")}
                      </Button>
                    ) : undefined
                  }
                />
              ) : saringanAda && data.jumlah.semua === 0 ? (
                <EmptyState icon={Search} title={t("kolaborasi.kosongSaringJudul")} description={t("kolaborasi.kosongSaringIsi")} />
              ) : (
                <EmptyState
                  icon={Handshake}
                  title={t("kolaborasi.kosongTahapJudul")}
                  action={
                    <Button variant="outline" onClick={() => pergi({ tahap: null, halaman: 1 })}>
                      {t("kolaborasi.chipSemua")} · {data.jumlah.semua}
                    </Button>
                  }
                />
              )
            ) : (
              <>
                <TabelKolaborasi
                  baris={data.baris}
                  hariIni={hariIni}
                  bolehMengelola={bolehMengelola}
                  tahapDari={pindah.tahapDari}
                  onPindah={pindah.minta}
                  dipilih={dipilih}
                  onPilih={ubahPilih}
                />
                <Pagination
                  page={data.halaman}
                  totalPages={Math.max(1, Math.ceil(data.total / data.ukuran))}
                  onPageChange={(h) => pergi({ halaman: h })}
                  totalCount={data.total}
                  pageSize={data.ukuran}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      <DialogAlasanPindah tertunda={pindah.tertunda} onBatal={pindah.batalTertunda} onLanjut={pindah.lanjutDenganAlasan} />
      {bolehMengelola ? (
        <>
          <DialogKolaborasi
            buka={dialogBaru}
            onBuka={setDialogBaru}
            campaigns={campaigns}
            pics={pics}
            campaignAwal={param.campaign}
            picAwal={userId}
          />
          <DialogMasukkanCampaign
            buka={dialogCampaign}
            onBuka={setDialogCampaign}
            ids={terpilih.map((b) => b.id)}
            campaigns={campaigns}
            onSelesai={() => setDipilih(new Set())}
          />
        </>
      ) : null}
    </div>
  );
}
