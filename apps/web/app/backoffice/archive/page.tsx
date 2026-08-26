import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getNotaTokoArchive,
  getReturPemasokArchive,
  getWorkOrderArchive,
} from "@/lib/archive/queries";
import { ArchiveTabs } from "./ArchiveTabs";

export const dynamic = "force-dynamic";

/*
 * Copy lives in the client component, not here: this app translates through a
 * client LocaleProvider and has no next-intl server config, so getTranslations
 * throws at render. The server half stays purely about data.
 */
export default async function ArchivePage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [nota, retur, wo] = await Promise.all([
    getNotaTokoArchive(),
    getReturPemasokArchive(),
    getWorkOrderArchive(),
  ]);

  return <ArchiveTabs nota={nota} retur={retur} workOrder={wo} />;
}
