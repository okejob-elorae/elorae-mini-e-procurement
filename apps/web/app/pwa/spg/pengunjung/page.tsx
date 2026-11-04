import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { formatDisplayDate } from "@/lib/date-only";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { pengunjungUntukHp, riwayatPengunjungHp } from "@/lib/spg/pengunjung-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { PenghitungPengunjungClient } from "./PenghitungPengunjungClient";

export const dynamic = "force-dynamic";

const hariPanjang = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long" });
/** "Sabtu, 3 Okt 2026" — kunci hari WIB, diformat di server. */
const labelHari = (day: string) => {
  const d = new Date(`${day}T00:00:00+07:00`);
  return `${hariPanjang.format(d)}, ${formatDisplayDate(d)}`;
};

/**
 * Penghitung pengunjung counter: SPG mengetuk setiap kali ada pengunjung.
 * Hanya SPG; toko SELALU toko tetapnya dari server. Angka awal (milik sendiri
 * + total toko hari ini) dimuat di sini, sesudahnya layar bekerja dari
 * catatan di HP dan menyinkronkannya sendiri — juga tanpa sinyal.
 */
export default async function PengunjungSpgPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const day = kunciHariWib(new Date());
  const [awal, riwayat] = await Promise.all([
    pengunjungUntukHp(session.user.id, toko.id, day),
    riwayatPengunjungHp(session.user.id, toko.id, day),
  ]);

  return (
    <PenghitungPengunjungClient
      userId={session.user.id}
      storeId={toko.id}
      namaToko={toko.name}
      awal={awal}
      labelHari={labelHari(day)}
      riwayat={riwayat.map((r) => ({ ...r, label: labelHari(r.day) }))}
    />
  );
}
