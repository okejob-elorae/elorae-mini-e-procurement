"use client";

import { createContext, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageGallery } from "./ImageGallery";
import { replaceItemImagesAction } from "@/app/actions/item-images";
import { kunciGalatSimpanGambar, kunciGalatUnggah, perubahanGaleri } from "@/app/backoffice/items/galeri-barang";
import type { ItemImageSubmission, ItemImageDto } from "@/lib/items/images/types";

type Props = {
  itemId: string;
  variants: Array<{ sku: string }>;
  initial: ItemImageDto[];
  canManage: boolean;
};

/**
 * Halaman rincian barang memasang ini supaya tahu berapa perubahan galeri yang
 * belum disimpan — "Simpan barang" tidak ikut menyimpan gambar.
 */
export const GaleriBelumSimpanContext = createContext<((jumlah: number) => void) | null>(null);

const dariServer = (rows: ItemImageDto[]): ItemImageSubmission[] =>
  rows.map((i) => ({ id: i.id, url: i.url, variantSku: i.variantSku, sortOrder: i.sortOrder }));

export function ItemGalleryEditor({ itemId, variants, initial, canManage }: Props) {
  const t = useTranslations("items.images");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const laporBelumSimpan = useContext(GaleriBelumSimpanContext);

  const [awal, setAwal] = useState(initial);
  const [tersimpan, setTersimpan] = useState<ItemImageSubmission[]>(() => dariServer(initial));
  const [submissions, setSubmissions] = useState<ItemImageSubmission[]>(() => dariServer(initial));
  const [menungguSegar, setMenungguSegar] = useState(false);

  const ubah = useMemo(() => perubahanGaleri(tersimpan, submissions), [tersimpan, submissions]);

  // Data server baru (sesudah "Simpan gambar" → router.refresh) membawa id
  // gambar yang baru disisipkan. Ambil alih, supaya simpan berikutnya tidak
  // menyisipkan ulang URL yang sama lalu menghapus barisnya beserta berkas R2-nya.
  // Perubahan yang belum disimpan tidak ditimpa oleh penyegaran lain.
  if (initial !== awal) {
    setAwal(initial);
    if (menungguSegar || !ubah.adaPerubahan) {
      const segar = dariServer(initial);
      setTersimpan(segar);
      setSubmissions(segar);
      setMenungguSegar(false);
    }
  }

  const jumlahBelum = canManage ? ubah.baru + ubah.dihapus + ubah.digeser : 0;
  useEffect(() => {
    laporBelumSimpan?.(jumlahBelum);
  }, [laporBelumSimpan, jumlahBelum]);
  useEffect(() => () => laporBelumSimpan?.(0), [laporBelumSimpan]);

  // Menutup tab atau memuat ulang halaman selagi ada gambar belum disimpan.
  useEffect(() => {
    if (jumlahBelum === 0) return;
    const tahan = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", tahan);
    return () => window.removeEventListener("beforeunload", tahan);
  }, [jumlahBelum]);

  const productLevel = submissions.filter((s) => s.variantSku === null);
  const byVariant: Map<string, ItemImageSubmission[]> = new Map();
  for (const v of variants) {
    byVariant.set(v.sku, submissions.filter((s) => s.variantSku === v.sku));
  }

  function setGroup(variantSku: string | null, next: ItemImageSubmission[]) {
    setSubmissions((prev) => [...prev.filter((s) => s.variantSku !== variantSku), ...next]);
  }

  async function uploadFiles(files: File[]): Promise<string[]> {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    let res: Response;
    try {
      res = await fetch(`/api/upload/item-image?itemId=${encodeURIComponent(itemId)}`, {
        method: "POST",
        body: fd,
      });
    } catch {
      toast.error(t("errUnggah"));
      return [];
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(t(kunciGalatUnggah(res.status, err.error) as never));
      return [];
    }
    try {
      const { urls } = (await res.json()) as { urls: string[] };
      return Array.isArray(urls) ? urls : [];
    } catch {
      toast.error(t("errUnggah"));
      return [];
    }
  }

  function save() {
    const dikirim = submissions;
    startTransition(async () => {
      const result = await replaceItemImagesAction(itemId, dikirim);
      if (result.ok) {
        toast.success(t("saved"));
        setTersimpan(dikirim);
        setMenungguSegar(true);
        router.refresh();
      } else {
        toast.error(t(kunciGalatSimpanGambar(result.code) as never));
      }
    });
  }

  return (
    <Card className="gap-4 p-4">
      <div>
        <h3 className="text-sm font-medium mb-2">{t("productGallery")}</h3>
        <ImageGallery
          variantSku={null}
          items={productLevel}
          onChange={(next) => setGroup(null, next)}
          onUpload={uploadFiles}
          canManage={canManage}
        />
      </div>
      {variants.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">{t("variantGalleries")}</h3>
          <div className="space-y-3">
            {variants.map((v) => (
              <div key={v.sku}>
                <div className="text-xs text-muted-foreground mb-1">{v.sku}</div>
                <ImageGallery
                  variantSku={v.sku}
                  items={byVariant.get(v.sku) ?? []}
                  onChange={(next) => setGroup(v.sku, next)}
                  onUpload={uploadFiles}
                  canManage={canManage}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {canManage && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {ubah.adaPerubahan ? (
            <p
              role="status"
              className="mr-auto flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {ubah.baru > 0 ? t("belumSimpanBaru", { count: ubah.baru }) : t("belumSimpanUbah")}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("tanpaPerubahan")}</p>
          )}
          <Button onClick={save} disabled={isPending || !ubah.adaPerubahan}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isPending ? t("menyimpan") : t("save")}
          </Button>
        </div>
      )}
    </Card>
  );
}
