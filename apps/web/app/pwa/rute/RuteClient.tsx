"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CircleCheck,
  Loader2,
  LocateFixed,
  MapPin,
  MapPinOff,
  Navigation,
  Plus,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatDistance } from "@/lib/pwa/nearest-stores";
import { formatIDR } from "@/lib/sales-orders/format";
import {
  bacaRuteTersimpan,
  bagianGoogleMaps,
  FAKTOR_JALAN,
  geserUrutan,
  hitungRute,
  KECEPATAN_KOTA_KMJ,
  MAKS_SINGGAH_GOOGLE,
  MENIT_SINGGAH_BAWAAN,
  pecahMenit,
  pulihkanRute,
  susunRute,
  type BagianPeta,
  type Kaki,
  type PilihanRute,
  type RuteTersimpan,
  type Titik,
} from "@/lib/salesman/rute";
// Hanya TIPE dari berkas kueri — Prisma tidak boleh ikut ke bundel HP.
import type { TokoRute } from "@/lib/salesman/rute-queries";
import { TambahTokoSheet } from "./TambahTokoSheet";

import { TautanKembali } from "@/app/pwa/TautanKembali";
type Izin = "prompt" | "granted" | "denied" | "unknown";

/**
 * Rute hari ini di HP salesman.
 *
 * Urutan dihitung di sini (`rute.ts`, murni dan dites) karena titik awalnya
 * posisi HP. Toko yang dijadwalkan kantor hari ini selalu ikut rencana dan
 * bertanda "Dari kantor" beserta catatannya. Toko yang sudah didatangi hari ini keluar dari urutan dan pindah
 * ke kartu "Sudah dikunjungi", jadi "Hitung ulang" selalu berarti: dari posisi
 * sekarang, ke toko yang belum. Pilihan salesman (toko tambahan, toko yang
 * dihapus, urutan tangan, pulang ke titik awal) disimpan di HP untuk hari ini
 * saja.
 */
export function RuteClient({
  kunciSimpan,
  tanggal,
  rencana,
  toko,
}: {
  kunciSimpan: string;
  tanggal: string;
  rencana: string[];
  toko: TokoRute[];
}) {
  const t = useTranslations("pwa.rute");
  const tJadwal = useTranslations("pwa.jadwal");
  const milik = useMemo(() => toko.map((x) => x.id), [toko]);
  const tokoById = useMemo(() => new Map(toko.map((x) => [x.id, x])), [toko]);

  // Render pertama = rencana hari ini, sama di server dan di HP. Pilihan yang
  // tersimpan dibaca sesudah terpasang — membacanya saat render membuat HTML
  // server dan HP berbeda (hydration error).
  const [pilihan, setPilihan] = useState<PilihanRute>(() => pulihkanRute(null, rencana, milik));
  const [dimuat, setDimuat] = useState(false);
  const [ubah, setUbah] = useState(false);
  const [tambahBuka, setTambahBuka] = useState(false);

  useEffect(() => {
    let teks: string | null = null;
    try {
      teks = window.localStorage.getItem(kunciSimpan);
    } catch {
      // Mode privat atau penyimpanan diblokir: mulai dari rencana hari ini.
    }
    setPilihan(pulihkanRute(bacaRuteTersimpan(teks, tanggal), rencana, milik));
    setDimuat(true);
  }, [kunciSimpan, tanggal, rencana, milik]);

  // Disimpan sejak pertama dimuat, bukan hanya saat diubah: toko yang pagi ini
  // ada di rencana lalu didatangi keluar dari rencana server — simpanan inilah
  // yang membuatnya tetap tampil sebagai "sudah dikunjungi".
  useEffect(() => {
    if (!dimuat) return;
    const simpan: RuteTersimpan = { tanggal, ...pilihan };
    try {
      window.localStorage.setItem(kunciSimpan, JSON.stringify(simpan));
    } catch {
      // Tidak bisa disimpan: rute tetap berjalan untuk sesi ini.
    }
  }, [dimuat, pilihan, kunciSimpan, tanggal]);

  // ─── Lokasi (penanganan izin sama dengan daftar toko) ──────────────────────
  const [izin, setIzin] = useState<Izin>("unknown");
  const [posisi, setPosisi] = useState<Titik | null>(null);
  const [mencari, setMencari] = useState(false);
  const [gagal, setGagal] = useState(false);

  const ambilPosisi = useCallback((segar: boolean) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGagal(true);
      return;
    }
    setMencari(true);
    setGagal(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosisi({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setIzin("granted");
        setMencari(false);
      },
      (err) => {
        setMencari(false);
        if (err.code === err.PERMISSION_DENIED) setIzin("denied");
        else setGagal(true);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: segar ? 0 : 60_000 },
    );
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) {
      setIzin("prompt");
      return;
    }
    let batal = false;
    let status: PermissionStatus | null = null;
    // Izin yang sudah diberikan (sebelumnya, atau baru saja di pengaturan
    // browser) langsung dipakai mencari posisi — tanpa menunggu tombol.
    const terapkan = (s: PermissionStatus) => {
      setIzin(s.state as Izin);
      if (s.state === "granted") ambilPosisi(false);
    };
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then(
      (s) => {
        if (batal) return;
        status = s;
        terapkan(s);
        s.onchange = () => terapkan(s);
      },
      () => {
        if (!batal) setIzin("prompt");
      },
    );
    return () => {
      batal = true;
      if (status) status.onchange = null;
    };
  }, [ambilPosisi]);

  // Izin dicabut di tengah jalan: posisi lama tidak dipakai lagi.
  const posisiDipakai = izin === "denied" ? null : posisi;

  // ─── Rute ──────────────────────────────────────────────────────────────────
  const dipilih = useMemo(
    () => pilihan.urutan.map((id) => tokoById.get(id)).filter((x): x is TokoRute => x !== undefined),
    [pilihan.urutan, tokoById],
  );
  const belum = useMemo(() => dipilih.filter((x) => !x.dikunjungiHariIni), [dipilih]);
  const sudah = useMemo(() => dipilih.filter((x) => x.dikunjungiHariIni), [dipilih]);
  const hasil = useMemo(() => {
    const opsi = { posisi: posisiDipakai, kembali: pilihan.kembali };
    return pilihan.manual ? hitungRute(belum, opsi) : susunRute(belum, opsi);
  }, [belum, posisiDipakai, pilihan.manual, pilihan.kembali]);
  const bagian = useMemo(() => bagianGoogleMaps(hasil), [hasil]);
  // Toko yang sudah didatangi hari ini tidak ditawarkan: ia masuk kartu "sudah", bukan urutan.
  const calon = useMemo(() => {
    const ada = new Set(pilihan.urutan);
    return toko.filter((x) => !ada.has(x.id) && !x.dikunjungiHariIni);
  }, [toko, pilihan.urutan]);

  /** Naik/turun: urutan yang sedang TAMPIL menjadi urutan tangan. */
  function geser(id: string, arah: -1 | 1) {
    const baru = geserUrutan(
      hasil.langkah.map((l) => l.toko.id),
      id,
      arah,
    );
    const set = new Set(baru);
    setPilihan((p) => ({ ...p, urutan: [...baru, ...p.urutan.filter((x) => !set.has(x))], manual: true }));
  }
  function hapus(id: string) {
    setPilihan((p) => ({
      ...p,
      urutan: p.urutan.filter((x) => x !== id),
      // Dicatat supaya toko rencana yang sengaja dihapus tidak muncul lagi hari ini.
      dihapus: p.dihapus.includes(id) ? p.dihapus : [...p.dihapus, id],
    }));
  }
  function tambah(id: string) {
    setPilihan((p) => ({
      ...p,
      urutan: p.urutan.includes(id) ? p.urutan : [...p.urutan, id],
      dihapus: p.dihapus.filter((x) => x !== id),
    }));
  }

  // ─── Teks ──────────────────────────────────────────────────────────────────
  const durasi = (menit: number) => {
    const { jam, menit: m } = pecahMenit(menit);
    if (jam === 0 && m === 0) return t("durationZero");
    if (jam === 0) return t("durationMinutes", { m });
    if (m === 0) return t("durationHours", { h: jam });
    return t("durationHoursMinutes", { h: jam, m });
  };
  const teksKaki = (k: Kaki, dariPosisi: boolean) =>
    t(dariPosisi ? "legFromYou" : "leg", { distance: formatDistance(k.jalanMeter), duration: durasi(k.menitTempuh) });
  const labelBagian = (b: BagianPeta) =>
    b.dari === null
      ? t("mapsPartReturn", { n: b.nomor })
      : b.dari === b.sampai || b.sampai === null
        ? t("mapsPartSingle", { n: b.nomor, from: b.dari })
        : t("mapsPart", { n: b.nomor, from: b.dari, to: b.sampai });

  /** Tanda "Dari kantor" + catatan kantor untuk toko yang dijadwalkan hari ini. */
  const kantor = (x: TokoRute) =>
    x.jadwal ? (
      <>
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {tJadwal("fromOffice")}
        </Badge>
        {x.jadwal.catatan ? <span className="text-foreground">{x.jadwal.catatan}</span> : null}
      </>
    ) : null;

  /** Alasan toko ada di rute — kalimat yang sama dengan rencana kunjungan beranda, dipendekkan. */
  const alasan = (x: TokoRute) => {
    const a = x.alasan;
    if (!a) return kantor(x) ?? <span className="text-muted-foreground">{t("reasonOutsidePlan")}</span>;
    return (
      <>
        {kantor(x)}
        {a.tagih !== null ? (
          <span className="font-medium text-destructive">{t("reasonTagih", { amount: formatIDR(a.tagih) })}</span>
        ) : null}
        {a.menurun ? (
          <span className="font-medium text-amber-800 dark:text-amber-300">
            {t(a.menurun === "JARANG" ? "reasonJarang" : "reasonNilaiTurun")}
          </span>
        ) : null}
        {a.lama ? (
          <span className="text-muted-foreground">
            {a.hariSejak === null ? t("reasonNever") : t("reasonDays", { days: a.hariSejak })}
          </span>
        ) : null}
      </>
    );
  };

  const kotakLokasi = () => {
    let ikon = <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />;
    let teks: string | null = null;
    let tombol: ReactNode = null;
    if (mencari) {
      ikon = <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />;
      teks = t("locationSearching");
    } else if (posisiDipakai) {
      ikon = <LocateFixed className="h-3.5 w-3.5 shrink-0" aria-hidden />;
      teks = t("startHere");
      tombol = (
        <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => ambilPosisi(true)}>
          {t("locationRefresh")}
        </Button>
      );
    } else if (izin === "denied") {
      ikon = <MapPinOff className="h-3.5 w-3.5 shrink-0" aria-hidden />;
      teks = t("locationDenied");
    } else if (gagal) {
      teks = t("locationFailed");
      tombol = (
        <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => ambilPosisi(true)}>
          {t("locationRetry")}
        </Button>
      );
    } else if (izin === "prompt") {
      teks = t("locationPrompt");
      tombol = (
        <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => ambilPosisi(true)}>
          {t("locationEnable")}
        </Button>
      );
    }
    if (!teks) return null;
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5">
          {ikon}
          {teks}
        </span>
        {tombol}
      </div>
    );
  };

  const tombolTambah = (
    <Button type="button" variant="outline" className="w-full" onClick={() => setTambahBuka(true)}>
      <Plus className="h-4 w-4" aria-hidden />
      {t("addStore")}
    </Button>
  );

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {toko.length === 0 ? (
        <section className="beranda-kartu space-y-3 text-sm text-muted-foreground">
          <p>{t("noStores")}</p>
          <Button asChild size="sm">
            <Link href="/pwa/stores">{t("noStoresCta")}</Link>
          </Button>
        </section>
      ) : (
        <>
          {belum.length === 0 ? (
            <section className="beranda-kartu space-y-3">
              {sudah.length > 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  {t("allVisited")}
                </p>
              ) : (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{t("emptyRoute")}</p>
                  <p className="text-muted-foreground">{t("emptyRouteHint")}</p>
                </div>
              )}
              {tombolTambah}
            </section>
          ) : (
            <>
              <section className="beranda-kartu space-y-3">
                <h2 className="beranda-judul">{t("summaryTitle")}</h2>
                {hasil.langkah.length > 0 ? (
                  <div>
                    <p className="text-lg font-semibold leading-tight tabular-nums">
                      {t("summary", {
                        count: hasil.langkah.length,
                        distance: formatDistance(hasil.total.jalanMeter),
                        duration: durasi(hasil.total.menit),
                      })}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("summaryBreakdown", { travel: durasi(hasil.total.menitTempuh), stops: durasi(hasil.total.menitSinggah) })}
                    </p>
                    {hasil.tanpaKoordinat.length > 0 ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("summaryExcludes", { count: hasil.tanpaKoordinat.length })}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("summaryNone")}</p>
                )}

                {kotakLokasi()}
                {hasil.mulaiDiToko && !mencari ? (
                  <p className="text-xs text-muted-foreground">{t("startFirstStore")}</p>
                ) : null}

                {hasil.langkah.length > 0 ? (
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="rute-kembali"
                      checked={pilihan.kembali}
                      onCheckedChange={(v) => setPilihan((p) => ({ ...p, kembali: v === true }))}
                    />
                    <Label htmlFor="rute-kembali" className="min-h-11 flex-1 font-normal">
                      {t("returnToStart")}
                    </Label>
                  </div>
                ) : null}

                {bagian.length === 1 ? (
                  <Button asChild className="w-full">
                    <a href={bagian[0].url} target="_blank" rel="noopener noreferrer">
                      <Navigation className="h-4 w-4" aria-hidden />
                      {t("openMaps")}
                    </a>
                  </Button>
                ) : bagian.length > 1 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">{t("mapsSplitNote", { max: MAKS_SINGGAH_GOOGLE })}</p>
                    {bagian.map((b) => (
                      <Button
                        key={b.nomor}
                        asChild
                        variant={b.nomor === 1 ? "default" : "outline"}
                        className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                      >
                        <a href={b.url} target="_blank" rel="noopener noreferrer">
                          <Navigation className="h-4 w-4 shrink-0" aria-hidden />
                          <span className="min-w-0">
                            <span className="block">{labelBagian(b)}</span>
                            {b.pulang && b.dari !== null ? (
                              <span className="block text-xs opacity-80">{t("mapsThenReturn")}</span>
                            ) : null}
                          </span>
                        </a>
                      </Button>
                    ))}
                  </div>
                ) : null}
                {bagian.length > 0 && hasil.mulaiDiToko ? (
                  <p className="text-xs text-muted-foreground">{t("mapsFromDevice")}</p>
                ) : null}

                <p className="text-[11px] leading-snug text-muted-foreground">
                  {t("estimateNote", { factor: FAKTOR_JALAN, speed: KECEPATAN_KOTA_KMJ, stop: MENIT_SINGGAH_BAWAAN })}
                </p>
              </section>

              <section className="beranda-kartu beranda-kartu-daftar">
                <div className="flex items-center justify-between gap-2 px-4 pt-3">
                  <h2 className="beranda-judul">{t("stopsTitle", { count: hasil.langkah.length })}</h2>
                  <Button type="button" variant="ghost" size="sm" aria-pressed={ubah} onClick={() => setUbah((x) => !x)}>
                    {ubah ? t("done") : t("edit")}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 pb-2 text-xs text-muted-foreground">
                  <span>{pilihan.manual ? t("manualNote") : t("autoNote")}</span>
                  {pilihan.manual ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      onClick={() => setPilihan((p) => ({ ...p, manual: false }))}
                    >
                      <Wand2 className="h-4 w-4" aria-hidden />
                      {t("autoSort")}
                    </Button>
                  ) : null}
                </div>

                {hasil.langkah.length > 0 ? (
                  <ol className="divide-y border-t">
                    {hasil.langkah.map((l, i) => {
                      const x = l.toko;
                      const kaki = i === 0 && hasil.mulaiDiToko ? t("legStart") : teksKaki(l, i === 0);
                      const isi = (
                        <>
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium leading-tight">{x.nama}</span>
                            {x.alamat ? <span className="block truncate text-xs text-muted-foreground">{x.alamat}</span> : null}
                            <span className="flex flex-wrap gap-x-2 text-xs">{alasan(x)}</span>
                            <span className="block text-xs tabular-nums text-muted-foreground">{kaki}</span>
                          </span>
                        </>
                      );
                      return (
                        <li key={x.id}>
                          {ubah ? (
                            <div className="flex items-center gap-3 py-1 pl-4 pr-2">
                              {isi}
                              <div className="flex shrink-0 items-center">
                                <div className="flex flex-col">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    disabled={i === 0}
                                    onClick={() => geser(x.id, -1)}
                                    aria-label={t("moveUp", { name: x.nama })}
                                  >
                                    <ArrowUp className="h-4 w-4" aria-hidden />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    disabled={i === hasil.langkah.length - 1}
                                    onClick={() => geser(x.id, 1)}
                                    aria-label={t("moveDown", { name: x.nama })}
                                  >
                                    <ArrowDown className="h-4 w-4" aria-hidden />
                                  </Button>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive"
                                  onClick={() => hapus(x.id)}
                                  aria-label={t("remove", { name: x.nama })}
                                >
                                  <X className="h-4 w-4" aria-hidden />
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Link
                              href={`/pwa/stores/${x.id}`}
                              className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                            >
                              {isi}
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="border-t px-4 py-3 text-sm text-muted-foreground">{t("summaryNone")}</p>
                )}

                {hasil.pulang ? (
                  <div className="flex min-h-14 items-center gap-3 border-t px-4 py-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Undo2 className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-tight">{t("returnLeg")}</span>
                      <span className="block text-xs tabular-nums text-muted-foreground">{teksKaki(hasil.pulang, false)}</span>
                    </span>
                  </div>
                ) : null}

                {ubah ? <div className="border-t p-3">{tombolTambah}</div> : null}
              </section>

              {hasil.tanpaKoordinat.length > 0 ? (
                <section className="beranda-kartu beranda-kartu-daftar">
                  <div className="px-4 pt-3">
                    <h2 className="beranda-judul">{t("noLocationTitle", { count: hasil.tanpaKoordinat.length })}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{t("noLocationNote")}</p>
                  </div>
                  <ul className="mt-2 divide-y border-t">
                    {hasil.tanpaKoordinat.map((x) => (
                      <li key={x.id} className="flex items-center">
                        <Link
                          href={`/pwa/stores/${x.id}`}
                          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60"
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                            <MapPinOff className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium leading-tight">{x.nama}</span>
                            {x.alamat ? <span className="block truncate text-xs text-muted-foreground">{x.alamat}</span> : null}
                            <span className="flex flex-wrap gap-x-2 text-xs">{alasan(x)}</span>
                          </span>
                          {ubah ? null : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                        </Link>
                        {ubah ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="mr-2 text-destructive"
                            onClick={() => hapus(x.id)}
                            aria-label={t("remove", { name: x.nama })}
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}

          {sudah.length > 0 ? (
            <section className="beranda-kartu beranda-kartu-daftar">
              <h2 className="beranda-judul px-4 pt-3">{t("visitedTitle", { count: sudah.length })}</h2>
              <ul className="mt-2 divide-y border-t">
                {sudah.map((x) => (
                  <li key={x.id}>
                    <Link
                      href={`/pwa/stores/${x.id}`}
                      className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500">
                        <CircleCheck className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{x.nama}</span>
                      {x.jadwal ? (
                        <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                          {tJadwal("fromOffice")}
                        </Badge>
                      ) : null}
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="text-center text-[11px] text-muted-foreground">{t("savedNote")}</p>
        </>
      )}

      <TambahTokoSheet open={tambahBuka} onOpenChange={setTambahBuka} calon={calon} onTambah={tambah} />
    </div>
  );
}
