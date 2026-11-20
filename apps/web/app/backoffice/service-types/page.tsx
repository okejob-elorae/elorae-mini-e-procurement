"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Plus, Pencil, Loader2, ArrowLeft, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { HasilJenisJasa } from "@/app/actions/service-types";

type Translate = ReturnType<typeof useTranslations>;

function makeSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t("nameRequired")),
    code: z.string().min(1, t("codeRequired")).max(50),
    isActive: z.boolean(),
    sortOrder: z.preprocess(
      (val) => (val === "" || val === undefined ? undefined : Number(val)),
      z.number().int().optional(),
    ),
  });
}

type FormData = z.infer<ReturnType<typeof makeSchema>>;

interface ServiceTypeRecord {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number | null;
  dipakai: number;
}

export default function ServiceTypesPage() {
  const tUi = useTranslations("ui");
  const tTable = useTranslations("tableHeaders");
  const tCommon = useTranslations("common");
  const t = useTranslations("serviceTypes");
  const schema = useMemo(() => makeSchema(t), [t]);
  const [rows, setRows] = useState<ServiceTypeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServiceTypeRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as never,
    defaultValues: { name: "", code: "", isActive: true, sortOrder: undefined },
  });

  const isActive = watch("isActive");

  const fetchRows = async () => {
    setIsLoading(true);
    try {
      const { listServiceTypesAction } = await import("@/app/actions/service-types");
      const json = await listServiceTypesAction({ page: 1, pageSize: 200, withUsage: true });
      const list = Array.isArray(json) ? json : json.data;
      setRows(
        list.map((r) => {
          const count = (r as { _count?: { steps?: number } })._count?.steps;
          return {
            id: r.id,
            code: r.code,
            name: r.name,
            isActive: r.isActive,
            sortOrder: r.sortOrder ?? null,
            dipakai: typeof count === "number" ? count : 0,
          };
        }),
      );
    } catch (e) {
      console.error(e);
      toast.error(t("loadFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    reset({ name: "", code: "", isActive: true, sortOrder: undefined });
    setIsDialogOpen(true);
  };

  const openEdit = (row: ServiceTypeRecord) => {
    setEditingId(row.id);
    reset({
      name: row.name,
      code: row.code,
      isActive: row.isActive,
      sortOrder: row.sortOrder ?? undefined,
    });
    setIsDialogOpen(true);
  };

  const pesanGagal = (h: Exclude<HasilJenisJasa, { ok: true }>, kode = "") =>
    h.code === "DUPLICATE_CODE"
      ? t("errDuplicate", { code: kode })
      : h.code === "IN_USE"
        ? t("errInUse", { count: h.count ?? 0 })
        : t("saveFailed");

  const onSubmit = async (data: FormData) => {
    try {
      const { createServiceTypeAction, updateServiceTypeAction } = await import("@/app/actions/service-types");
      const isi = {
        name: data.name,
        code: data.code.trim(),
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      };
      const hasil = editingId
        ? await updateServiceTypeAction(editingId, isi)
        : await createServiceTypeAction(isi);
      if (!hasil.ok) {
        toast.error(pesanGagal(hasil, isi.code));
        return;
      }
      toast.success(editingId ? t("updatedToast") : t("createdToast"));
      setIsDialogOpen(false);
      void fetchRows();
    } catch (e) {
      console.error(e);
      toast.error(t("saveFailed"));
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const { deleteServiceTypeAction } = await import("@/app/actions/service-types");
      const hasil = await deleteServiceTypeAction(deleteTarget.id);
      if (!hasil.ok) {
        toast.error(hasil.code === "FAILED" ? t("deleteFailed") : pesanGagal(hasil));
        return;
      }
      toast.success(t("deletedToast"));
      setDeleteTarget(null);
      void fetchRows();
    } catch (e) {
      console.error(e);
      toast.error(t("deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="mt-0.5 shrink-0">
            <Link href="/backoffice/work-orders" aria-label={t("backToWo")} title={t("backToWo")}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
            <TombolBantuan judul={t("pageTitle")} />
          </div>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          {t("newType")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            {t("cardTitle")}
            {!isLoading ? (
              <span className="text-sm font-normal text-muted-foreground">
                · {t("count", { count: rows.length })}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
              <Button variant="outline" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                {t("newType")}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tUi("name")}</TableHead>
                  <TableHead>{tUi("code")}</TableHead>
                  <TableHead>{t("usage")}</TableHead>
                  <TableHead className="text-center">{t("sort")}</TableHead>
                  <TableHead>{tTable("status")}</TableHead>
                  <TableHead className="w-[96px] text-right">{tCommon("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={cn(!row.isActive && "text-muted-foreground")}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.dipakai > 0 ? t("usageCount", { count: row.dipakai }) : t("usageNone")}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{row.sortOrder ?? "—"}</TableCell>
                    <TableCell>
                      {row.isActive ? (
                        <Badge className="border-emerald-600/25 bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400">
                          {tCommon("active")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{tCommon("inactive")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(row)}
                          aria-label={t("editAria", { name: row.name })}
                          title={tCommon("edit")}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <span title={row.dipakai > 0 ? t("deleteInUse", { count: row.dipakai }) : tCommon("delete")}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(row)}
                            disabled={row.dipakai > 0}
                            aria-label={
                              row.dipakai > 0
                                ? t("deleteInUse", { count: row.dipakai })
                                : t("deleteAria", { name: row.name })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? t("editTitle") : t("createTitle")}</DialogTitle>
            <DialogDescription>
              {editingId ? t("editDescription") : t("createDescription")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="svc-name">{tUi("name")} *</Label>
              <Input id="svc-name" {...register("name")} placeholder={t("namePlaceholder")} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="svc-code">{tUi("code")} *</Label>
              <Input
                id="svc-code"
                {...register("code")}
                placeholder={t("codePlaceholder")}
                disabled={!!editingId}
                className="font-mono"
              />
              {errors.code ? (
                <p className="text-sm text-destructive">{errors.code.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{editingId ? t("codeLocked") : t("codeHelp")}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="svc-sort">{t("sortOrder")}</Label>
              <Input id="svc-sort" type="number" {...register("sortOrder")} />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="svc-active">{tCommon("active")}</Label>
                <p className="text-xs text-muted-foreground">{t("activeHelp")}</p>
              </div>
              <Switch
                id="svc-active"
                checked={isActive}
                onCheckedChange={(v) => setValue("isActive", v, { shouldDirty: true })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t("updateButton")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? t("deleteBodyNamed", { name: deleteTarget.name, code: deleteTarget.code })
                : t("deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void onDelete();
              }}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {tCommon("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
