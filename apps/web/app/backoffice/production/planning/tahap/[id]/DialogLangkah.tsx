"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Textarea } from "@/components/ui/textarea";
import { NAMA_LANGKAH_MAKS } from "@/lib/production/jadwal-jejak";
import type { LangkahRuangKerja } from "@/lib/production/jadwal-queries";
import { tambahLangkahAction, ubahLangkahAction } from "@/app/actions/jadwal-produksi";
import { bacaDurasi } from "./ruang-kerja";
import type { HasilAksi } from "./pakai-aksi";
import type { PemasokPilihan } from "./RuangKerjaClient";

/** Isi dialog: `{ jenis: "tambah" }` untuk langkah baru di akhir, atau langkah yang diubah. */
export type SasaranLangkah = { jenis: "tambah" } | { jenis: "ubah"; langkah: LangkahRuangKerja };

type Props = {
  sasaran: SasaranLangkah | null;
  planStageId: string;
  pemasok: PemasokPilihan[];
  sibuk: boolean;
  jalankan: (aksi: () => Promise<HasilAksi>, pesanBerhasil: string) => Promise<boolean>;
  onOpenChange: (buka: boolean) => void;
};

const TANPA = "__tanpa__";

export function DialogLangkah({ sasaran, onOpenChange, ...isi }: Props) {
  return (
    <Dialog open={!!sasaran} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {sasaran ? (
          <IsiLangkah
            key={sasaran.jenis === "ubah" ? sasaran.langkah.id : "tambah"}
            sasaran={sasaran}
            onOpenChange={onOpenChange}
            {...isi}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function IsiLangkah({
  sasaran,
  planStageId,
  pemasok,
  sibuk,
  jalankan,
  onOpenChange,
}: Omit<Props, "sasaran"> & { sasaran: SasaranLangkah }) {
  const t = useTranslations("jadwalProduksi.ruang");
  const lama = sasaran.jenis === "ubah" ? sasaran.langkah : null;
  const [nama, setNama] = useState(lama?.name ?? "");
  const [supplierId, setSupplierId] = useState(lama?.pemasok?.id ?? TANPA);
  const [lamaHari, setLamaHari] = useState(lama ? String(lama.durationDays) : "1");
  const [catatan, setCatatan] = useState(lama?.note ?? "");
  const [dicoba, setDicoba] = useState(false);

  const namaRapi = nama.trim();
  const durasi = bacaDurasi(lamaHari);
  const namaSalah = !namaRapi;
  const durasiSalah = durasi === null;

  const opsiPemasok = [
    { value: TANPA, label: t("tanpaPemasokPilihan") },
    ...pemasok.map((p) => ({ value: p.id, label: p.jenis ? `${p.name} · ${p.jenis}` : p.name })),
  ];

  const simpan = async () => {
    setDicoba(true);
    if (namaSalah || durasi === null) return;
    const idPemasok = supplierId === TANPA ? null : supplierId;
    const note = catatan.trim() ? catatan.trim() : null;
    const ok = lama
      ? await jalankan(
          () => ubahLangkahAction({ stepId: lama.id, name: namaRapi, durationDays: durasi, supplierId: idPemasok, note }),
          t("berhasilUbah"),
        )
      : await jalankan(
          () => tambahLangkahAction({ planStageId, name: namaRapi, durationDays: durasi, supplierId: idPemasok, note }),
          t("berhasilTambah"),
        );
    if (ok) onOpenChange(false);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void simpan();
      }}
    >
      <DialogHeader>
        <DialogTitle>{lama ? t("langkahUbahJudul") : t("langkahBaruJudul")}</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="langkah-nama">{t("nama")}</Label>
        <Input
          id="langkah-nama"
          value={nama}
          maxLength={NAMA_LANGKAH_MAKS}
          placeholder={t("namaContoh")}
          aria-invalid={dicoba && namaSalah}
          onChange={(e) => setNama(e.target.value)}
        />
        {dicoba && namaSalah ? <p className="text-sm text-destructive">{t("namaWajib")}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="langkah-pemasok">{t("pemasok")}</Label>
        <SearchableCombobox
          id="langkah-pemasok"
          options={opsiPemasok}
          value={supplierId}
          onValueChange={setSupplierId}
          placeholder={t("pilihPemasok")}
          searchPlaceholder={t("cariPemasok")}
          emptyMessage={t("pemasokTidakAda")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="langkah-lama">{t("lama")}</Label>
        <Input
          id="langkah-lama"
          inputMode="numeric"
          className="w-32"
          value={lamaHari}
          aria-invalid={dicoba && durasiSalah}
          onChange={(e) => setLamaHari(e.target.value)}
        />
        {dicoba && durasiSalah ? <p className="text-sm text-destructive">{t("lamaTidakSah")}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="langkah-catatan">{t("catatan")}</Label>
        <Textarea id="langkah-catatan" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t("batal")}
        </Button>
        <Button type="submit" disabled={sibuk}>
          {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {lama ? t("simpan") : t("tambah")}
        </Button>
      </DialogFooter>
    </form>
  );
}
