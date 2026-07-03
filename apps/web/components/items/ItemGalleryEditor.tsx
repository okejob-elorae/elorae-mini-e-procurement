"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageGallery } from "./ImageGallery";
import { replaceItemImagesAction } from "@/lib/items/images/mutations";
import type { ItemImageSubmission, ItemImageDto } from "@/lib/items/images/types";

type Props = {
  itemId: string;
  variants: Array<{ sku: string }>;
  initial: ItemImageDto[];
  canManage: boolean;
};

export function ItemGalleryEditor({ itemId, variants, initial, canManage }: Props) {
  const t = useTranslations("items.images");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [submissions, setSubmissions] = useState<ItemImageSubmission[]>(
    initial.map((i) => ({
      id: i.id,
      url: i.url,
      variantSku: i.variantSku,
      sortOrder: i.sortOrder,
    })),
  );

  const productLevel = submissions.filter((s) => s.variantSku === null);
  const byVariant: Map<string, ItemImageSubmission[]> = new Map();
  for (const v of variants) {
    byVariant.set(v.sku, submissions.filter((s) => s.variantSku === v.sku));
  }

  function setGroup(variantSku: string | null, next: ItemImageSubmission[]) {
    const others = submissions.filter((s) => s.variantSku !== variantSku);
    setSubmissions([...others, ...next]);
  }

  async function uploadFiles(files: File[], _variantSku: string | null): Promise<string[]> {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const res = await fetch(`/api/upload/item-image?itemId=${itemId}`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string; error?: string }).message ?? (err as { error?: string }).error ?? "upload failed");
    }
    const { urls } = await res.json() as { urls: string[] };
    return urls;
  }

  function save() {
    startTransition(async () => {
      const result = await replaceItemImagesAction(itemId, submissions);
      if (result.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else {
        toast.error(t(`error.${result.code}` as never));
      }
    });
  }

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2">{t("productGallery")}</h3>
        <ImageGallery
          variantSku={null}
          items={productLevel}
          onChange={(next) => setGroup(null, next)}
          onUpload={uploadFiles}
          canManage={canManage}
        />
      </div>
      {variants.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">{t("variantGalleries")}</h3>
          <div className="space-y-3">
            {variants.map((v) => (
              <div key={v.sku}>
                <div className="text-xs text-muted-foreground mb-1">{v.sku}</div>
                <ImageGallery
                  variantSku={v.sku}
                  items={byVariant.get(v.sku) ?? []}
                  onChange={(next) => setGroup(v.sku, next)}
                  onUpload={uploadFiles}
                  canManage={canManage}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={isPending}>
            {t("save")}
          </Button>
        </div>
      )}
    </Card>
  );
}
