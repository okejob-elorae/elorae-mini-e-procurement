"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BadgePlus, Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { daftarkanMemberPelangganAction, type HasilDaftarMemberHp } from "@/app/actions/spg-member-hp";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import type { DaftarMemberHp } from "@/lib/spg/pelanggan-queries";

const KODE_GALAT = new Set(["FORBIDDEN", "NO_ASSIGNED_STORE", "VALIDATION", "PROGRAM_MATI", "MEMBER_NONAKTIF", "PELANGGAN_TIDAK_ADA", "LEWAT_NOTA"]);

/**
 * "Daftarkan jadi member" di rincian pelanggan. Persetujuan pembeli ditanyakan
 * dulu di dialog — member dikenali dari nomor WhatsApp-nya di semua toko Elorae.
 * Tombol yang tidak bisa dipakai mengatakan alasannya di bawahnya.
 */
export function TombolDaftarMember({ customerId, nama, daftar }: { customerId: string; nama: string; daftar: DaftarMemberHp }) {
  const t = useTranslations("spgPelanggan.hpMember");
  const td = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [pending, mulai] = useTransition();

  const alasan = pending ? null : daftar.boleh ? null : td(`tidakBisa.${daftar.alasan}`, { minimal: formatIDR(daftar.minimal) });

  function daftarkan() {
    mulai(async () => {
      let r: HasilDaftarMemberHp;
      try {
        r = await daftarkanMemberPelangganAction({ customerId });
      } catch {
        toast.error(t("err.GENERIC"));
        return;
      }
      if (!r.ok) {
        toast.error(KODE_GALAT.has(r.code) ? td(`err.${r.code}`) : t("err.GENERIC"));
        return;
      }
      setBuka(false);
      toast.success(r.baru ? t("okBaru", { nama }) : t("okSudah", { nama }));
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" className="w-full" disabled={!daftar.boleh || pending} onClick={() => setBuka(true)}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BadgePlus className="h-4 w-4" aria-hidden />}
        {pending ? t("mendaftarkan") : t("daftarkan")}
      </Button>
      <KeteranganKirim teks={alasan} />
      <AlertDialog open={buka} onOpenChange={(v) => !pending && setBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialogJudul", { nama })}</AlertDialogTitle>
            <AlertDialogDescription>{t("dialogIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                // Dialog tetap terbuka sampai server menjawab.
                e.preventDefault();
                daftarkan();
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("setujuDaftar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
