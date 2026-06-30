import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PRISMA, type PrismaService } from "../db/prisma.module";
import { JubelioHttpService } from "./http.service";

export type UploadInput = {
  id: string;
  url: string;
  jubelioImageKey: string | null;
};

type UploadResponse = { success: boolean; key: string; thumbnail: string; name?: string };

@Injectable()
export class JubelioImageUploadService {
  private readonly logger = new Logger(JubelioImageUploadService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async ensureUploaded(images: UploadInput[]): Promise<void> {
    const pending = images.filter((i) => i.jubelioImageKey === null);
    if (pending.length === 0) return;

    for (const img of pending) {
      try {
        const blob = await this.fetchR2(img.url);
        const name = multipartFileName(img.url, img.id);
        const uid = randomUUID();

        const fd = new FormData();
        fd.append("file", blob, name);
        fd.append("uid", uid);
        fd.append("name", name);
        fd.append("TotalFileSize", String(blob.size));

        const res = await this.http.upload<UploadResponse>("/inventory/upload-image", fd);
        await this.prisma.itemImage.update({
          where: { id: img.id },
          data: {
            jubelioImageKey: res.key,
            jubelioImageThumbnail: res.thumbnail,
            syncedAt: new Date(),
          },
        });
        this.logger.log(`Uploaded image ${img.id} → ${res.key}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`upload failed for image ${img.id} (${img.url}): ${message}`);
      }
    }
  }

  private async fetchR2(url: string): Promise<Blob> {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`R2 fetch failed: ${url} (${resp.status})`);
    return resp.blob();
  }
}

/**
 * Labels the blob for the multipart `name`/`file` fields sent to Jubelio's
 * upload-image endpoint. Returns `${fallback}.bin` on parse failure so the
 * upload has a safe non-empty filename.
 * Kept separate from `fileNameFromUrl` in product-push.payload.ts, which
 * strips the extension for Jubelio's `file_name` catalog field.
 */
function multipartFileName(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").pop() ?? "";
    return base || `${fallback}.bin`;
  } catch {
    return `${fallback}.bin`;
  }
}
