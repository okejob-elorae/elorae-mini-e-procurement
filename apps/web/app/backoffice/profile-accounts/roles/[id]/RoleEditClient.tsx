"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { updateRolePermissions } from "@/app/actions/rbac";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type RoleDetail = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Array<{ id: string }>;
};

type Permission = {
  id: string;
  code: string;
  module: string;
  action: string;
  description: string | null;
};

type Props = {
  role: RoleDetail;
  permissions: Record<string, Permission[]>;
};

export function RoleEditClient({ role, permissions }: Props) {
  const t = useTranslations("profileAccounts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(
    () => new Set(role.permissions.map((p) => p.id)),
  );

  function togglePermission(permissionId: string) {
    if (role.isSystem) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  }

  function toggleModule(module: string) {
    if (role.isSystem) return;
    const ids = (permissions[module] || []).map((p) => p.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateRolePermissions(role.id, Array.from(selected));
        toast.success(t("roleUpdated"));
        router.push("/backoffice/profile-accounts?tab=roles");
        router.refresh();
      } catch (error: unknown) {
        toast.error(
          error instanceof Error ? error.message : t("roleUpdateFailed"),
        );
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/backoffice/profile-accounts?tab=roles">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t("backToRoles")}
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {t("editRoleTitle", { name: role.name })}
            {role.isSystem && (
              <Badge variant="secondary">{t("systemBadge")}</Badge>
            )}
          </h1>
          <p className="text-muted-foreground">{t("editRoleSubtitle")}</p>
        </div>
        {!role.isSystem && (
          <Button onClick={handleSave} disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t("savePermissions")
            )}
          </Button>
        )}
      </div>

      {role.isSystem && (
        <div className="bg-muted p-3 rounded-md text-sm text-muted-foreground">
          {t("systemRoleReadonly")}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("permissionsLabel")}</CardTitle>
          {role.description && (
            <CardDescription>{role.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(permissions).map(([module, perms]) => (
            <div key={module} className="space-y-2 border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <Label className="font-semibold capitalize">
                  {module.replace(/_/g, " ")}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleModule(module)}
                  disabled={role.isSystem}
                >
                  {perms.every((p) => selected.has(p.id))
                    ? t("deselectAll")
                    : t("selectAll")}
                </Button>
              </div>
              <div className="space-y-2 pl-4">
                {perms.map((perm) => (
                  <div key={perm.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`role-${perm.id}`}
                      checked={selected.has(perm.id)}
                      onCheckedChange={() => togglePermission(perm.id)}
                      disabled={role.isSystem}
                    />
                    <Label
                      htmlFor={`role-${perm.id}`}
                      className="text-sm font-normal cursor-pointer flex-1"
                    >
                      {perm.description || perm.code}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
