import { getJubelioCategoryMappings } from "@/app/actions/jubelio-categories";
import { CategoryMappingsClient } from "./CategoryMappingsClient";

export default async function JubelioCategoriesPage() {
  const rows = await getJubelioCategoryMappings();
  return <CategoryMappingsClient initialRows={rows} />;
}
