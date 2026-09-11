"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Edit2,
  KeyRound,
  MoreHorizontal,
  Plus,
  ShieldOff,
  Trash2,
} from "lucide-react";
import {
  createRole,
  deleteRole,
} from "@/app/actions/rbac";
import {
  adminResetPassword,
  type AccountListItem,
} from "@/app/actions/profile-accounts";
import { adminForcePinReset } from "@/app/actions/security/pin-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
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
  initialTab: "accounts" | "roles";
  accounts: AccountListItem[];
  roles: RoleRow[];
  permissions: Record<string, Permission[]>;
};

export function ProfileAccountsPageClient({
  initialTab,
  accounts,
  roles,
  permissions,
}: Props) {
  const t = useTranslations("profileAccounts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState(initialTab);

  const [isCreateRoleOpen, setIsCreateRoleOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: "", description: "" });
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    new Set(),
  );

  const [roleToDelete, setRoleToDelete] = useState<RoleRow | null>(null);

  const [passwordTarget, setPasswordTarget] = useState<AccountListItem | null>(
    null,
  );
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [pinTarget, setPinTarget] = useState<AccountListItem | null>(null);

  function onTabChange(value: string) {
    const next = value === "roles" ? "roles" : "accounts";
    setTab(next);
    router.replace(
      next === "roles"
        ? "/backoffice/profile-accounts?tab=roles"
        : "/backoffice/profile-accounts",
    );
  }

  function togglePermission(permissionId: string) {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  }

  function toggleModule(module: string) {
    const modulePerms = permissions[module] || [];
    const ids = modulePerms.map((p) => p.id);
    const allSelected = ids.every((id) => selectedPermissions.has(id));
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function openCreateRole() {
    setRoleForm({ name: "", description: "" });
    setSelectedPermissions(new Set());
    setIsCreateRoleOpen(true);
  }

  async function handleCreateRole() {
    try {
      await createRole(roleForm, Array.from(selectedPermissions));
      toast.success(t("roleCreated"));
      setIsCreateRoleOpen(false);
      router.refresh();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : t("roleCreateFailed"),
      );
    }
  }

  async function handleConfirmDelete() {
    if (!roleToDelete) return;
    try {
      await deleteRole(roleToDelete.id);
      toast.success(t("roleDeleted"));
      setRoleToDelete(null);
      router.refresh();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : t("roleDeleteFailed"),
      );
    }
  }

  function handleResetPassword() {
    if (!passwordTarget) return;
    if (newPassword.length < 6) {
      toast.error(t("passwordMinLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("passwordMismatch"));
      return;
    }
    startTransition(async () => {
      const result = await adminResetPassword(passwordTarget.id, newPassword);
      if (!result.ok) {
        toast.error(t(`errors.${result.code}` as "errors.forbidden"));
        return;
      }
      toast.success(t("passwordResetSuccess"));
      setPasswordTarget(null);
      setNewPassword("");
      setConfirmPassword("");
    });
  }

  function handleResetPin() {
    if (!pinTarget) return;
    startTransition(async () => {
      const result = await adminForcePinReset(pinTarget.id);
      if (!result.success) {
        toast.error(t("pinResetFailed"));
        return;
      }
      toast.success(t("pinResetSuccess"));
      setPinTarget(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="accounts">{t("tabAccounts")}</TabsTrigger>
          <TabsTrigger value="roles">{t("tabRoles")}</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-4">
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/backoffice/profile-accounts/new">
                <Plus className="mr-2 h-4 w-4" />
                {t("createAccount")}
              </Link>
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("tabAccounts")}</CardTitle>
            </CardHeader>
            <CardContent>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {t("noAccounts")}
                </p>
              ) : (
                <div className="border rounded-md overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colName")}</TableHead>
                        <TableHead>{t("colEmail")}</TableHead>
                        <TableHead>{t("colRole")}</TableHead>
                        <TableHead className="text-right">
                          {t("colActions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((account) => (
                        <TableRow key={account.id}>
                          <TableCell className="font-medium">
                            {account.name || "—"}
                          </TableCell>
                          <TableCell>{account.email}</TableCell>
                          <TableCell>{account.roleName || "—"}</TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label={t("colActions")}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link
                                    href={`/backoffice/profile-accounts/${account.id}/edit`}
                                  >
                                    <Edit2 className="mr-2 h-4 w-4" />
                                    {t("edit")}
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setPasswordTarget(account);
                                    setNewPassword("");
                                    setConfirmPassword("");
                                  }}
                                >
                                  <KeyRound className="mr-2 h-4 w-4" />
                                  {t("resetPassword")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setPinTarget(account)}
                                >
                                  <ShieldOff className="mr-2 h-4 w-4" />
                                  {t("resetPin")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreateRole}>
              <Plus className="mr-2 h-4 w-4" />
              {t("createRole")}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("tabRoles")}</CardTitle>
            </CardHeader>
            <CardContent>
              {roles.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {t("noRoles")}
                </p>
              ) : (
                <div className="border rounded-md overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colRoleName")}</TableHead>
                        <TableHead>{t("colSystem")}</TableHead>
                        <TableHead>{t("colUsers")}</TableHead>
                        <TableHead>{t("colPermissions")}</TableHead>
                        <TableHead className="text-right">
                          {t("colActions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roles.map((role) => (
                        <TableRow key={role.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{role.name}</div>
                              {role.description && (
                                <div className="text-sm text-muted-foreground">
                                  {role.description}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {role.isSystem ? (
                              <Badge variant="secondary">
                                {t("systemBadge")}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>{role.userCount}</TableCell>
                          <TableCell>{role.permissions.length}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button variant="outline" size="sm" asChild>
                                <Link
                                  href={`/backoffice/profile-accounts/roles/${role.id}`}
                                >
                                  <Edit2 className="mr-1 h-3 w-3" />
                                  {t("edit")}
                                </Link>
                              </Button>
                              {!role.isSystem && role.userCount === 0 && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => setRoleToDelete(role)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  <span className="sr-only">
                                    {t("deleteRole")}
                                  </span>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isCreateRoleOpen} onOpenChange={setIsCreateRoleOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("createRole")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">{t("roleNameLabel")}</Label>
              <Input
                id="role-name"
                value={roleForm.name}
                onChange={(e) =>
                  setRoleForm({ ...roleForm, name: e.target.value })
                }
                placeholder={t("roleNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">{t("roleDescriptionLabel")}</Label>
              <Textarea
                id="role-desc"
                value={roleForm.description}
                onChange={(e) =>
                  setRoleForm({ ...roleForm, description: e.target.value })
                }
                rows={2}
              />
            </div>
            <div className="space-y-4">
              <Label>{t("permissionsLabel")}</Label>
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
                    >
                      {perms.every((p) => selectedPermissions.has(p.id))
                        ? t("deselectAll")
                        : t("selectAll")}
                    </Button>
                  </div>
                  <div className="space-y-2 pl-4">
                    {perms.map((perm) => (
                      <div key={perm.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`create-${perm.id}`}
                          checked={selectedPermissions.has(perm.id)}
                          onCheckedChange={() => togglePermission(perm.id)}
                        />
                        <Label
                          htmlFor={`create-${perm.id}`}
                          className="text-sm font-normal cursor-pointer flex-1"
                        >
                          {perm.description || perm.code}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateRoleOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleCreateRole} disabled={!roleForm.name.trim()}>
              {t("createRole")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!roleToDelete}
        onOpenChange={(open) => !open && setRoleToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteRoleTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteRoleDescription", { name: roleToDelete?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground"
            >
              {t("deleteRole")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!passwordTarget}
        onOpenChange={(open) => !open && setPasswordTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resetPasswordTitle")}</DialogTitle>
            <DialogDescription>
              {t("resetPasswordDescription", {
                email: passwordTarget?.email ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-pw">{t("newPasswordLabel")}</Label>
              <Input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">{t("confirmPasswordLabel")}</Label>
              <Input
                id="confirm-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordTarget(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleResetPassword} disabled={pending}>
              {t("resetPassword")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pinTarget}
        onOpenChange={(open) => !open && setPinTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("resetPinTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("resetPinDescription", { email: pinTarget?.email ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetPin} disabled={pending}>
              {t("resetPinConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
