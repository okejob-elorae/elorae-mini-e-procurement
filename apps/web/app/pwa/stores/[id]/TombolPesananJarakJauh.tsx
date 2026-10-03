"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MessageCircle, MoreHorizontal, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SALURAN_JARAK_JAUH, type SaluranJarakJauh } from "@/lib/field-sales/jarak-jauh";

const IKON: Record<SaluranJarakJauh, typeof Phone> = {
  WA: MessageCircle,
  TELEPON: Phone,
  LAINNYA: MoreHorizontal,
};

/**
 * "Pesanan jarak jauh": toko memesan lewat WhatsApp/telepon, salesman mencatatnya
 * tanpa datang (tanpa check-in). Tombol membuka lembar kecil untuk memilih
 * salurannya, lalu membuka katalog dalam mode jarak jauh. Aturan pemilik (boleh
 * tidaknya, hanya toko sendiri) dinilai lagi di katalog dan saat pesanan dibuat.
 */
export function TombolPesananJarakJauh({ storeId }: { storeId: string }) {
  const t = useTranslations("pwa.jarakJauh");
  const [buka, setBuka] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setBuka(true)}>
        <MessageCircle className="h-4 w-4" aria-hidden />
        {t("tombol")}
      </Button>
      <Sheet open={buka} onOpenChange={setBuka}>
        <SheetContent side="bottom" className="gap-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{t("judulLembar")}</SheetTitle>
            <SheetDescription>{t("isiLembar")}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4">
            {SALURAN_JARAK_JAUH.map((s) => {
              const Ikon = IKON[s];
              return (
                <Button key={s} asChild variant="outline" size="lg" className="justify-start">
                  <Link href={`/pwa/stores/${storeId}/catalog?jarakJauh=${s}`} onClick={() => setBuka(false)}>
                    <Ikon className="h-4 w-4" aria-hidden />
                    {t(`saluran.${s}`)}
                  </Link>
                </Button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
