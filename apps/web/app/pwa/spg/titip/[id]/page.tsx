import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { tokoSpg } from "@/lib/spg/queries";
import { rincianTitipHp } from "@/lib/spg/titip-queries";
import { mintaDariPembeli } from "../../stok/minta/dari-pembeli";
import { barangTitipMenunggu } from "../minta-queries";
import { RincianTitipClient } from "./RincianTitipClient";

export const dynamic = "force-dynamic";

/** Satu titip pesan toko SPG; milik toko lain tampil sebagai "tidak ditemukan". */
export default async function SpgRincianTitipPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/titip");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  const { id } = await params;
  const rincian = await rincianTitipHp(toko.id, id);
  // Barang yang masih ditunggu pembeli bisa langsung diminta ke salesman.
  const bahan = rincian?.kelompok === "menunggu" ? (await barangTitipMenunggu(toko.id, [id])).get(id) : undefined;
  const minta = bahan ? mintaDariPembeli([bahan], "TITIP_PEMBELI") : null;
  return (
    <RincianTitipClient rincian={rincian} minta={minta ? { alamat: minta.alamat, dariKatalog: minta.terisi > 0 } : null} />
  );
}
