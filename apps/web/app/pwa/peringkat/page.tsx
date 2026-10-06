import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { peringkatHp } from "@/lib/salesman/peringkat-hp-queries";
import { peringkatSpgBulan } from "@/lib/salesman/peringkat-spg";
import { PeringkatClient } from "./PeringkatClient";
import { PeringkatSpgClient } from "./PeringkatSpgClient";

export const dynamic = "force-dynamic";

/**
 * Papan peringkat salesman bulan ini, menurut capaian target.
 *
 * Seluruhnya atas putus + van (`peringkatHp`): rupiah konsinyasi tidak pernah
 * sampai ke HP, dan papan dengan angka resmi (memuat konsi) membukanya lewat
 * capaian sendiri × target. Konsinyasi hanya sebagai pcs milik sendiri.
 * Omzet rekan tidak pernah dikirim ke HP — hanya persen capaiannya. Nama
 * rekan disembunyikan bila pemilik mengaturnya (`salesman.peringkat`); nama
 * sendiri selalu terlihat.
 *
 * SPG mendapat papannya sendiri — SPG dengan SPG, menurut penjualan bersih
 * bulan ini (`peringkatSpgBulan`), tidak dicampur salesman.
 */
export default async function PeringkatPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const sekarang = new Date();
  const bulan = bulanWib(sekarang);
  if (await ambilTokoTetap(session.user.id)) {
    const { baris } = await peringkatSpgBulan(bulan, session.user.id, sekarang);
    return (
      <PeringkatSpgClient
        bulan={bulan}
        // Id pengguna rekan tidak dikirim (sama dengan papan salesman).
        baris={baris.map((b) => ({
          peringkat: b.peringkat,
          posisi: b.posisi,
          nama: b.nama,
          toko: b.toko,
          omzet: b.omzet,
          pcs: b.pcs,
          diriSendiri: b.diriSendiri,
        }))}
      />
    );
  }

  // Id pengguna rekan sudah tidak ikut dari `peringkatHp`: saat nama
  // disembunyikan, "Sales #n" tidak boleh bisa ditelusuri balik.
  const baris = await peringkatHp(bulan, session.user.id, { hariIni: sekarang });

  return <PeringkatClient bulan={bulan} baris={baris} />;
}
