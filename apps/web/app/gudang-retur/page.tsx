import { menungguGudang } from "@/lib/receivables/pwa-queries";
import { GudangClient } from "./GudangClient";

export const dynamic = "force-dynamic";

export default async function GudangReturPage() {
  return <GudangClient baris={await menungguGudang()} />;
}
