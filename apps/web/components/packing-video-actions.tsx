"use client";

import { Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ClipRecording } from "@/lib/packer/clip-recording";
import { formatDateTime } from "@/lib/sales-orders/format";

/* `at` arrives as an ISO string when the row went through `serializeForClient` */
type RecordingProp = Omit<ClipRecording, "at"> & { at: Date | string };

type Props = {
  videoUrl: string;
  salesOrderId: string;
  /** When true, show the full URL as the open link text. */
  showFullUrl?: boolean;
  openLabel?: string;
  downloadLabel?: string;
  recording?: RecordingProp | null;
  className?: string;
};

export function PackingVideoActions({
  videoUrl,
  salesOrderId,
  showFullUrl = false,
  openLabel = "Buka video",
  downloadLabel = "Unduh",
  recording,
  className,
}: Props) {
  return (
    <div className={`min-w-0 space-y-1 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-2">
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
      {recording ? <RecordingLine recording={recording} /> : null}
    </div>
  );
}

function RecordingLine({ recording }: { recording: RecordingProp }) {
  const t = useTranslations("packingVideo");
  const locale = useLocale();
  const when = formatDateTime(new Date(recording.at), locale);
  const recordedLabel = recording.isRerecord ? t("rerecorded", { when }) : t("recorded", { when });

  return (
    <div className="text-xs text-muted-foreground">
      {recording.byName ? t("recordedBy", { recorded: recordedLabel, name: recording.byName }) : recordedLabel}
    </div>
  );
}
