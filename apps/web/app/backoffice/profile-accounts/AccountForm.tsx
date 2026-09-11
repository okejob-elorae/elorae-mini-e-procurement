"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  createAccount,
  updateAccount,
  type RoleOption,
} from "@/app/actions/profile-accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = {
  mode: "create" | "edit";
  userId?: string;
  roles: RoleOption[];
  initial: {
    name: string;
    email: string;
    roleId: string;
  };
};

export function AccountForm({ mode, userId, roles, initial }: Props) {
  const t = useTranslations("profileAccounts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(initial.roleId);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      if (mode === "create") {
        const result = await createAccount({
          name,
          email,
          password,
          roleId,
        });
        if (!result.ok) {
          setError(t(`errors.${result.code}` as "errors.forbidden"));
          toast.error(t("accountCreateFailed"));
          return;
        }
        toast.success(t("accountCreated"));
        router.push("/backoffice/profile-accounts");
        router.refresh();
        return;
      }

      if (!userId) return;
      const result = await updateAccount({
        userId,
        name,
        roleId,
      });
      if (!result.ok) {
        setError(t(`errors.${result.code}` as "errors.forbidden"));
        toast.error(t("accountUpdateFailed"));
        return;
      }
      toast.success(t("accountUpdated"));
      router.push("/backoffice/profile-accounts");
      router.refresh();
    });
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>
          {mode === "create" ? t("createAccountTitle") : t("editAccountTitle")}
        </CardTitle>
        <CardDescription>
          {mode === "create"
            ? t("createAccountSubtitle")
            : t("editAccountSubtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-name">{t("formName")}</Label>
            <Input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account-email">{t("formEmail")}</Label>
            <Input
              id="account-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={mode === "edit"}
              autoComplete="off"
            />
          </div>

          {mode === "create" && (
            <div className="space-y-2">
              <Label htmlFor="account-password">{t("formPassword")}</Label>
              <Input
                id="account-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>{t("formRole")}</Label>
            <Select
              value={roleId || undefined}
              onValueChange={setRoleId}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("formRolePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={pending || !roleId}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("save")
              )}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/backoffice/profile-accounts">{t("cancel")}</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
