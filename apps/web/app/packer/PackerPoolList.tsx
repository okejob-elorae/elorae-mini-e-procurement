"use client";

import type { PackerPoolItem } from "@/lib/packer/pool";
import { poolItemIsRecording } from "@/lib/packer/pool";

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type PackerPoolListProps = {
  items: PackerPoolItem[];
  recordingCode: string | null;
  loading?: boolean;
  onRefresh?: () => void;
};

export function PackerPoolList({
  items,
  recordingCode,
  loading,
  onRefresh,
}: PackerPoolListProps) {
  return (
    <aside className="flex h-full w-[min(100%,20rem)] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 text-white">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Pool order</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Order dengan resi. Scan barcode → cocok → rekam (start/end).
            </p>
          </div>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="shrink-0 rounded-md bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
            >
              Refresh
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading && items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-700 px-3 py-6 text-center text-xs text-zinc-500">
            Memuat pool…
          </p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-700 px-3 py-6 text-center text-xs text-zinc-500">
            Tidak ada order dengan trackingNumber yang menunggu rekam.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const isRecording = poolItemIsRecording(item, recordingCode);
              return (
                <li
                  key={item.id}
                  className={`rounded-lg border px-3 py-2.5 ${
                    isRecording
                      ? "border-red-500/60 bg-red-950/40"
                      : "border-zinc-700 bg-zinc-900"
                  }`}
                >
                  <p className="break-all font-mono text-xs leading-snug">
                    {item.trackingNumber}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-300">{item.salesorderNo}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {item.customerName || "—"}
                    {item.courier ? ` · ${item.courier}` : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {formatDate(item.transactionDate)}
                  </p>
                  {isRecording ? (
                    <p className="mt-1 text-[11px] font-medium text-red-400">
                      Sedang direkam
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
        {items.length} order menunggu rekam
      </div>
    </aside>
  );
}
