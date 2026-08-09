"use client";

import Link from "next/link";
import { Pencil, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PackerListItem } from "@/lib/packer/serialize";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function PackerListClient({ items }: { items: PackerListItem[] }) {
  return (
    <div className="space-y-6">
      <div className="flex justify-center pt-2">
        <Button asChild size="lg" className="h-12 rounded-full px-8 text-base shadow-md">
          <Link href="/packer/record">Record Video Packing</Link>
        </Button>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Record terakhir
        </h2>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-slate-500">
            Belum ada video packing. Mulai dengan tombol di atas.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1 text-sm">
                    <div className="font-semibold text-slate-900">
                      {item.salesOrder.salesorderNo}
                      {item.salesOrder.channelOrderNo
                        ? ` · ${item.salesOrder.channelOrderNo}`
                        : ""}
                    </div>
                    <div className="text-slate-600">
                      Buyer: {item.salesOrder.customerName || "—"}
                    </div>
                    <div className="text-slate-600">
                      Order: {formatDate(item.salesOrder.transactionDate)}
                    </div>
                    {item.salesOrder.latestReturnAt && (
                      <div className="text-amber-700">
                        Retur: {formatDate(item.salesOrder.latestReturnAt)}
                      </div>
                    )}
                    <div className="text-slate-600">
                      Resi: {item.salesOrder.trackingNumber || "—"}
                    </div>
                    {item.durationSec != null && (
                      <div className="text-slate-500">
                        Durasi: {Math.round(item.durationSec)}s · Direkam{" "}
                        {formatDate(item.recordedAt)}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <Button asChild variant="outline" size="sm" className="gap-1">
                      <a href={item.videoUrl} target="_blank" rel="noreferrer">
                        <Play className="h-3.5 w-3.5" />
                        Play
                      </a>
                    </Button>
                    <Button asChild variant="secondary" size="sm" className="gap-1">
                      <Link
                        href={`/packer/record?orderId=${item.salesOrder.id}&mode=edit`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit video
                      </Link>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
