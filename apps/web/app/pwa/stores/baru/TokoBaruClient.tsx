"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Loader2, LocateFixed, MapPin, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { BATAS_USULAN, validasiUsulanToko, type GalatUsulan, type JenisToko } from "@/lib/stores/usulan-toko";
import { ajukanTokoBaruAction, cekDuplikatUsulanAction, type KandidatDuplikatHp } from "../usulan-actions";

import { TautanKembali } from "@/app/pwa/TautanKembali";
type Area = { id: string; code: string; name: string };
type Lokasi = { lat: number; lng: number; akurasi: number };
type KeadaanLokasi = "diam" | "mencari" | "ditolak" | "gagal" | "tidakAda";

// Radix Select tidak menerima nilai kosong.
const BELUM_TAHU = "__BELUM_TAHU__";
const JENIS: (JenisToko | "")[] = ["PUTUS", "KONSI", ""];

/** Galat mana tampil di bawah kolom mana. */
const KOLOM_GALAT: Record<GalatUsulan, "foto" | "nama" | "alamat" | "telepon" | "kontak" | "jenis" | "lokasi" | "catatan"> = {
  FOTO_WAJIB: "foto",
  FOTO_TIDAK_SAH: "foto",
  NAMA_WAJIB: "nama",
  NAMA_TERLALU_PANJANG: "nama",
  ALAMAT_WAJIB: "alamat",
  ALAMAT_TERLALU_PANJANG: "alamat",
  TELEPON_TIDAK_SAH: "telepon",
  KONTAK_TERLALU_PANJANG: "kontak",
  JENIS_TIDAK_SAH: "jenis",
  KOORDINAT_TIDAK_LENGKAP: "lokasi",
  KOORDINAT_TIDAK_SAH: "lokasi",
  CATATAN_TERLALU_PANJANG: "catatan",
};

/**
 * Formulir "Daftarkan toko baru".
 *
 * Hanya online: usulan diperiksa terhadap toko yang sudah ada SEBELUM dikirim,
 * dan pemeriksaan itu butuh server. Tanpa sinyal, isian tetap di layar dan
 * tombolnya menunggu — tidak ada yang hilang.
 */
export function TokoBaruClient({ area }: { area: Area[] }) {
  const t = useTranslations("pwa.usulanToko");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Satu kunci per formulir: kiriman ulang saat sinyal putus tidak membuat usulan kedua.
  const [kunci] = useState(newLocalId);
  const [online, setOnline] = useState(true);

  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [nama, setNama] = useState("");
  const [alamat, setAlamat] = useState("");
  const [telepon, setTelepon] = useState("");
  const [kontak, setKontak] = useState("");
  const [jenis, setJenis] = useState<JenisToko | "">("");
  const [areaId, setAreaId] = useState("");
  const [catatan, setCatatan] = useState("");
  const [lokasi, setLokasi] = useState<Lokasi | null>(null);
  const [keadaanLokasi, setKeadaanLokasi] = useState<KeadaanLokasi>("diam");
  const [sudahCoba, setSudahCoba] = useState(false);
  const [kandidat, setKandidat] = useState<KandidatDuplikatHp[] | null>(null);
  const [tahap, setTahap] = useState<"periksa" | "kirim">("periksa");
  const kartuDuplikat = useRef<HTMLElement>(null);

  useEffect(() => {
    const perbarui = () => setOnline(navigator.onLine);
    perbarui();
    window.addEventListener("online", perbarui);
    window.addEventListener("offline", perbarui);
    return () => {
      window.removeEventListener("online", perbarui);
      window.removeEventListener("offline", perbarui);
    };
  }, []);

  useEffect(() => {
    if (kandidat && kandidat.length > 0) kartuDuplikat.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [kandidat]);

  const isian = {
    name: nama,
    address: alamat,
    phone: telepon,
    contactName: kontak,
    termsType: jenis,
    groupId: areaId,
    lat: lokasi?.lat ?? null,
    lng: lokasi?.lng ?? null,
    photoUrl: foto && !foto.berkas ? foto.url : null,
    note: catatan,
  };
  const periksa = validasiUsulanToko(isian);
  const galatKolom = new Map<string, GalatUsulan>();
  if (sudahCoba && !periksa.ok) {
    for (const g of periksa.galat) if (!galatKolom.has(KOLOM_GALAT[g])) galatKolom.set(KOLOM_GALAT[g], g);
  }
  const galat = (kolom: string) => {
    const g = galatKolom.get(kolom);
    return g ? <p className="text-xs text-destructive">{td(`err_${g}`)}</p> : null;
  };

  // Kandidat duplikat dihitung dari nama dan lokasi; begitu salah satunya
  // berubah, daftar lama tidak berlaku lagi.
  function ubahNama(nilai: string) {
    setNama(nilai);
    setKandidat(null);
  }
  function ubahLokasi(nilai: Lokasi | null) {
    setLokasi(nilai);
    setKandidat(null);
  }

  function ambilLokasi() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setKeadaanLokasi("tidakAda");
      return;
    }
    setKeadaanLokasi("mencari");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        ubahLokasi({ lat: pos.coords.latitude, lng: pos.coords.longitude, akurasi: pos.coords.accuracy });
        setKeadaanLokasi("diam");
      },
      (err) => setKeadaanLokasi(err.code === err.PERMISSION_DENIED ? "ditolak" : "gagal"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function kirim(tetapAjukan: boolean) {
    setTahap("kirim");
    const hasil = await ajukanTokoBaruAction({ ...isian, idempotencyKey: kunci, tetapAjukan });
    if (hasil.ok) {
      toast.success(hasil.ulang ? t("okRepeat") : t("okCreated"));
      router.replace("/pwa/stores/usulan");
      return;
    }
    if (hasil.code === "MUNGKIN_DUPLIKAT") {
      // Rekan baru saja mengusulkan toko yang mirip, sesudah HP ini memeriksa.
      setKandidat(hasil.kandidat);
      return;
    }
    toast.error(td(`err_${hasil.code}`));
  }

  function periksaDanAjukan() {
    setSudahCoba(true);
    if (!periksa.ok) {
      toast.error(td(`err_${periksa.galat[0]}`));
      return;
    }
    if (!navigator.onLine) {
      toast.error(t("offline"));
      return;
    }
    const data = periksa.data;
    startTransition(async () => {
      try {
        setTahap("periksa");
        const cek = await cekDuplikatUsulanAction({ name: data.name, lat: data.lat, lng: data.lng });
        if (!cek.ok) {
          toast.error(td(`err_${cek.code}`));
          return;
        }
        if (cek.kandidat.length > 0) {
          setKandidat(cek.kandidat);
          return;
        }
        await kirim(false);
      } catch {
        toast.error(t("errNetwork"));
      }
    });
  }

  function tetapAjukan() {
    startTransition(async () => {
      try {
        await kirim(true);
      } catch {
        toast.error(t("errNetwork"));
      }
    });
  }

  const labelJenis = (j: JenisToko | "") => (j === "" ? t("typeUnknown") : td(`type${j}`));

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/stores/usulan" />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("newTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("newBody")}</p>
      </header>

      {!online ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300" role="status">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("offline")}
        </p>
      ) : null}

      <section className="beranda-kartu space-y-4">
        {/* Foto didahulukan: papan nama di foto adalah bukti bahwa tokonya ada,
            dan namanya disalin dari situ. */}
        <div className="space-y-1">
          <UnggahFoto
            label={t("photoLabel")}
            petunjuk={t("photoHint")}
            nilai={foto}
            onChange={setFoto}
            wajib
            disabled={pending}
          />
          {galat("foto")}
        </div>

        <div className="space-y-2">
          <Label htmlFor="tb-nama">
            {t("nameLabel")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input
            id="tb-nama"
            value={nama}
            onChange={(e) => ubahNama(e.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={BATAS_USULAN.nama}
            autoComplete="off"
            aria-invalid={galatKolom.has("nama")}
            disabled={pending}
          />
          {galat("nama")}
        </div>

        <div className="space-y-2">
          <Label htmlFor="tb-alamat">
            {t("addressLabel")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Textarea
            id="tb-alamat"
            value={alamat}
            onChange={(e) => setAlamat(e.target.value)}
            placeholder={t("addressPlaceholder")}
            rows={2}
            maxLength={BATAS_USULAN.alamat}
            aria-invalid={galatKolom.has("alamat")}
            disabled={pending}
          />
          {galat("alamat")}
        </div>

        <div className="space-y-2">
          <Label htmlFor="tb-telepon">{t("phoneLabel")}</Label>
          <Input
            id="tb-telepon"
            type="tel"
            inputMode="tel"
            value={telepon}
            onChange={(e) => setTelepon(e.target.value)}
            placeholder={t("phonePlaceholder")}
            maxLength={32}
            aria-invalid={galatKolom.has("telepon")}
            disabled={pending}
          />
          {galat("telepon")}
        </div>

        <div className="space-y-2">
          <Label htmlFor="tb-kontak">{t("contactLabel")}</Label>
          <Input
            id="tb-kontak"
            value={kontak}
            onChange={(e) => setKontak(e.target.value)}
            placeholder={t("contactPlaceholder")}
            maxLength={BATAS_USULAN.kontak}
            aria-invalid={galatKolom.has("kontak")}
            disabled={pending}
          />
          {galat("kontak")}
        </div>
      </section>

      <section className="beranda-kartu space-y-4">
        <div className="space-y-2">
          <Label id="tb-jenis">{t("typeLabel")}</Label>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="tb-jenis">
            {JENIS.map((j) => (
              <Button
                key={j || BELUM_TAHU}
                type="button"
                role="radio"
                aria-checked={jenis === j}
                variant={jenis === j ? "default" : "outline"}
                className="px-2"
                onClick={() => setJenis(j)}
                disabled={pending}
              >
                {labelJenis(j)}
              </Button>
            ))}
          </div>
          {galat("jenis")}
        </div>

        {area.length > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="tb-area">{t("areaLabel")}</Label>
            <Select value={areaId || BELUM_TAHU} onValueChange={(v) => setAreaId(v === BELUM_TAHU ? "" : v)} disabled={pending}>
              <SelectTrigger id="tb-area" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BELUM_TAHU}>{t("areaUnknown")}</SelectItem>
                {area.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </section>

      <section className="beranda-kartu space-y-3" aria-labelledby="tb-lokasi">
        <h2 id="tb-lokasi" className="beranda-judul">
          {t("locationLabel")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("locationHint")}</p>
        {lokasi ? (
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{t("locationSet", { meter: Math.max(1, Math.round(lokasi.akurasi)) })}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {lokasi.lat.toFixed(6)}, {lokasi.lng.toFixed(6)}
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={t("locationClear")} onClick={() => ubahLokasi(null)} disabled={pending}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        <Button
          type="button"
          variant={lokasi ? "outline" : "default"}
          className="w-full"
          onClick={ambilLokasi}
          disabled={pending || keadaanLokasi === "mencari"}
        >
          {keadaanLokasi === "mencari" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("locationLoading")}
            </>
          ) : (
            <>
              <LocateFixed className="h-4 w-4" />
              {lokasi ? t("locationRetake") : t("locationUse")}
            </>
          )}
        </Button>
        {keadaanLokasi === "ditolak" ? <p className="text-xs text-destructive">{t("locationDenied")}</p> : null}
        {keadaanLokasi === "gagal" ? <p className="text-xs text-destructive">{t("locationError")}</p> : null}
        {keadaanLokasi === "tidakAda" ? <p className="text-xs text-destructive">{t("locationUnsupported")}</p> : null}
        {galat("lokasi")}
      </section>

      <section className="beranda-kartu space-y-2">
        <Label htmlFor="tb-catatan">{t("noteLabel")}</Label>
        <Textarea
          id="tb-catatan"
          value={catatan}
          onChange={(e) => setCatatan(e.target.value)}
          placeholder={t("notePlaceholder")}
          rows={2}
          maxLength={BATAS_USULAN.catatan}
          disabled={pending}
        />
        {galat("catatan")}
      </section>

      {kandidat && kandidat.length > 0 ? (
        <section
          ref={kartuDuplikat}
          className="beranda-kartu space-y-3 border-amber-500/50"
          aria-labelledby="tb-duplikat"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div className="space-y-1">
              <h2 id="tb-duplikat" className="font-semibold leading-tight">
                {t("dupTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("dupBody")}</p>
            </div>
          </div>
          <ul className="divide-y rounded-lg border">
            {kandidat.map((k) => (
              <li key={`${k.jenis}-${k.id}`} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{k.name}</span>
                  {k.code ? <span className="text-xs text-muted-foreground">{k.code}</span> : null}
                  <Badge variant={k.jenis === "TOKO" ? "outline" : "secondary"} className="text-[10px]">
                    {k.jenis === "TOKO" ? t("dupStore") : t("dupProposal")}
                  </Badge>
                  {!k.aktif ? (
                    <Badge variant="outline" className="text-[10px]">
                      {t("dupInactive")}
                    </Badge>
                  ) : null}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{k.address}</p>
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  {[k.namaMirip ? t("dupName") : null, k.jarakMeter !== null ? t("dupNear", { meter: k.jarakMeter }) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setKandidat(null)} disabled={pending}>
              {t("dupCancel")}
            </Button>
            <Button type="button" onClick={tetapAjukan} disabled={pending || !online}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("dupConfirm")}
            </Button>
          </div>
        </section>
      ) : (
        <Button className="w-full" size="lg" onClick={periksaDanAjukan} disabled={pending || !online}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {tahap === "periksa" ? t("checking") : t("sending")}
            </>
          ) : (
            t("submit")
          )}
        </Button>
      )}
    </div>
  );
}
