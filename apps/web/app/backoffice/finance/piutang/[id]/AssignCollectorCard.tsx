"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, UserCog } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { assignCollectorAction, type CollectionActionReason } from "@/app/actions/collections";

type Props = {
  receivableId: string;
  collectorId: string | null;
  collectorName: string | null;
  collectors: { id: string; name: string }[];
  canManageCollections: boolean;
};

const UNASSIGNED = "__unassigned__";

function errKey(reason: CollectionActionReason): string {
  return `err.${reason}`;
}

export function AssignCollectorCard({
  receivableId,
  collectorId,
  collectorName,
  collectors,
  canManageCollections,
}: Props) {
  const t = useTranslations("piutang");
  const tErr = useTranslations("financeCollections");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState(collectorId ?? UNASSIGNED);

  const dirty = selected !== (collectorId ?? UNASSIGNED);

  function handleApply(): void {
    const nextCollectorId = selected === UNASSIGNED ? null : selected;
    startTransition(async () => {
      try {
        const r = await assignCollectorAction({ receivableIds: [receivableId], collectorId: nextCollectorId });
        if (r.ok) {
          toast.success(nextCollectorId === null ? t("detail.unassignSuccessToast") : t("detail.assignSuccessToast"));
          router.refresh();
        } else {
          toast.error(tErr(errKey(r.reason)));
        }
      } catch {
        toast.error(tErr("err.ERROR"));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCog className="h-5 w-5" />
          {t("detail.assignCollectorTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("detail.currentCollectorLabel")}</span>
          <span className="text-right font-medium">{collectorName ?? t("unassignedLabel")}</span>
        </div>
        {canManageCollections && (
          <div className="flex flex-col sm:flex-row gap-2">
            <SearchableCombobox
              options={[
                { value: UNASSIGNED, label: t("unassignedLabel") },
                ...collectors.map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={selected}
              onValueChange={setSelected}
              placeholder={t("unassignedLabel")}
              searchPlaceholder={t("collectorSearchPlaceholder")}
              emptyMessage={t("collectorSearchEmpty")}
              triggerClassName="h-10 w-full sm:flex-1"
              disabled={isPending}
            />
            <Button className="h-10 shrink-0" disabled={isPending || !dirty} onClick={handleApply}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("assignCollectorButton")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
