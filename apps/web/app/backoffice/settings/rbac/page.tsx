"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Edit2, Eye, Plus, Trash2 } from "lucide-react";
import { deleteRole, getPermissions, getRoles } from "@/app/actions/rbac";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { grupTercakup, kunciDeskripsiPeran } from "@/lib/rbac/penjelasan-izin";
import { EditorPeran, type IzinDb, type ModeEditor } from "./EditorPeran";
import { useNamaPeran } from "./pakai-nama-peran";

type Role = Awaited<ReturnType<typeof getRoles>>[number];

export default function RBACSettingsPage() {
  const tUi = useTranslations("ui");
  const t = useTranslations("settings.rbac");
  const tIzin = useTranslations("izinPeran");
  const namaPeran = useNamaPeran();
  const { data: session, update } = useSession();
  const [roles, setRoles] = useState<Role[]>([]);
  const [izin, setIzin] = useState<IzinDb[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ mode: ModeEditor; peran: Role | null; kunci: number } | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [menghapus, setMenghapus] = useState(false);

  const canManage = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.SETTINGS_RBAC_MANAGE);

  // Dinaikkan setelah menyimpan atau menghapus supaya daftar dimuat ulang.
  const [versi, setVersi] = useState(0);
  const loadData = () => setVersi((v) => v + 1);

  useEffect(() => {
    let batal = false;
    Promise.all([getRoles(), getPermissions()])
      .then(([rolesData, permissionsData]) => {
        if (batal) return;
        setRoles(rolesData);
        setIzin(permissionsData);
      })
      .catch(() => toast.error(t("loadFailed")))
      .finally(() => {
        if (!batal) setLoading(false);
      });
    return () => {
      batal = true;
    };
  }, [t, versi]);

  const bukaEditor = (mode: ModeEditor, peran: Role | null) => setEditor({ mode, peran, kunci: Date.now() });

  async function handleConfirmDelete() {
    if (!roleToDelete) return;
    setMenghapus(true);
    try {
      const hasil = await deleteRole(roleToDelete.id);
      if (!hasil.ok) {
        toast.error(tIzin(`galat.${hasil.code}` as never));
        return;
      }
      toast.success(t("deleted"));
      setRoleToDelete(null);
      loadData();
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setMenghapus(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center p-8">{tUi("loading")}</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        actions={
          canManage ? (
            <Button onClick={() => bukaEditor("buat", null)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("createRole")}
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => {
          const kunciDeskripsi = kunciDeskripsiPeran(role.name, role.description);
          const deskripsi = kunciDeskripsi ? tIzin(kunciDeskripsi as never) : role.description;
          const grup = grupTercakup(role.permissions.map((p) => p.code));
          const pekerjaan = role.isSystem
            ? tIzin("semuaPekerjaan")
            : grup.length > 0
              ? grup.map((g) => tIzin(`grup.${g}` as never)).join(", ")
              : tIzin("tanpaIzin");
          const bisaUbah = canManage && !role.isSystem;
          return (
            <Card key={role.id} className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {namaPeran(role.name)}
                  {role.isSystem && (
                    <Badge variant="secondary" className="text-xs">
                      {t("system")}
                    </Badge>
                  )}
                </CardTitle>
                {deskripsi && <CardDescription className="mt-1">{deskripsi}</CardDescription>}
              </CardHeader>
              {/* Card is already a flex column; growing the content and pushing the
                  button row to its end keeps the buttons at the same height across
                  cards whose descriptions differ in length. */}
              <CardContent className="flex flex-1 flex-col">
                <div className="flex flex-1 flex-col gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{tIzin("pekerjaan")}: </span>
                    <span className="text-muted-foreground">{pekerjaan}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t("usersAssigned", { count: role.userCount })}
                    {!role.isSystem ? ` · ${t("permissionsCount", { count: role.permissions.length })}` : null}
                  </div>
                  <div className="mt-auto flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => bukaEditor(bisaUbah ? "ubah" : "lihat", role)}
                      className="flex-1"
                    >
                      {bisaUbah ? <Edit2 className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
                      {bisaUbah ? t("edit") : tIzin("lihat")}
                    </Button>
                    {bisaUbah && role.userCount === 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setRoleToDelete(role)}
                        aria-label={t("deleteAria", { name: namaPeran(role.name) })}
                        title={t("deleteAria", { name: namaPeran(role.name) })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editor ? (
        <EditorPeran
          key={editor.kunci}
          mode={editor.mode}
          peran={editor.peran}
          semuaPeran={roles}
          semuaIzin={izin}
          onTutup={() => setEditor(null)}
          onTersimpan={() => {
            setEditor(null);
            loadData();
            // Bila peran Anda sendiri yang berubah, sesi Anda ikut dibaca ulang sekarang.
            void update();
          }}
        />
      ) : null}

      <AlertDialog open={roleToDelete !== null} onOpenChange={(buka) => !buka && !menghapus && setRoleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitleV2")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteBody", { name: roleToDelete ? namaPeran(roleToDelete.name) : "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={menghapus}>{tUi("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              disabled={menghapus}
              variant="destructive"
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
