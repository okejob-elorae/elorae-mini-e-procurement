"use client";

import { useTranslations } from "next-intl";
import { Link2, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { bacaSaluranPesanan, SALURAN_PORTAL } from "@/lib/field-sales/jarak-jauh";
import { cn } from "@/lib/utils";

/**
 * Lencana pesanan yang dicatat tanpa kunjungan (`FieldSalesOrder.remoteChannel`):
 * "Jarak jauh · WhatsApp" untuk pesanan yang dicatat salesman lewat WA/telepon,
 * dan "Portal toko" untuk pesanan yang dibuat toko sendiri lewat tautan portal.
 * Tidak menampilkan apa pun untuk pesanan kunjungan biasa. Dipakai daftar &
 * detail pesanan, di HP maupun di kantor.
 */
export function LencanaJarakJauh({ saluran, className }: { saluran: string | null | undefined; className?: string }) {
  const t = useTranslations("pwa.jarakJauh");
  const s = bacaSaluranPesanan(saluran);
  if (!s) return null;
  const portal = s === SALURAN_PORTAL;
  const Ikon = portal ? Link2 : MessageCircle;
  return (
    <Badge variant="outline" className={cn("gap-1 border-primary/40 text-primary", className)}>
      <Ikon className="h-3 w-3" aria-hidden />
      {portal ? t("saluran.PORTAL") : t("lencana", { saluran: t(`saluran.${s}`) })}
    </Badge>
  );
}
