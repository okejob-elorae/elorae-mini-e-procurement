import { listActiveStoresForPwa } from "@/lib/stores/queries";
import { StoreList } from "./StoreList";

export const dynamic = "force-dynamic";

export default async function PwaStoreList() {
  const stores = await listActiveStoresForPwa();
  return (
    <StoreList stores={stores.map(s => ({
      id: s.id,
      name: s.name,
      code: s.code,
      termsType: s.termsType,
      lat: s.lat,
      lng: s.lng,
    }))} />
  );
}
