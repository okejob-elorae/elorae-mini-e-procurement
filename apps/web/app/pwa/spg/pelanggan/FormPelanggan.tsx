"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { tambahPelangganAction, ubahPelangganAction, type HasilPelangganAksi } from "@/app/actions/spg-pelanggan";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import { BATAS_CATATAN_PELANGGAN, BATAS_NAMA_PELANGGAN, rapikanNamaPelanggan } from "@/lib/spg/pelanggan";

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "NO_ASSIGNED_STORE",
  "VALIDATION",
  "NAMA_WAJIB",
  "NAMA_TERLALU_PANJANG",
  "HP_TIDAK_VALID",
  "PERSETUJUAN_WAJIB",
  "CATATAN_TERLALU_PANJANG",
  "TIDAK_DITEMUKAN",
]);

export type AwalPelanggan = { id: string; nama: string; hp: string; catatan: string | null };

/**
 * Tambah atau ubah pelanggan toko. Nomor HP yang sudah terdaftar di toko ini
 * tidak membuat pelanggan kedua — layar membuka pelanggan yang sudah ada.
 * Persetujuan dihubungi lewat WhatsApp wajib untuk pelanggan baru dan untuk
 * nomor yang diganti (persetujuan diberikan pemilik nomornya).
 */
export function FormPelanggan({ namaToko, awal }: { namaToko: string; awal: AwalPelanggan | null }) {
  const t = useTranslations("spgPelanggan");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [nama, setNama] = useState(awal?.nama ?? "");
  const [hp, setHp] = useState(awal?.hp ?? "");
  const [catatan, setCatatan] = useState(awal?.catatan ?? "");
  const [setuju, setSetuju] = useState(false);
  const [dipakai, setDipakai] = useState<{ id: string; nama: string } | null>(null);

  const hpSah = nomorWhatsApp(hp);
  const gantiNomor = awal ? hpSah !== nomorWhatsApp(awal.hp) : true;
  const butuhSetuju = !awal || gantiNomor;
  const hpSalah = hp.trim() !== "" && !hpSah;

  const kurang = pending
    ? null
    : !rapikanNamaPelanggan(nama)
      ? t("form.kurangNama")
      : !hpSah
        ? t("form.kurangHp")
        : butuhSetuju && !setuju
          ? t("form.kurangSetuju")
          : null;

  function simpan() {
    if (kurang) return;
    setDipakai(null);
    mulai(async () => {
      let r: HasilPelangganAksi;
      try {
        const isi = { nama, hp, catatan, setuju: butuhSetuju ? setuju : undefined };
        r = awal ? await ubahPelangganAction({ id: awal.id, ...isi }) : await tambahPelangganAction(isi);
      } catch {
        toast.error(t("err.GENERIC"));
        return;
      }
      if (!r.ok) {
        if (r.code === "HP_DIPAKAI" && r.idLain) {
          setDipakai({ id: r.idLain, nama: r.namaLain ?? "" });
          return;
        }
        toast.error(KODE_GALAT.has(r.code) ? td(`err.${r.code}`) : t("err.GENERIC"));
        return;
      }
      if (r.sudahAda) toast.info(t("form.sudahAda", { nama: r.nama ?? "" }));
      else toast.success(awal ? t("form.okUbah") : t("form.okTambah"));
      router.replace(`/pwa/spg/pelanggan/${r.id}`);
    });
  }

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan={awal ? `/pwa/spg/pelanggan/${awal.id}` : "/pwa/spg/pelanggan"} />
      </Button>
      <header>
        <h1 className="text-2xl font-bold">{awal ? t("form.judulUbah") : t("form.judulBaru")}</h1>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
      </header>

      <section className="beranda-kartu space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pelanggan-nama">{t("form.nama")}</Label>
          <Input
            id="pelanggan-nama"
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            maxLength={BATAS_NAMA_PELANGGAN}
            autoComplete="off"
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pelanggan-hp">{t("form.hp")}</Label>
          <Input
            id="pelanggan-hp"
            type="tel"
            inputMode="tel"
            value={hp}
            onChange={(e) => {
              setHp(e.target.value);
              setDipakai(null);
            }}
            placeholder="0812…"
            autoComplete="off"
            aria-invalid={hpSalah}
            disabled={pending}
          />
          <p className={hpSalah ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{hpSalah ? t("form.hpSalah") : t("form.hpPetunjuk")}</p>
          {dipakai ? (
            <div className="space-y-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <p>{t("form.hpDipakai", { nama: dipakai.nama })}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/pwa/spg/pelanggan/${dipakai.id}`}>{t("form.bukaPelangganLain")}</Link>
              </Button>
            </div>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pelanggan-catatan">{t("form.catatan")}</Label>
          <Textarea
            id="pelanggan-catatan"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            maxLength={BATAS_CATATAN_PELANGGAN}
            rows={3}
            placeholder={t("form.catatanContoh")}
            disabled={pending}
          />
        </div>
        {butuhSetuju ? (
          <label htmlFor="pelanggan-setuju" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <Checkbox id="pelanggan-setuju" checked={setuju} onCheckedChange={(v) => setSetuju(v === true)} disabled={pending} className="mt-0.5" />
            <span className="min-w-0 space-y-0.5">
              <span className="block text-sm font-medium leading-tight">{t("form.setuju")}</span>
              <span className="block text-xs text-muted-foreground">{awal ? t("form.setujuGanti") : t("form.setujuPetunjuk")}</span>
            </span>
          </label>
        ) : null}

        <Button type="button" size="lg" className="w-full" onClick={simpan} disabled={pending || kurang !== null}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {pending ? t("form.menyimpan") : awal ? t("form.simpanUbah") : t("form.simpanBaru")}
        </Button>
        <KeteranganKirim teks={kurang} />
      </section>
    </div>
  );
}
