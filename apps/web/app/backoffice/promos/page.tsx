import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listPromos } from "@/lib/promos/queries";
import { PromosPageClient } from "./PromosPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    type?: string;
    active?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const PROMO_TYPE_VALUES = ["PERCENT", "FIXED", "TIERED"] as const;
type PromoType = (typeof PROMO_TYPE_VALUES)[number];

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseType(raw: string | undefined): PromoType | undefined {
  return raw && (PROMO_TYPE_VALUES as readonly string[]).includes(raw) ? (raw as PromoType) : undefined;
}

function parseActive(raw: string | undefined): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

export default async function PromosPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const search = sp.search?.trim() || "";
  const filter = {
    type: parseType(sp.type),
    active: parseActive(sp.active),
    search: sp.search?.trim() || undefined,
  };
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { promos, totalCount } = await listPromos(filter, { page, pageSize });

  return (
    <PromosPageClient
      promos={promos}
      totalCount={totalCount}
      search={search}
      type={filter.type ?? "ALL"}
      active={sp.active === "true" || sp.active === "false" ? sp.active : "ALL"}
      page={page}
      pageSize={pageSize}
    />
  );
}
