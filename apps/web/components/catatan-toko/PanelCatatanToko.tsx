"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MoreVertical, Pencil, Pin, PinOff, Plus, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_CATATAN } from "@/lib/stores/catatan";
import type { CatatanTampil } from "@/lib/stores/catatan-queries";
import { cn } from "@/lib/utils";
import {
  hapusCatatanTokoAction,
  sematCatatanTokoAction,
  tambahCatatanTokoAction,
  ubahCatatanTokoAction,
  type HasilAksiCatatan,
} from "@/app/actions/catatan-toko";

/**
 * Daftar catatan toko + lembar tambah/ubah — satu isi untuk halaman toko di HP
 * (`app/pwa/stores/[id]/CatatanToko.tsx`, lembar dari bawah) dan kartu detail
 * toko kantor (`app/backoffice/stores/[id]/CatatanTokoCard.tsx`, lembar dari
 * kanan). Hak per baris (`bolehKelola`) dan tanggal sudah dihitung di server;
 * di sini hanya menyembunyikan tombol — aksinya menilai ulang.
 */
export function PanelCatatanToko({
  storeId,
  catatan,
  bolehTulis,
  sisi,
  batasAwal = 5,
}: {
  storeId: string;
  catatan: CatatanTampil[];
  bolehTulis: boolean;
  sisi: "bottom" | "right";
  /** Catatan yang tampil sebelum "Tampilkan semua". */
  batasAwal?: number;
}) {
  const t = useTranslations("catatanToko");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [semua, setSemua] = useState(false);
  /** null = lembar tertutup; "baru" = menambah; selain itu catatan yang diubah. */
  const [lembar, setLembar] = useState<"baru" | CatatanTampil | null>(null);
  const [isi, setIsi] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [hapus, setHapus] = useState<CatatanTampil | null>(null);

  const tampil = semua ? catatan : catatan.slice(0, batasAwal);
  const panjang = isi.trim().length;
  const terlaluPanjang = panjang > BATAS_CATATAN;

  function buka(target: "baru" | CatatanTampil) {
    setLembar(target);
    setIsi(target === "baru" ? "" : target.body);
    setGalat(null);
  }

  function jalankan(kerja: () => Promise<HasilAksiCatatan>, berhasil: string, sesudah?: () => void) {
    mulai(async () => {
      let r: HasilAksiCatatan;
      try {
        r = await kerja();
      } catch {
        toast.error(t("err.JARINGAN"));
        return;
      }
      if (r.ok) {
        toast.success(berhasil);
        sesudah?.();
        router.refresh();
        return;
      }
      const pesan = td(`err.${r.kode}`);
      if (lembar && (r.kode === "KOSONG" || r.kode === "TERLALU_PANJANG")) setGalat(pesan);
      else toast.error(pesan);
      // Catatan yang sudah tidak ada (dihapus orang lain) — segarkan daftarnya.
      if (r.kode === "TIDAK_ADA") router.refresh();
    });
  }

  function simpan() {
    if (!lembar) return;
    if (!isi.trim()) {
      setGalat(t("err.KOSONG"));
      return;
    }
    if (terlaluPanjang) {
      setGalat(t("err.TERLALU_PANJANG"));
      return;
    }
    if (lembar === "baru") {
      jalankan(() => tambahCatatanTokoAction(storeId, isi), t("okTambah"), () => setLembar(null));
    } else {
      const id = lembar.id;
      jalankan(() => ubahCatatanTokoAction(id, isi), t("okUbah"), () => setLembar(null));
    }
  }

  return (
    <div className="space-y-3">
      {catatan.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <StickyNote className="h-7 w-7 text-muted-foreground/60" aria-hidden />
          <p className="text-sm font-medium">{t("kosong")}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{t("kosongHint")}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {tampil.map((c) => (
            <li key={c.id} className={cn("flex gap-2 px-3 py-2.5", c.pinned && "bg-amber-500/5")}>
              <div className="min-w-0 flex-1 space-y-1">
                {c.pinned ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
                    <Pin className="h-3.5 w-3.5" aria-hidden />
                    {t("tersemat")}
                  </span>
                ) : null}
                <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
                <p className="text-xs text-muted-foreground">
                  {c.milikSaya ? t("olehSaya") : c.penulis} · <span className="tabular-nums">{c.dibuat}</span>
                  {c.diperbarui ? <> · {t("diperbarui", { tanggal: c.diperbarui })}</> : null}
                </p>
              </div>
              {c.bolehKelola ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="-mr-1 shrink-0" disabled={sibuk} aria-label={t("aksiUntuk", { penulis: c.penulis })}>
                      <MoreVertical className="h-4 w-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => buka(c)}>
                      <Pencil aria-hidden />
                      {t("ubah")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        jalankan(() => sematCatatanTokoAction(c.id, !c.pinned), c.pinned ? t("okLepasSemat") : t("okSemat"))
                      }
                    >
                      {c.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                      {c.pinned ? t("lepasSemat") : t("semat")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setHapus(c)}>
                      <Trash2 aria-hidden />
                      {t("hapus")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {catatan.length > batasAwal ? (
          <Button variant="link" className="h-auto px-0" onClick={() => setSemua((s) => !s)}>
            {semua ? t("ringkas") : t("tampilkanSemua", { count: catatan.length })}
          </Button>
        ) : (
          <span />
        )}
        {bolehTulis ? (
          <Button variant="outline" size="sm" disabled={sibuk} onClick={() => buka("baru")}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("tambah")}
          </Button>
        ) : null}
      </div>

      <Sheet open={lembar !== null} onOpenChange={(o) => !o && !sibuk && setLembar(null)}>
        <SheetContent
          side={sisi}
          className={cn(
            "flex flex-col gap-0 p-0",
            sisi === "bottom" ? "mx-auto max-h-[90dvh] w-full max-w-xl" : "w-full sm:max-w-md",
          )}
        >
          <SheetHeader className="border-b pb-3">
            <SheetTitle>{lembar === "baru" ? t("judulTambah") : t("judulUbah")}</SheetTitle>
            <SheetDescription>{t("lembarHint")}</SheetDescription>
          </SheetHeader>
          <div className="space-y-2 overflow-y-auto p-4">
            <Label htmlFor="catatan-toko-isi">{t("isiLabel")}</Label>
            <Textarea
              id="catatan-toko-isi"
              value={isi}
              onChange={(e) => {
                setIsi(e.target.value);
                setGalat(null);
              }}
              placeholder={t("isiPlaceholder")}
              rows={5}
              autoFocus
              aria-invalid={galat !== null || terlaluPanjang}
              aria-describedby="catatan-toko-hitung"
            />
            <div className="flex items-start justify-between gap-2 text-xs">
              <p className="text-destructive" role={galat ? "alert" : undefined}>
                {galat}
              </p>
              <p id="catatan-toko-hitung" className={cn("shrink-0 tabular-nums", terlaluPanjang ? "text-destructive" : "text-muted-foreground")}>
                {t("hitung", { n: panjang, maks: BATAS_CATATAN })}
              </p>
            </div>
          </div>
          <SheetFooter className="flex-row gap-2 border-t pt-3">
            <Button variant="outline" className="h-11 flex-1" disabled={sibuk} onClick={() => setLembar(null)}>
              {t("batal")}
            </Button>
            <Button className="h-11 flex-1" disabled={sibuk || panjang === 0 || terlaluPanjang} onClick={simpan}>
              {t("simpan")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={hapus !== null} onOpenChange={(o) => !o && !sibuk && setHapus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hapusJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("hapusIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          {hapus ? <p className="line-clamp-4 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">{hapus.body}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                if (!hapus) return;
                const id = hapus.id;
                jalankan(() => hapusCatatanTokoAction(id), t("okHapus"), () => setHapus(null));
              }}
            >
              {t("hapus")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
