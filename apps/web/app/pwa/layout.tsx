import { Suspense } from "react";
import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap, spgBerhentiPada } from "@/lib/pwa/peran";
import { logout } from "./actions";
import { SpgBerhentiLayar } from "./SpgBerhentiLayar";
import { MenuBawahSalesman } from "./MenuBawahSalesman";
import { MenuBawahSpg } from "./MenuBawahSpg";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar";
import { PwaPushRegistrar } from "./PwaPushRegistrar";
import { SinkronLatar } from "./SinkronLatar";
import { SegarkanPush } from "./kabar/SegarkanPush";
import { RiwayatNavigasi } from "./RiwayatNavigasi";
import { PemantauLuringHp } from "@/components/pulau/PemantauLuringHp";
import { PemantauKabarHp } from "@/components/pulau/PemantauKabarHp";

export const metadata = {
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#334155",
};

export default async function PwaLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/pwa");
  const perms = session.user.permissions;
  const outcome = pwaAccessGuard(perms);
  if (outcome === "redirect-backoffice") redirect("/backoffice");
  // SPG punya satu toko tetap dan menunya sendiri; menu salesman bukan miliknya.
  const spg = session.user.id ? (await ambilTokoTetap(session.user.id)) !== null : false;
  /*
   * SPG yang sudah ditandai berhenti (P66): tokonya dilepas, jadi ia tidak lagi terbaca sebagai
   * SPG — tetapi juga bukan salesman keliling. Ia hanya mendapat layar berhenti; penyinkron latar
   * tetap dipasang supaya penjualan dan check-in yang ditangkap sampai hari terakhirnya terkirim.
   */
  const berhenti = !spg && session.user.id ? await spgBerhentiPada(session.user.id) : null;
  if (berhenti) {
    const toko = await prisma.store.findUnique({ where: { id: berhenti.storeId }, select: { name: true } });
    return (
      <>
        <ServiceWorkerRegistrar />
        <SinkronLatar />
        <PemantauLuringHp tautanAntrean="/pwa" />
        <div className="pwa-app mx-auto flex min-h-dvh w-full max-w-xl flex-col md:border-x">
          <SpgBerhentiLayar
            namaToko={toko?.name ?? ""}
            hariTerakhir={formatDisplayDate(`${berhenti.hariTerakhir}T00:00:00+07:00`)}
            onLogout={logout}
          />
        </div>
      </>
    );
  }
  return (
    <>
      <ServiceWorkerRegistrar />
      <PwaPushRegistrar />
      <SinkronLatar />
      <SegarkanPush />
      {/* Sinyal, antrean, dan kabar baru → pulau status di tengah atas (dipasang di app/layout.tsx). */}
      <PemantauLuringHp tautanAntrean={spg ? "/pwa/spg/antrean" : "/pwa/orders/pending"} />
      <PemantauKabarHp />
      {/* useSearchParams di dalamnya butuh batas Suspense supaya tata letak tetap dirender di server. */}
      <Suspense fallback={null}>
        <RiwayatNavigasi />
      </Suspense>
      {/* Aplikasi ini dirancang untuk HP. Di layar lebar (tablet, laptop) ia
          tetap satu kolom selebar HP di tengah, bukan kartu yang melebar
          sampai tepi dan tampak kosong. `pwa-app` menjadi cakupan aturan
          sasaran-sentuh 44 px di globals.css. */}
      <div className="pwa-app mx-auto flex min-h-dvh w-full max-w-xl flex-col md:border-x">
        <div className="flex-1">{children}</div>
        {spg ? <MenuBawahSpg /> : <MenuBawahSalesman />}
      </div>
    </>
  );
}
