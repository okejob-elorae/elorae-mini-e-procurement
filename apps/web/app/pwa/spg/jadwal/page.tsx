import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { tokoSpg } from "@/lib/spg/queries";
import { jadwalSpgHp } from "@/lib/spg/shift-queries";
import { jadwalBulanSaya } from "@/lib/spg/jadwal-bulan-queries";
import { JadwalSpgHpClient } from "./JadwalSpgHpClient";
import { IsiJadwalBulan } from "./IsiJadwalBulan";

export const dynamic = "force-dynamic";

/**
 * Jadwal kerja SPG di HP: 14 hari mulai hari ini — shift sendiri dan rekan
 * setoko — beserta tukar shift (mengajukan, menjawab ajuan rekan,
 * membatalkan). Hanya SPG; toko selalu toko tetapnya, dari server.
 *
 * Di bawahnya jadwal BULANAN (P7c): SPG mengisi bulan ini dan bulan depan lalu mengajukannya —
 * dasar gaji pokoknya.
 */
export default async function JadwalSpgPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const sekarang = new Date();
  const [data, bulanan] = await Promise.all([
    jadwalSpgHp({ userId: session.user.id, storeId: toko.id, sekarang }),
    jadwalBulanSaya({ userId: session.user.id, storeId: toko.id, sekarang }),
  ]);
  return (
    <>
      <JadwalSpgHpClient namaToko={toko.name} data={data} />
      <div className="px-4 pb-24">
        <IsiJadwalBulan data={bulanan} />
      </div>
    </>
  );
}
