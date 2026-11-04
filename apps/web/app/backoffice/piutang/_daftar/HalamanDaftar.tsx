"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pagination } from "@/components/ui/pagination";
import { denganParam } from "./halaman";

/**
 * Pager untuk daftar yang dipotong di server (`?halaman=`). Tidak tampil kalau
 * semuanya muat di satu halaman.
 */
export function HalamanDaftar({
  halaman,
  totalHalaman,
  total,
  ukuran,
}: {
  halaman: number;
  totalHalaman: number;
  total: number;
  ukuran: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (totalHalaman <= 1) return null;
  return (
    <div className="px-4 pb-2">
      <Pagination
        page={halaman}
        totalPages={totalHalaman}
        totalCount={total}
        pageSize={ukuran}
        onPageChange={(h) =>
          router.replace(denganParam(pathname, searchParams, { halaman: h > 1 ? String(h) : null }))
        }
      />
    </div>
  );
}
