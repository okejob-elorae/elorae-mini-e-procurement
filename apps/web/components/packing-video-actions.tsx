"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  videoUrl: string;
  salesOrderId: string;
  /** When true, show the full URL as the open link text. */
  showFullUrl?: boolean;
  openLabel?: string;
  downloadLabel?: string;
  className?: string;
};

export function PackingVideoActions({
  videoUrl,
  salesOrderId,
  showFullUrl = false,
  openLabel = "Buka video",
  downloadLabel = "Unduh",
  className,
}: Props) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <a
        href={videoUrl}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 break-all text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
      >
        {showFullUrl ? videoUrl : openLabel}
      </a>
      <Button variant="outline" size="sm" asChild className="shrink-0">
        <a href={`/api/packing-videos/${encodeURIComponent(salesOrderId)}/download`}>
          <Download className="h-4 w-4" />
          {downloadLabel}
        </a>
      </Button>
    </div>
  );
}
