"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, CircleCheck, CircleX, Loader2 } from "lucide-react";
import { batalkanIzinAction, setujuiIzinAction, tolakIzinAction, type HasilKeputusanIzinAction } from "@/app/actions/izin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_ALASAN_IZIN } from "@/lib/salesman/izin";
import { cn } from "@/lib/utils";

type Mode = "setujui" | "tolak" | "batalkan";

/**
 * Keputusan satu ajuan: Setujui (catatan opsional) / Tolak (catatan wajib) untuk
 * yang DIAJUKAN, Batalkan (catatan wajib) untuk yang DISETUJUI. Ajuan milik
 * sendiri tidak diberi tombol — server juga menolaknya (`MILIK_SENDIRI`).
 */
export function TombolKeputusanIzin({
  id,
  status,
  ringkas,
  milikSendiri,
  bolehPutuskan,
  tata = "tumpuk",
  onSelesai,
}: {
  id: string;
  status: string;
  /** "Cuti · 5–7 Okt 2026 · Budi" — untuk teks dialog. */
  ringkas: string;
  milikSendiri: boolean;
  bolehPutuskan: boolean;
  tata?: "tumpuk" | "baris";
  onSelesai?: () => void;
}) {
  const t = useTranslations("izin");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [mode, setMode] = useState<Mode | null>(null);
  const [catatan, setCatatan] = useState("");

  if (!bolehPutuskan || (status !== "DIAJUKAN" && status !== "DISETUJUI")) return null;
  if (milikSendiri) return <span className="text-xs text-muted-foreground">{t("milikSendiri")}</span>;

  const tutup = () => {
    setMode(null);
    setCatatan("");
  };

  const pesanGalat = (r: Extract<HasilKeputusanIzinAction, { ok: false }>) =>
    r.kode === "KUOTA_CUTI_HABIS" ? t("err.KUOTA_CUTI_HABIS", { tahun: r.tahun, sisa: r.sisa }) : td(`err.${r.kode}`);

  const jalankan = () =>
    mulai(async () => {
      if (!mode) return;
      let r: HasilKeputusanIzinAction;
      try {
        r =
          mode === "setujui"
            ? await setujuiIzinAction(id, catatan)
            : mode === "tolak"
              ? await tolakIzinAction(id, catatan)
              : await batalkanIzinAction(id, catatan);
      } catch {
        toast.error(t("err.GAGAL"));
        return;
      }
      if (r.ok) {
        toast.success(td(`ok.${mode}`));
        tutup();
        onSelesai?.();
        router.refresh();
      } else {
        toast.error(pesanGalat(r));
        if (r.kode === "SUDAH_DIPUTUSKAN") {
          tutup();
          router.refresh();
        }
      }
    });

  const wajib = mode === "tolak" || mode === "batalkan";

  return (
    <>
      <span className={cn("inline-flex gap-1", tata === "tumpuk" ? "flex-col items-end" : "flex-wrap")}>
        {status === "DIAJUKAN" ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => setMode("setujui")}>
              <CircleCheck className="mr-1.5 h-3.5 w-3.5" />
              {t("setujui")}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setMode("tolak")}>
              <CircleX className="mr-1.5 h-3.5 w-3.5" />
              {t("tolak")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setMode("batalkan")}>
            <Ban className="mr-1.5 h-3.5 w-3.5" />
            {t("batalkan")}
          </Button>
        )}
      </span>

      <Dialog open={mode !== null} onOpenChange={(v) => !v && !pending && tutup()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode ? td(`dialog.${mode}.judul`) : null}</DialogTitle>
            <DialogDescription>{mode ? td(`dialog.${mode}.isi`, { ringkas }) : null}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`catatan-izin-${id}`}>
              {wajib ? t("catatanWajibLabel") : t("catatanLabel")}
              {wajib ? <span className="ml-1 text-destructive">*</span> : null}
            </Label>
            <Textarea
              id={`catatan-izin-${id}`}
              value={catatan}
              maxLength={BATAS_ALASAN_IZIN}
              rows={3}
              placeholder={mode ? td(`dialog.${mode}.petunjuk`) : undefined}
              onChange={(e) => setCatatan(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={tutup} disabled={pending}>
              {t("batal")}
            </Button>
            <Button
              variant={mode === "setujui" ? "default" : "destructive"}
              disabled={pending || (wajib && !catatan.trim())}
              onClick={jalankan}
            >
              {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {mode ? td(mode) : null}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
