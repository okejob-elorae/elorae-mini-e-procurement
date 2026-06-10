import { getEligibleItems, getMigrationSummary } from "@/app/actions/jubelio-bulk-migration";
import { MigrationClient } from "./MigrationClient";

export default async function MigrationPage() {
  const [items, summary] = await Promise.all([
    getEligibleItems(),
    getMigrationSummary(),
  ]);
  return <MigrationClient initialItems={items} initialSummary={summary} />;
}
