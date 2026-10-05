"use client";

import { BantuanClient } from "@/components/bantuan/BantuanClient";
import type { BagianHp } from "@/lib/bantuan/jenis";
import { Button } from "@/components/ui/button";
import { TautanKembali } from "../TautanKembali";

export function BantuanHp({ kembaliKe, bagian }: { kembaliKe: string; bagian: BagianHp[] }) {
  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan={kembaliKe} />
      </Button>
      <BantuanClient area="hp" bagianHp={bagian} />
    </div>
  );
}
