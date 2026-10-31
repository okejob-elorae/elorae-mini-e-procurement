"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeteranganKirim } from "../../../KeteranganKirim";
import { toast } from "sonner";
import { CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { cn } from "@/lib/utils";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { catatJanjiBayarAction } from "@/app/actions/collections";
import { unggahFoto } from "@/lib/foto/unggah";
import type { FotoTertunda } from "@/lib/pwa/offline/db";
import { nasibUnggah } from "@/lib/pwa/offline/laporan-classify";
import { antreJanji } from "@/lib/pwa/offline/laporan-queue";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { newLocalId } from "@/lib/pwa/offline/queue";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
export type FakturJanjiTampil = {
  id: string;
  invoiceNo: string;
  jatuhTempo: string;
  sisa: number;
  sisaTeks: string;
};

/** Hari ini menurut WIB, "YYYY-MM-DD" — dihitung saat laporan DIBUAT, bukan saat terkirim. */
function hariIniWib(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

/** Foto formulir → bentuk antrean: berkas di HP bila belum naik, URL bila sudah. */
const keTertunda = (f: NilaiFoto): FotoTertunda | null =>
  f ? (f.berkas ? { nama: f.nama, blob: f.berkas } : { nama: f.nama, url: f.url }) : null;

/** URL foto untuk server; unggah dulu kalau masih berkas di HP. */
const naikkan = async (f: NilaiFoto): Promise<string | null> =>
  f
    ? f.berkas
      ? unggahFoto(new File([f.berkas], f.nama, { type: f.berkas.type || "image/jpeg" }))
      : f.url
    : null;

/**
 * Formulir janji bayar / tukar faktur.
 *
 * Janji ini LANGSUNG berlaku untuk penagihan begitu tercatat — ia yang membuat
 * janji yang terlewat terdeteksi — tapi TIDAK mengurangi piutang sepeser pun,
 * dan tetap "belum dikonfirmasi" sampai kantor mencocokkan fotonya.
 *
 * Tanpa sinyal, laporannya disimpan di HP (antrean yang sama dengan BKM dan
 * nota retur) dan terkirim sendiri; fotonya ikut disimpan sebagai berkas.
 */
export function JanjiBayarClient({
  storeId,
  storeName,
  hariIni,
  faktur,
}: {
  storeId: string;
  storeName: string;
  /** Hari ini menurut server, untuk nilai awal dan batas bawah tanggal janji. */
  hariIni: string;
  faktur: FakturJanjiTampil[];
}) {
  const t = useTranslations("pwa.janjiBayar");
  const td = dinamis(t);
  const tFoto = useTranslations("foto");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Kunci kiriman: SATU per formulir, dibuat saat dibuka. Dua ketukan simpan,
  // atau kiriman ulang dari antrean, tetap satu kontrabon di server.
  const [kunci] = useState(newLocalId);

  const [dipilih, setDipilih] = useState<Set<string>>(() => new Set(faktur.map((f) => f.id)));
  const [janji, setJanji] = useState("");
  const [penerima, setPenerima] = useState("");
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [catatan, setCatatan] = useState("");

  const kembaliKe = `/pwa/piutang/${storeId}`;
  const nilai = useMemo(
    () => faktur.filter((f) => dipilih.has(f.id)).reduce((s, f) => s + f.sisa, 0),
    [faktur, dipilih],
  );
  // Teks "YYYY-MM-DD" bisa dibandingkan langsung.
  const janjiSah = janji !== "" && janji >= hariIni;

  const alihkan = (id: string) =>
    setDipilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });

  const bisaSimpan = !pending && dipilih.size > 0 && janjiSah && penerima.trim() !== "" && foto !== null;
  const kurang = pending
    ? null
    : dipilih.size === 0
      ? t("kurangFaktur")
      : !janjiSah
        ? t("kurangTanggal")
        : penerima.trim() === ""
          ? t("kurangPenerima")
          : foto === null
            ? t("kurangFoto")
            : null;

  const simpan = () => {
    startTransition(async () => {
      const isi = {
        receivableIds: [...dipilih],
        tanggalSerah: hariIniWib(),
        janjiBayar: janji,
        receivedBy: penerima.trim(),
        note: catatan.trim(),
      };
      // Halaman bisa dibuka dari tembolok HP kemarin; "hari ini" dari server
      // saat itu sudah basi. Yang menentukan adalah hari laporan ini dibuat.
      if (isi.janjiBayar < isi.tanggalSerah) {
        toast.error(t("errJANJI_SEBELUM_SERAH"));
        return;
      }

      const antrekan = async () => {
        await antreJanji({
          localId: kunci,
          storeId,
          storeName,
          nilai,
          payload: isi,
          foto: keTertunda(foto),
        });
        window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
        toast.success(t("okQueued"));
        router.replace(kembaliKe);
      };

      if (!navigator.onLine) return antrekan();

      let hasil: Awaited<ReturnType<typeof catatJanjiBayarAction>>;
      try {
        const photoUrl = await naikkan(foto);
        hasil = await catatJanjiBayarAction({ ...isi, photoUrl, idempotencyKey: kunci });
      } catch (err) {
        // Foto yang DITOLAK server (terlalu besar, bukan gambar) tidak akan
        // lolos di antrean juga — sampaikan sekarang. Selebihnya sinyal.
        if (nasibUnggah(err) === "terminal") {
          toast.error(tFoto(`err${err instanceof Error ? err.message : "GAGAL"}` as never));
          return;
        }
        return antrekan();
      }

      if (hasil.ok) {
        toast.success(t("okSaved", { doc: hasil.docNo }));
        router.replace(kembaliKe);
        router.refresh();
      } else {
        toast.error(td(`err${hasil.kode}`));
      }
    });
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan={kembaliKe} />
      </Button>

      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold leading-tight">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="text-sm text-muted-foreground">{storeName}</p>
      </header>

      {faktur.length === 0 ? (
        <section className="beranda-kartu space-y-1">
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
        </section>
      ) : (
        <>
          <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="janji-faktur-judul">
            <div className="px-4 pb-3 pt-4">
              <h2 id="janji-faktur-judul" className="beranda-judul">
                {t("sectionInvoices")}
              </h2>
            </div>
            <ul className="divide-y border-t">
              {faktur.map((f) => {
                const aktif = dipilih.has(f.id);
                return (
                  <li key={f.id}>
                    <label
                      className={cn(
                        "flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3",
                        aktif && "bg-primary/[0.04]",
                      )}
                    >
                      <Checkbox checked={aktif} onCheckedChange={() => alihkan(f.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{f.invoiceNo}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t("due", { date: f.jatuhTempo })}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{f.sisaTeks}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="border-t px-4 py-3 text-right text-sm">
              {t("selectedTotal", { count: dipilih.size, value: formatIDR(nilai) })}
            </p>
          </section>

          <section className="beranda-kartu space-y-4">
            <div className="space-y-2">
              <Label htmlFor="janji-tanggal">{t("promisedDate")}</Label>
              <TanggalInput
                id="janji-tanggal"
                value={janji}
                min={hariIni}
                aria-invalid={janji !== "" && !janjiSah}
                aria-describedby="janji-tanggal-petunjuk"
                onChange={(e) => setJanji(e.target.value)}
              />
              <p
                id="janji-tanggal-petunjuk"
                className={cn("text-xs", janji !== "" && !janjiSah ? "text-destructive" : "text-muted-foreground")}
              >
                {janji !== "" && !janjiSah ? t("errJANJI_SEBELUM_SERAH") : t("promisedHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="janji-penerima">{t("receivedBy")}</Label>
              <Input
                id="janji-penerima"
                value={penerima}
                onChange={(e) => setPenerima(e.target.value)}
                placeholder={t("receivedByPlaceholder")}
                autoComplete="off"
              />
            </div>

            <UnggahFoto
              label={t("photo")}
              petunjuk={t("photoHint")}
              nilai={foto}
              onChange={setFoto}
              wajib
              disabled={pending}
              simpanDiHp
            />

            <div className="space-y-2">
              <Label htmlFor="janji-catatan">{t("note")}</Label>
              <Textarea
                id="janji-catatan"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder={t("notePlaceholder")}
                rows={2}
              />
            </div>
          </section>

          <p className="text-xs text-muted-foreground">{t("notSettled")}</p>

          <Button className="w-full" disabled={!bisaSimpan} onClick={simpan}>
            <CalendarCheck className="mr-1.5 h-4 w-4" />
            {t("save")}
          </Button>
          <KeteranganKirim teks={kurang} />
        </>
      )}
    </div>
  );
}
