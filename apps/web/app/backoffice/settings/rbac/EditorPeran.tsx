"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { createRole, updateRolePermissions, type KodeGalatPeran } from "@/app/actions/rbac";
import { navItems } from "@/app/backoffice/BackofficeShell";
import { useTeksBantuan } from "@/components/bantuan/teks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cariEntri, type EntriBantuan } from "@/lib/bantuan/jenis";
import {
  bandingkanIzin,
  cocokCari,
  grupIzin,
  halamanRingkas,
  letakDiMenu,
  penjelasanIzin,
  type GrupTampil,
} from "@/lib/rbac/penjelasan-izin";

export type IzinDb = { id: string; code: string; description: string | null };
export type PeranEditor = {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: { id: string; code: string }[];
};
export type ModeEditor = "buat" | "ubah" | "lihat";

type Baris = {
  izin: IzinDb;
  grup: GrupTampil;
  label: string;
  keterangan: string;
  menu: string[];
  /** Id izin yang perlu ikut dipilih, dan labelnya. */
  butuh: { id: string; label: string } | null;
};

/**
 * Dialog buat / ubah / lihat peran.
 *
 * Izin dikelompokkan menurut bidang kerja (`lib/rbac/penjelasan-izin.ts`),
 * masing-masing dengan label, satu kalimat keterangan, dan menu yang
 * dibukanya — pemilik membuat peran sendiri tanpa harus menebak arti kode.
 * Kode yang belum dijelaskan tetap tampil (grup Lainnya) dengan keterangan
 * dari basis data, supaya izin baru tidak hilang dari editor.
 */
export function EditorPeran({
  mode,
  peran,
  semuaPeran,
  semuaIzin,
  onTutup,
  onTersimpan,
}: {
  mode: ModeEditor;
  peran: PeranEditor | null;
  semuaPeran: PeranEditor[];
  semuaIzin: IzinDb[];
  onTutup: () => void;
  onTersimpan: () => void;
}) {
  const t = useTranslations("izinPeran");
  const tR = useTranslations("settings.rbac");
  const tNav = useTranslations("navigation");
  const tUmum = useTranslations("common");
  const tUi = useTranslations("ui");
  const teksBantuan = useTeksBantuan();

  const hanyaLihat = mode === "lihat" || peran?.isSystem === true;
  const [nama, setNama] = useState("");
  const [deskripsi, setDeskripsi] = useState("");
  // Peran sistem memegang semua izin lewat `*`, apa pun tautan barisnya.
  const [dipilih, setDipilih] = useState<Set<string>>(() =>
    peran?.isSystem ? new Set(semuaIzin.map((p) => p.id)) : new Set(peran?.permissions.map((p) => p.id) ?? []),
  );
  const [cari, setCari] = useState("");
  const [sumber, setSumber] = useState("");
  const [galat, setGalat] = useState<KodeGalatPeran | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [bantuan, setBantuan] = useState<readonly EntriBantuan[] | null>(null);

  // Nama halaman di luar menu diambil dari daftar Bantuan, dimuat saat dialog dibuka.
  useEffect(() => {
    let batal = false;
    void import("@/lib/bantuan/daftar").then((m) => {
      if (!batal) setBantuan(m.DAFTAR_BANTUAN);
    });
    return () => {
      batal = true;
    };
  }, []);

  const idDariKode = useMemo(() => new Map(semuaIzin.map((p) => [p.code, p])), [semuaIzin]);

  const baris = useMemo<Baris[]>(() => {
    const namaHalaman = (rute: string): string => {
      if (rute === "/pwa") return t("aplikasiHp");
      const letak = letakDiMenu(rute, navItems);
      const jalur = letak ? letak.jalur.map((k) => tNav(k as never)) : [];
      if (letak?.tepat) return jalur.join(" › ");
      const entri = bantuan ? cariEntri(rute, bantuan) : null;
      const judul = entri ? teksBantuan(entri.judul) : null;
      if (judul && judul !== jalur[jalur.length - 1]) return [...jalur, judul].join(" › ");
      return jalur.length ? jalur.join(" › ") : rute;
    };
    const labelKode = (kode: string): string => {
      const e = penjelasanIzin(kode);
      return e ? t(e.label as never) : (idDariKode.get(kode)?.description ?? kode);
    };
    return [...semuaIzin]
      .sort((a, b) => bandingkanIzin(a.code, b.code))
      .map((izin) => {
        const e = penjelasanIzin(izin.code);
        const butuhIzin = e?.butuh ? idDariKode.get(e.butuh) : undefined;
        return {
          izin,
          grup: grupIzin(izin.code),
          label: e ? t(e.label as never) : (izin.description ?? izin.code),
          keterangan: e ? t(e.keterangan as never) : izin.code,
          menu: e ? [...new Set(halamanRingkas(e.halaman).map(namaHalaman))] : [],
          butuh: butuhIzin ? { id: butuhIzin.id, label: labelKode(butuhIzin.code) } : null,
        };
      });
  }, [semuaIzin, idDariKode, bantuan, t, tNav, teksBantuan]);

  const tampil = useMemo(
    () =>
      baris.filter(
        (b) =>
          (!hanyaLihat || dipilih.has(b.izin.id)) &&
          cocokCari(cari, [b.label, b.keterangan, ...b.menu, b.izin.code, t(`grup.${b.grup}` as never)]),
      ),
    [baris, cari, hanyaLihat, dipilih, t],
  );

  const kelompok = useMemo(() => {
    const peta = new Map<GrupTampil, Baris[]>();
    for (const b of tampil) peta.set(b.grup, [...(peta.get(b.grup) ?? []), b]);
    return [...peta.entries()];
  }, [tampil]);

  const ubahPilihan = (ids: string[], pilih: boolean) => {
    setDipilih((lama) => {
      const baru = new Set(lama);
      for (const id of ids) {
        if (pilih) baru.add(id);
        else baru.delete(id);
      }
      return baru;
    });
  };

  const salinDari = (id: string) => {
    const asal = semuaPeran.find((p) => p.id === id);
    if (!asal) return;
    setSumber(id);
    setDipilih(asal.isSystem ? new Set(semuaIzin.map((p) => p.id)) : new Set(asal.permissions.map((p) => p.id)));
    toast.success(t("disalin", { nama: asal.name }));
  };

  const simpan = async () => {
    setGalat(null);
    setSibuk(true);
    try {
      const ids = [...dipilih];
      const hasil =
        mode === "buat"
          ? await createRole({ name: nama, description: deskripsi }, ids)
          : peran
            ? await updateRolePermissions(peran.id, ids)
            : null;
      if (!hasil) return;
      if (!hasil.ok) {
        // Kotak di atas bertahan; toast terlihat walau daftar sedang digulir ke bawah.
        setGalat(hasil.code);
        toast.error(t(`galat.${hasil.code}` as never));
        return;
      }
      toast.success(mode === "buat" ? tR("created") : tR("updated"));
      onTersimpan();
    } catch {
      toast.error(mode === "buat" ? tR("createFailed") : tR("updateFailed"));
    } finally {
      setSibuk(false);
    }
  };

  const judul =
    mode === "buat"
      ? tR("createRole")
      : hanyaLihat
        ? t("lihatJudul", { name: peran?.name ?? "" })
        : tR("editTitle", { name: peran?.name ?? "" });
  const penjelasan = mode === "buat" ? tR("createDescription") : hanyaLihat ? tR("permissions") : tR("editDescription");
  const pilihanSumber = semuaPeran.filter((p) => p.id !== peran?.id);

  return (
    <Dialog open onOpenChange={(buka) => !buka && !sibuk && onTutup()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle>{judul}</DialogTitle>
          <DialogDescription>{penjelasan}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          <div className="space-y-4 pt-4">
            {galat ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {t(`galat.${galat}` as never)}
              </p>
            ) : null}

            {peran?.isSystem ? (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{tR("systemNote")}</p>
            ) : null}

            {mode === "buat" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="peran-nama">{tR("roleName")} *</Label>
                  <Input
                    id="peran-nama"
                    value={nama}
                    maxLength={50}
                    autoComplete="off"
                    onChange={(e) => setNama(e.target.value)}
                    placeholder={tR("roleNamePlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="peran-keterangan">{tUi("description")}</Label>
                  <Textarea
                    id="peran-keterangan"
                    value={deskripsi}
                    maxLength={191}
                    onChange={(e) => setDeskripsi(e.target.value)}
                    placeholder={tR("descriptionPlaceholder")}
                    rows={1}
                  />
                </div>
              </div>
            ) : null}

            {!hanyaLihat && pilihanSumber.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="peran-sumber">{t("mulaiDari")}</Label>
                <Select value={sumber || undefined} onValueChange={salinDari}>
                  <SelectTrigger id="peran-sumber" className="w-full md:w-80">
                    <SelectValue placeholder={t("mulaiDariPilih")} />
                  </SelectTrigger>
                  <SelectContent>
                    {pilihanSumber.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="sticky top-0 z-10 -mx-1 bg-background px-1 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={cari}
                  onChange={(e) => setCari(e.target.value)}
                  placeholder={t("cari")}
                  aria-label={t("cari")}
                  className="pl-9"
                />
              </div>
            </div>

            {kelompok.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {hanyaLihat && dipilih.size === 0 ? t("tanpaIzin") : t("tidakAdaHasil")}
              </p>
            ) : (
              kelompok.map(([grup, isi]) => {
                const semuaTerpilih = isi.every((b) => dipilih.has(b.izin.id));
                const jumlah = isi.filter((b) => dipilih.has(b.izin.id)).length;
                return (
                  <section key={grup} className="overflow-hidden rounded-lg border">
                    <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
                      <h3 className="text-sm font-semibold">
                        {t(`grup.${grup}` as never)}
                        {!hanyaLihat ? (
                          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                            {jumlah}/{isi.length}
                          </span>
                        ) : null}
                      </h3>
                      {!hanyaLihat ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => ubahPilihan(isi.map((b) => b.izin.id), !semuaTerpilih)}
                        >
                          {semuaTerpilih ? tR("deselectAll") : tR("selectAll")}
                        </Button>
                      ) : null}
                    </div>
                    <ul className="divide-y">
                      {isi.map((b) => {
                        const id = `izin-${b.izin.id}`;
                        const terpilih = dipilih.has(b.izin.id);
                        const kurang = !hanyaLihat && terpilih && b.butuh && !dipilih.has(b.butuh.id) ? b.butuh : null;
                        return (
                          <li key={b.izin.id} className="flex items-start gap-3 px-4 py-3">
                            <Checkbox
                              id={id}
                              className="mt-0.5"
                              checked={terpilih}
                              disabled={hanyaLihat}
                              onCheckedChange={(v) => ubahPilihan([b.izin.id], v === true)}
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <Label htmlFor={id} className="cursor-pointer leading-snug font-medium">
                                {b.label}
                              </Label>
                              <p className="text-sm text-muted-foreground">{b.keterangan}</p>
                              {b.menu.length > 0 ? (
                                <p className="text-xs text-muted-foreground">{t("membuka", { daftar: b.menu.join(", ") })}</p>
                              ) : null}
                              {kurang ? (
                                <p className="flex flex-wrap items-center gap-x-2 text-xs text-amber-800 dark:text-amber-300">
                                  {t("perluJuga", { izin: kurang.label })}
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0 text-xs"
                                    onClick={() => ubahPilihan([kurang.id], true)}
                                  >
                                    {t("tambahkan")}
                                  </Button>
                                </p>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums">{t("jumlahDipilih", { count: dipilih.size })}</span>
          {hanyaLihat ? (
            <Button variant="outline" onClick={onTutup}>
              {tUmum("close")}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={onTutup} disabled={sibuk}>
                {tR("cancel")}
              </Button>
              <Button onClick={simpan} disabled={sibuk || (mode === "buat" && !nama.trim())}>
                {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {sibuk ? t("menyimpan") : mode === "buat" ? tR("createRole") : tR("saveChanges")}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
