import { listPackingVideos } from "@/lib/packer/queries";
import { serializePackingVideos } from "@/lib/packer/serialize";
import { PackerListClient } from "./PackerListClient";

export const dynamic = "force-dynamic";

export default async function PackerHomePage() {
  const items = await listPackingVideos(50);
  return <PackerListClient items={serializePackingVideos(items)} />;
}
