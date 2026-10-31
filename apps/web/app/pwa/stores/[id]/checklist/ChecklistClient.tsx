"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookImage,
  Check,
  ChevronRight,
  ClipboardCheck,
  CloudOff,
  Loader2,
  Minus,
  Plus,
  Send,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { simpanChecklistAction, type HasilSimpanChecklist } from "@/app/actions/checklist-toko";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { listPendingPhotosForVisit } from "@/lib/pwa/offline/photo-queue";
import {
  BATAS_CHECKLIST,
  bacaJawaban,
  hitungSkor,
  type JawabanChecklist,
  type NilaiJawaban,
  type PertanyaanChecklist,
} from "@/lib/salesman/checklist-toko";
import type { BahanChecklistPwa, TemplatePwa } from "@/lib/salesman/checklist-queries";
import { cn } from "@/lib/utils";
import { AmbilFotoKunjungan, FotoKecil } from "./AmbilFotoKunjungan";
import { kirimTandaFotoPanduan, tambahTandaFotoPanduan, tandaUntukKunjungan } from "./tanda-foto-panduan";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
type HasilOk = Extract<HasilSimpanChecklist, { ok: true }>;

/*
 * Isian yang belum terkirim disimpan per kunjungan × template di HP. Tanpa
 * sinyal, tombol Kirim tidak membuang apa pun — salesman cukup menekannya lagi
 * saat sinyal kembali, atau membuka layar ini lagi dan isiannya masih ada.
 */
const kunciDraf = (visitId: string, templateId: string) => `elorae.checklist.${visitId}.${templateId}`;

function bacaDraf(kunci: string): JawabanChecklist | null {
  try {
    const raw = localStorage.getItem(kunci);
    if (!raw) return null;
    const o: unknown = JSON.parse(raw);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as JawabanChecklist) : null;
  } catch {
    return null;
  }
}

function tulisDraf(kunci: string, j: JawabanChecklist) {
  try {
    localStorage.setItem(kunci, JSON.stringify(j));
  } catch {
    // Penyimpanan penuh/diblokir — isian hanya hidup selama layar terbuka.
  }
}

function hapusDraf(kunci: string) {
  try {
    localStorage.removeItem(kunci);
  } catch {
    // abaikan
  }
}

const angkaSaja = (s: string) => s.replace(/\D/g, "");

export function ChecklistClient({
  toko,
  visitId,
  bahan,
}: {
  toko: { id: string; nama: string };
  visitId: string;
  bahan: BahanChecklistPwa;
}) {
  const t = useTranslations("pwa.checklist");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const tunggal = bahan.templat.length === 1 ? bahan.templat[0] : null;
  const [templateId, setTemplateId] = useState<string | null>(tunggal?.id ?? null);
  const template = bahan.templat.find((x) => x.id === templateId) ?? null;
  // Awal = hasil kunjungan ini (sama di server & klien); draf HP dimuat sesudah tampil.
  const [jawaban, setJawaban] = useState<JawabanChecklist>(tunggal?.hasilIni?.jawaban ?? {});
  const [dariDraf, setDariDraf] = useState(false);
  const [salah, setSalah] = useState<string | null>(null);
  const [hasil, setHasil] = useState<HasilOk | null>(null);
  const [daring, setDaring] = useState(true);
  const [tertahan, setTertahan] = useState(false);
  const [pratinjau, setPratinjau] = useState<Record<string, string>>({});
  const [fotoPanduanLokal, setFotoPanduanLokal] = useState<Record<string, string[]>>({});
  const urlDibuat = useRef<string[]>([]);

  const muatTemplate = (tp: TemplatePwa) => {
    const d = bacaDraf(kunciDraf(visitId, tp.id));
    setTemplateId(tp.id);
    setJawaban(d ?? tp.hasilIni?.jawaban ?? {});
    setDariDraf(d !== null);
    setSalah(null);
    setHasil(null);
  };

  // Sekali saat tampil: draf HP untuk template tunggal, pratinjau foto yang
  // masih di antrean, dan tanda foto panduan yang belum sampai ke server.
  useEffect(() => {
    let batal = false;
    if (tunggal) {
      const d = bacaDraf(kunciDraf(visitId, tunggal.id));
      if (d) {
        queueMicrotask(() => {
          if (batal) return;
          setJawaban(d);
          setDariDraf(true);
        });
      }
    }
    const lokal: Record<string, string[]> = {};
    for (const tanda of tandaUntukKunjungan(visitId)) (lokal[tanda.guideId] ??= []).push(tanda.clientId);
    queueMicrotask(() => {
      if (!batal) setFotoPanduanLokal(lokal);
    });
    void listPendingPhotosForVisit(visitId).then((daftar) => {
      if (batal) return;
      const peta: Record<string, string> = {};
      for (const p of daftar) {
        const url = URL.createObjectURL(p.blob);
        urlDibuat.current.push(url);
        peta[p.localId] = url;
      }
      setPratinjau((lama) => ({ ...peta, ...lama }));
    });
    return () => {
      batal = true;
    };
    // Sekali per kunjungan; `tunggal` berasal dari props kunjungan yang sama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  useEffect(() => {
    const dibuat = urlDibuat.current;
    return () => dibuat.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  // Tanda foto panduan dikirim ulang setiap antrean HP selesai dicoba.
  useEffect(() => {
    let sisaSebelum = -1;
    const coba = () => {
      void kirimTandaFotoPanduan().then((sisa) => {
        if (sisaSebelum >= 0 && sisa < sisaSebelum) router.refresh();
        sisaSebelum = sisa;
      });
    };
    coba();
    window.addEventListener(PERISTIWA_ANTREAN, coba);
    return () => window.removeEventListener(PERISTIWA_ANTREAN, coba);
  }, [router]);

  useEffect(() => {
    const segarkan = () => {
      setDaring(navigator.onLine);
      if (navigator.onLine) setTertahan(false);
    };
    queueMicrotask(segarkan);
    window.addEventListener("online", segarkan);
    window.addEventListener("offline", segarkan);
    return () => {
      window.removeEventListener("online", segarkan);
      window.removeEventListener("offline", segarkan);
    };
  }, []);

  const ubah = (id: string, nilai: NilaiJawaban | null) => {
    if (!template) return;
    setJawaban((lama) => {
      const baru = { ...lama };
      if (nilai === null) delete baru[id];
      else baru[id] = nilai;
      tulisDraf(kunciDraf(visitId, template.id), baru);
      return baru;
    });
    if (salah === id) setSalah(null);
    setHasil(null);
  };

  const fotoDiambil = (clientId: string, url: string) => {
    urlDibuat.current.push(url);
    setPratinjau((lama) => ({ ...lama, [clientId]: url }));
  };

  const fotoPanduanDiambil = (guideId: string, clientId: string, url: string) => {
    fotoDiambil(clientId, url);
    tambahTandaFotoPanduan({ clientId, guideId, visitId });
    setFotoPanduanLokal((lama) => ({ ...lama, [guideId]: [...(lama[guideId] ?? []), clientId] }));
  };

  const sementara = template ? hitungSkor(template.pertanyaan, jawaban) : null;

  const kirim = () =>
    mulai(async () => {
      if (!template) return;
      // Pemeriksaan yang sama dengan server, supaya pertanyaan wajib yang
      // terlewat terlihat walau tanpa sinyal.
      const cek = bacaJawaban(template.pertanyaan, jawaban);
      if (!cek.ok) {
        setSalah(cek.pertanyaanId || null);
        toast.error(td(`err.${cek.kode}`));
        if (cek.pertanyaanId) document.getElementById(`tanya-${cek.pertanyaanId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (!navigator.onLine) {
        setTertahan(true);
        return;
      }
      let r: HasilSimpanChecklist;
      try {
        r = await simpanChecklistAction({ storeId: toko.id, visitId, templateId: template.id, jawaban: cek.jawaban });
      } catch {
        // Aksi server yang tidak terjangkau melempar — itu sinyal, bukan isian.
        setTertahan(true);
        return;
      }
      if (!r.ok) {
        if (r.pertanyaanId) setSalah(r.pertanyaanId);
        toast.error(td(`err.${r.kode}`));
        return;
      }
      hapusDraf(kunciDraf(visitId, template.id));
      setDariDraf(false);
      setTertahan(false);
      setHasil(r);
      toast.success(t("terkirim"));
      window.scrollTo({ top: 0, behavior: "smooth" });
      router.refresh();
    });

  const panduan = bahan.panduan;

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan={`/pwa/stores/${toko.id}`} />
      </Button>

      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <TombolBantuanHp judul={t("judul")} />
        </div>
        <p className="text-sm text-muted-foreground">{toko.nama}</p>
      </header>

      {!daring || tertahan ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("luring")}
        </p>
      ) : null}

      {hasil ? <KartuHasil hasil={hasil} storeId={toko.id} /> : null}

      {panduan.length > 0 ? (
        <section className="beranda-kartu space-y-4">
          <h2 className="beranda-judul flex items-center gap-2">
            <BookImage className="h-4 w-4" aria-hidden />
            {t("panduanJudul")}
          </h2>
          {panduan.map((p) => {
            const diServer = p.foto.map((f) => f.clientId);
            const semua = [...new Set([...diServer, ...(fotoPanduanLokal[p.id] ?? [])])];
            const urlServer = new Map(p.foto.map((f) => [f.clientId, f.url]));
            return (
              <article key={p.id} className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
                <h3 className="font-semibold leading-tight">{p.judul}</h3>
                {p.gambarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.gambarUrl} alt={p.judul} className="max-h-72 w-full rounded-md border bg-muted object-contain" />
                ) : null}
                <p className="whitespace-pre-line text-sm">{p.isi}</p>
                {semua.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {semua.map((c) => (
                      <FotoKecil
                        key={c}
                        url={urlServer.get(c) ?? bahan.fotoKunjungan[c] ?? null}
                        pratinjau={pratinjau[c] ?? null}
                        labelMenunggu={t("fotoMenunggu")}
                      />
                    ))}
                  </div>
                ) : null}
                <AmbilFotoKunjungan
                  visitId={visitId}
                  storeId={toko.id}
                  keterangan={t("keteranganPanduan", { judul: p.judul })}
                  label={semua.length > 0 ? t("kirimFotoDisplayLagi") : t("kirimFotoDisplay")}
                  onDiambil={(c, u) => fotoPanduanDiambil(p.id, c, u)}
                />
              </article>
            );
          })}
        </section>
      ) : null}

      {bahan.templat.length === 0 ? (
        <section className="beranda-kartu space-y-2 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-muted">
            <ClipboardCheck className="h-5 w-5 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-medium">{t("kosongJudul")}</p>
          <p className="text-sm text-muted-foreground">{t("kosongIsi")}</p>
          {panduan.length > 0 ? <p className="text-sm text-muted-foreground">{t("kosongIsiPanduan")}</p> : null}
        </section>
      ) : !template ? (
        <section className="beranda-kartu beranda-kartu-daftar">
          <h2 className="beranda-judul px-4 pt-3">{t("pilihTemplate")}</h2>
          <ul className="divide-y">
            {bahan.templat.map((tp) => (
              <li key={tp.id}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => muatTemplate(tp)}
                  className="h-auto min-h-14 w-full justify-start gap-3 rounded-none px-4 py-2 text-left"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <ClipboardCheck className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block whitespace-normal font-medium leading-tight">{tp.nama}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t("jumlahPertanyaan", { n: tp.pertanyaan.length })}
                    </span>
                  </span>
                  {tp.hasilIni ? <Badge variant="secondary">{t("sudahDiisi", { persen: tp.hasilIni.persen ?? 0 })}</Badge> : null}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <section className="beranda-kartu space-y-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold leading-tight">{template.nama}</h2>
              {bahan.templat.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setTemplateId(null)}>
                  {t("gantiTemplate")}
                </Button>
              ) : null}
            </div>
            {template.sebelumnya ? (
              <p className="text-sm text-muted-foreground">
                {t("skorLalu", { persen: template.sebelumnya.persen ?? 0, tanggal: template.sebelumnya.tanggal })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("belumAdaLalu")}</p>
            )}
            {dariDraf ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("drafDipulihkan")}</p> : null}
          </section>

          {template.pertanyaan.map((p, i) => (
            <IsianPertanyaan
              key={p.id}
              nomor={i + 1}
              p={p}
              nilai={jawaban[p.id]}
              salah={salah === p.id}
              disabled={sibuk}
              onUbah={(v) => ubah(p.id, v)}
              foto={{
                visitId,
                storeId: toko.id,
                pratinjau,
                diServer: bahan.fotoKunjungan,
                onDiambil: fotoDiambil,
              }}
            />
          ))}

          {sementara ? (
            <p className="text-center text-sm text-muted-foreground">
              {t("skorSementara", { persen: sementara.persen ?? 0, skor: sementara.score, maks: sementara.maxScore })}
            </p>
          ) : null}

          <Button className="w-full" size="lg" onClick={kirim} disabled={sibuk}>
            {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}
            {template.hasilIni || hasil ? t("kirimUlang") : t("kirim")}
          </Button>
        </>
      )}
    </div>
  );
}

function KartuHasil({ hasil, storeId }: { hasil: HasilOk; storeId: string }) {
  const t = useTranslations("pwa.checklist");
  const lalu = hasil.sebelumnya;
  const selisih = lalu && lalu.persen !== null && hasil.persen !== null ? hasil.persen - lalu.persen : null;
  return (
    <section role="status" className="beranda-kartu space-y-3">
      <h2 className="beranda-judul">{t("hasilJudul")}</h2>
      <div className="flex items-end gap-3">
        <span className="text-4xl font-bold tabular-nums">{hasil.persen ?? 0}%</span>
        <span className="pb-1 text-sm text-muted-foreground">{t("poin", { skor: hasil.score, maks: hasil.maxScore })}</span>
      </div>
      {lalu ? (
        <p className="flex items-center gap-2 text-sm">
          {selisih !== null && selisih > 0 ? (
            <TrendingUp className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          ) : selisih !== null && selisih < 0 ? (
            <TrendingDown className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          ) : null}
          <span>
            {t("dibandingLalu", { persen: lalu.persen ?? 0, tanggal: lalu.tanggal })}{" "}
            {selisih === null || selisih === 0
              ? t("selisihSama")
              : selisih > 0
                ? t("selisihNaik", { n: selisih })
                : t("selisihTurun", { n: -selisih })}
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("belumAdaLalu")}</p>
      )}
      <Button asChild variant="outline" className="w-full">
        <Link href={`/pwa/stores/${storeId}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t("keToko")}
        </Link>
      </Button>
    </section>
  );
}

function IsianPertanyaan({
  nomor,
  p,
  nilai,
  salah,
  disabled,
  onUbah,
  foto,
}: {
  nomor: number;
  p: PertanyaanChecklist;
  nilai: NilaiJawaban | undefined;
  salah: boolean;
  disabled: boolean;
  onUbah: (v: NilaiJawaban | null) => void;
  foto: {
    visitId: string;
    storeId: string;
    pratinjau: Record<string, string>;
    diServer: Record<string, string>;
    onDiambil: (clientId: string, url: string) => void;
  };
}) {
  const t = useTranslations("pwa.checklist");
  const idLabel = `tanya-${p.id}-label`;

  return (
    <section
      id={`tanya-${p.id}`}
      aria-labelledby={idLabel}
      className={cn("beranda-kartu space-y-3", salah && "ring-2 ring-destructive")}
    >
      <div className="space-y-1">
        <p id={idLabel} className="font-medium leading-snug">
          <span className="mr-1 tabular-nums text-muted-foreground">{nomor}.</span>
          {p.teks}
          {p.wajib ? <span className="ml-1 text-destructive">*</span> : null}
        </p>
        {p.petunjuk ? <p className="text-xs text-muted-foreground">{p.petunjuk}</p> : null}
        {salah ? <p className="text-xs text-destructive">{t("wajibDiisi")}</p> : null}
      </div>

      {p.jenis === "YA_TIDAK" ? (
        <div role="radiogroup" aria-labelledby={idLabel} className="grid grid-cols-2 gap-2">
          {[true, false].map((v) => (
            <Button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={nilai === v}
              variant={nilai === v ? "default" : "outline"}
              className="h-14 text-base"
              disabled={disabled}
              onClick={() => onUbah(v)}
            >
              {v ? <Check className="h-5 w-5" aria-hidden /> : <X className="h-5 w-5" aria-hidden />}
              {v ? t("ya") : t("tidak")}
            </Button>
          ))}
        </div>
      ) : null}

      {p.jenis === "SKALA_1_5" ? (
        <div className="space-y-1">
          <div role="radiogroup" aria-labelledby={idLabel} className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((v) => (
              <Button
                key={v}
                type="button"
                role="radio"
                aria-checked={nilai === v}
                variant={nilai === v ? "default" : "outline"}
                className="h-14 text-lg tabular-nums"
                disabled={disabled}
                onClick={() => onUbah(v)}
              >
                {v}
              </Button>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("skalaRendah")}</span>
            <span>{t("skalaTinggi")}</span>
          </div>
        </div>
      ) : null}

      {p.jenis === "ANGKA" ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("kurangi")}
              disabled={disabled || typeof nilai !== "number" || nilai <= 0}
              onClick={() => onUbah(Math.max(0, (typeof nilai === "number" ? nilai : 0) - 1))}
            >
              <Minus className="h-4 w-4" aria-hidden />
            </Button>
            <Input
              aria-labelledby={idLabel}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="text-center text-lg tabular-nums"
              value={typeof nilai === "number" ? String(nilai) : ""}
              placeholder="0"
              disabled={disabled}
              onChange={(e) => {
                const s = angkaSaja(e.target.value).slice(0, 6);
                onUbah(s === "" ? null : Number(s));
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("tambah")}
              disabled={disabled || (typeof nilai === "number" && nilai >= BATAS_CHECKLIST.angkaMaks)}
              onClick={() => onUbah((typeof nilai === "number" ? nilai : 0) + 1)}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {p.target ? <p className="text-xs text-muted-foreground">{t("target", { n: p.target })}</p> : null}
        </div>
      ) : null}

      {p.jenis === "FOTO" ? (
        <FotoPertanyaan p={p} nilai={Array.isArray(nilai) ? nilai : []} disabled={disabled} onUbah={onUbah} foto={foto} />
      ) : null}

      {p.jenis === "TEKS" ? (
        <div className="space-y-1">
          <Label htmlFor={`teks-${p.id}`} className="sr-only">
            {p.teks}
          </Label>
          <Textarea
            id={`teks-${p.id}`}
            rows={3}
            maxLength={BATAS_CHECKLIST.jawabanTeks}
            value={typeof nilai === "string" ? nilai : ""}
            disabled={disabled}
            placeholder={t("teksPetunjuk")}
            onChange={(e) => onUbah(e.target.value === "" ? null : e.target.value)}
          />
        </div>
      ) : null}
    </section>
  );
}

function FotoPertanyaan({
  p,
  nilai,
  disabled,
  onUbah,
  foto,
}: {
  p: PertanyaanChecklist;
  nilai: string[];
  disabled: boolean;
  onUbah: (v: NilaiJawaban | null) => void;
  foto: {
    visitId: string;
    storeId: string;
    pratinjau: Record<string, string>;
    diServer: Record<string, string>;
    onDiambil: (clientId: string, url: string) => void;
  };
}) {
  const t = useTranslations("pwa.checklist");
  const penuh = nilai.length >= BATAS_CHECKLIST.fotoPerPertanyaan;
  return (
    <div className="space-y-2">
      {nilai.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {nilai.map((c) => (
            <FotoKecil
              key={c}
              url={foto.diServer[c] ?? null}
              pratinjau={foto.pratinjau[c] ?? null}
              labelMenunggu={t("fotoMenunggu")}
              labelHapus={t("lepasFoto")}
              onHapus={disabled ? undefined : () => {
                const sisa = nilai.filter((x) => x !== c);
                onUbah(sisa.length ? sisa : null);
              }}
            />
          ))}
        </div>
      ) : null}
      <AmbilFotoKunjungan
        visitId={foto.visitId}
        storeId={foto.storeId}
        keterangan={p.teks}
        label={penuh ? t("fotoPenuh") : nilai.length ? t("ambilFotoLagi") : t("ambilFoto")}
        disabled={disabled || penuh}
        onDiambil={(c, u) => {
          foto.onDiambil(c, u);
          onUbah([...nilai, c]);
        }}
      />
      {nilai.length > 0 ? <p className="text-xs text-muted-foreground">{t("fotoCatatan")}</p> : null}
    </div>
  );
}
