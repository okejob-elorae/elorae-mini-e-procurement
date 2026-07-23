"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronRight, ChevronDown, Plus, MoreHorizontal, ListTree, ScrollText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createAccountAction,
  updateAccountAction,
  deactivateAccountAction,
  reactivateAccountAction,
} from "./actions";
import type { CoaTreeNode } from "@/lib/finance/coa/queries";
import { ACCOUNT_TYPE_VALUES } from "@/lib/constants/enums";
import type { AccountType } from "@/lib/constants/enums";

type Props = {
  tree: CoaTreeNode[];
  includeInactive: boolean;
  canManage: boolean;
  canViewLedger: boolean;
};

type CreateDialogState = {
  open: boolean;
  parentId: string | null;
  parentNode: CoaTreeNode | null;
};

type EditDialogState = {
  open: boolean;
  account: CoaTreeNode | null;
};

type ConfirmDialogState = {
  open: boolean;
  accountId: string | null;
  accountName: string | null;
};

/** Flatten the tree into a list (depth-first, pre-order). */
function flattenTree(nodes: CoaTreeNode[]): CoaTreeNode[] {
  const result: CoaTreeNode[] = [];
  function walk(list: CoaTreeNode[]) {
    for (const n of list) {
      result.push(n);
      if (n.children.length > 0) walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

/**
 * Filter tree: a node is visible if it or any descendant matches the search.
 * Returns a new tree containing only matching nodes + their ancestors.
 */
function filterTree(nodes: CoaTreeNode[], search: string): CoaTreeNode[] {
  if (!search.trim()) return nodes;
  const q = search.toLowerCase();

  function matches(node: CoaTreeNode): boolean {
    return (
      node.code.toLowerCase().includes(q) ||
      node.name.toLowerCase().includes(q)
    );
  }

  function filterNode(node: CoaTreeNode): CoaTreeNode | null {
    const filteredChildren = node.children
      .map(filterNode)
      .filter((c): c is CoaTreeNode => c !== null);
    if (matches(node) || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    return null;
  }

  return nodes.map(filterNode).filter((n): n is CoaTreeNode => n !== null);
}

/** Status badge for active/inactive. */
function StatusBadge({ isActive }: { isActive: boolean }) {
  const t = useTranslations("finance.coa");
  return isActive ? (
    <Badge className="border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400">
      {t("status.active")}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      {t("status.inactive")}
    </Badge>
  );
}

export function CoaPageClient({ tree, includeInactive, canManage, canViewLedger }: Props) {
  const t = useTranslations("finance.coa");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Expand/collapse: default all roots expanded.
  const [openSet, setOpenSet] = useState<Set<string>>(
    () => new Set(tree.map((r) => r.id)),
  );
  const [search, setSearch] = useState("");

  // Create dialog state.
  const [createDialog, setCreateDialog] = useState<CreateDialogState>({
    open: false,
    parentId: null,
    parentNode: null,
  });
  const [createCode, setCreateCode] = useState("");
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<AccountType | "">("");

  // Edit dialog state.
  const [editDialog, setEditDialog] = useState<EditDialogState>({
    open: false,
    account: null,
  });
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState<string | "">("");

  // Deactivate confirm dialog.
  const [deactivateDialog, setDeactivateDialog] = useState<ConfirmDialogState>({
    open: false,
    accountId: null,
    accountName: null,
  });

  // Reactivate confirm dialog.
  const [reactivateDialog, setReactivateDialog] = useState<ConfirmDialogState>({
    open: false,
    accountId: null,
    accountName: null,
  });

  function toggle(id: string) {
    const next = new Set(openSet);
    next.has(id) ? next.delete(id) : next.add(id);
    setOpenSet(next);
  }

  const filtered = useMemo(() => filterTree(tree, search), [tree, search]);
  const allFlat = useMemo(() => flattenTree(tree), [tree]);

  // Candidates for parent dropdown in create/edit dialogs: active, depth < 4.
  const parentCandidates = useMemo(
    () => allFlat.filter((n) => n.isActive && n.depth < 4),
    [allFlat],
  );

  // Candidates filtered by same type when creating under a known type.
  function parentCandidatesForType(type: AccountType | ""): CoaTreeNode[] {
    if (!type) return parentCandidates;
    return parentCandidates.filter((n) => n.type === type);
  }

  // ---------- Handlers ----------

  function openCreate(parentNode: CoaTreeNode | null) {
    const parentId = parentNode ? parentNode.id : null;
    const prefix = parentNode ? parentNode.code : "";
    setCreateCode(prefix);
    setCreateName("");
    setCreateType(parentNode ? parentNode.type : "");
    setCreateDialog({ open: true, parentId, parentNode });
  }

  function handleCreate() {
    if (!createCode.trim() || !createName.trim()) return;
    if (!createDialog.parentId && !createType) return;
    startTransition(async () => {
      const result = await createAccountAction({
        code: createCode.trim(),
        name: createName.trim(),
        parentId: createDialog.parentId,
        type: createType ? (createType as AccountType) : undefined,
      });
      if (result.ok) {
        toast.success(t("dialog.createTitle") + " ✓");
        setCreateDialog({ open: false, parentId: null, parentNode: null });
        router.refresh();
      } else {
        toast.error(t(`error.${result.code}` as never));
      }
    });
  }

  function openEdit(account: CoaTreeNode) {
    setEditCode(account.code);
    setEditName(account.name);
    // For parent select: use the flattened tree to find parent.
    const parent = allFlat.find((n) =>
      n.children.some((c) => c.id === account.id),
    );
    setEditParentId(parent ? parent.id : "");
    setEditDialog({ open: true, account });
  }

  function handleEdit() {
    if (!editDialog.account) return;
    if (!editName.trim()) return;
    const account = editDialog.account;
    startTransition(async () => {
      const input: { name?: string; code?: string; parentId?: string | null } = {};
      if (editName.trim() !== account.name) input.name = editName.trim();
      if (account.isLeaf && editCode.trim() !== account.code) {
        input.code = editCode.trim();
      }
      if (account.isLeaf) {
        const newParentId = editParentId === "" ? null : editParentId;
        const currentParent = allFlat.find((n) =>
          n.children.some((c) => c.id === account.id),
        );
        const currentParentId = currentParent ? currentParent.id : null;
        if (newParentId !== currentParentId) {
          input.parentId = newParentId;
        }
      }
      // Only call if something changed.
      if (Object.keys(input).length === 0) {
        setEditDialog({ open: false, account: null });
        return;
      }
      const result = await updateAccountAction(account.id, input);
      if (result.ok) {
        toast.success(t("dialog.editTitle") + " ✓");
        setEditDialog({ open: false, account: null });
        router.refresh();
      } else {
        toast.error(t(`error.${result.code}` as never));
      }
    });
  }

  function handleDeactivate() {
    if (!deactivateDialog.accountId) return;
    const id = deactivateDialog.accountId;
    startTransition(async () => {
      const result = await deactivateAccountAction(id);
      setDeactivateDialog({ open: false, accountId: null, accountName: null });
      if (result.ok) {
        toast.success(t("dialog.deactivateTitle") + " ✓");
        router.refresh();
      } else {
        toast.error(t(`error.${result.code}` as never));
      }
    });
  }

  function handleReactivate() {
    if (!reactivateDialog.accountId) return;
    const id = reactivateDialog.accountId;
    startTransition(async () => {
      const result = await reactivateAccountAction(id);
      setReactivateDialog({ open: false, accountId: null, accountName: null });
      if (result.ok) {
        toast.success(t("dialog.reactivateTitle") + " ✓");
        router.refresh();
      } else {
        toast.error(t(`error.${result.code}` as never));
      }
    });
  }

  // ---------- Row rendering ----------

  function renderRows(nodes: CoaTreeNode[]): React.ReactNode[] {
    const rows: React.ReactNode[] = [];

    function walk(list: CoaTreeNode[]) {
      for (const node of list) {
        const isOpen = openSet.has(node.id);
        rows.push(
          <TableRow key={node.id} className={!node.isActive ? "opacity-50" : undefined}>
            <TableCell className="font-mono text-sm">
              {node.code}
            </TableCell>
            <TableCell>
              <div
                className="flex items-center gap-1"
                style={{ paddingLeft: `${(node.depth - 1) * 1.5}rem` }}
              >
                {!node.isLeaf ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => toggle(node.id)}
                    aria-label={isOpen ? t("collapse") : t("expand")}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                ) : (
                  <span className="shrink-0 w-6" />
                )}
                <span>{node.name}</span>
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {t(`type.${node.type}` as never)}
            </TableCell>
            <TableCell>
              <StatusBadge isActive={node.isActive} />
            </TableCell>
            <TableCell className="text-right">
              {(canManage || (canViewLedger && node.isLeaf)) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canViewLedger && node.isLeaf && (
                      <DropdownMenuItem asChild>
                        <Link href={`/backoffice/finance/journals/ledger/${node.id}`}>
                          <ScrollText className="h-4 w-4" />
                          {t("viewLedger")}
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {canViewLedger && node.isLeaf && canManage && <DropdownMenuSeparator />}
                    {canManage && (
                      <DropdownMenuItem onClick={() => openEdit(node)}>
                        {t("dialog.editTitle")}
                      </DropdownMenuItem>
                    )}
                    {canManage && node.depth < 4 && (
                      <DropdownMenuItem onClick={() => openCreate(node)}>
                        {t("newAccount")}
                      </DropdownMenuItem>
                    )}
                    {canManage && <DropdownMenuSeparator />}
                    {canManage && (node.isActive ? (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() =>
                          setDeactivateDialog({
                            open: true,
                            accountId: node.id,
                            accountName: node.name,
                          })
                        }
                      >
                        {t("dialog.deactivate")}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() =>
                          setReactivateDialog({
                            open: true,
                            accountId: node.id,
                            accountName: node.name,
                          })
                        }
                      >
                        {t("dialog.reactivate")}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </TableCell>
          </TableRow>,
        );
        if (!node.isLeaf && isOpen && node.children.length > 0) {
          walk(node.children);
        }
      }
    }

    walk(nodes);
    return rows;
  }

  const rows = renderRows(filtered);

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        {canManage && (
          <Button onClick={() => openCreate(null)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("newAccount")}
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        <Button
          variant={includeInactive ? "default" : "outline"}
          size="sm"
          onClick={() =>
            router.push(
              `/backoffice/finance/coa${includeInactive ? "" : "?inactive=1"}`,
            )
          }
        >
          {includeInactive ? t("hideInactive") : t("showInactive")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTree className="h-5 w-5" />
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">{t("col.code")}</TableHead>
              <TableHead>{t("col.name")}</TableHead>
              <TableHead className="w-36">{t("col.type")}</TableHead>
              <TableHead className="w-28">{t("col.status")}</TableHead>
              <TableHead className="w-12 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-8 text-muted-foreground"
                >
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows
            )}
          </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ---- Create Dialog ---- */}
      <Dialog
        open={createDialog.open}
        onOpenChange={(v) => setCreateDialog((s) => ({ ...s, open: v }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {!createDialog.parentId && (
              <div className="space-y-1">
                <Label>{t("col.type")}</Label>
                <Select
                  value={createType}
                  onValueChange={(v) => setCreateType(v as AccountType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("col.type")} />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPE_VALUES.map((at) => (
                      <SelectItem key={at} value={at}>
                        {t(`type.${at}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {createDialog.parentNode && (
              <div className="space-y-1">
                <Label>{t("dialog.parent")}</Label>
                <div className="text-sm font-mono bg-muted px-3 py-2 rounded">
                  {createDialog.parentNode.code} — {createDialog.parentNode.name}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label>{t("dialog.code")}</Label>
              <Input
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
                placeholder={t("dialog.code")}
              />
              <p className="text-xs text-muted-foreground">
                {createDialog.parentNode
                  ? t("dialog.codeHintChild", {
                      prefix: createDialog.parentNode.code,
                      min: createDialog.parentNode.code.length + 1,
                    })
                  : t("dialog.codeHintRoot")}
              </p>
            </div>
            <div className="space-y-1">
              <Label>{t("dialog.name")}</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t("dialog.name")}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("dialog.cancel")}</Button>
            </DialogClose>
            <Button
              onClick={handleCreate}
              disabled={
                isPending ||
                !createCode.trim() ||
                !createName.trim() ||
                (!createDialog.parentId && !createType)
              }
            >
              {t("dialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Edit Dialog ---- */}
      <Dialog
        open={editDialog.open}
        onOpenChange={(v) => setEditDialog((s) => ({ ...s, open: v }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {editDialog.account?.isLeaf && (
              <div className="space-y-1">
                <Label>{t("dialog.code")}</Label>
                <Input
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  placeholder={t("dialog.code")}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label>{t("dialog.name")}</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("dialog.name")}
              />
            </div>
            {editDialog.account?.isLeaf && (
              <div className="space-y-1">
                <Label>{t("dialog.parent")}</Label>
                <Select
                  value={editParentId || "__none__"}
                  onValueChange={(v) =>
                    setEditParentId(v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("dialog.parentNone")} />
                  </SelectTrigger>
                  {editDialog.account != null && (
                    <SelectContent>
                      <SelectItem value="__none__">{t("dialog.parentNone")}</SelectItem>
                      {parentCandidatesForType(editDialog.account.type)
                        .filter((n) => n.id !== editDialog.account!.id)
                        .map((n) => (
                          <SelectItem key={n.id} value={n.id}>
                            {n.code} — {n.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  )}
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("dialog.cancel")}</Button>
            </DialogClose>
            <Button
              onClick={handleEdit}
              disabled={isPending || !editName.trim()}
            >
              {t("dialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Deactivate Confirm Dialog ---- */}
      <AlertDialog
        open={deactivateDialog.open}
        onOpenChange={(v) =>
          setDeactivateDialog((s) => ({ ...s, open: v }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialog.deactivateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialog.deactivateDescription", {
                name: deactivateDialog.accountName ?? "",
              } as never)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("dialog.deactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Reactivate Confirm Dialog ---- */}
      <AlertDialog
        open={reactivateDialog.open}
        onOpenChange={(v) =>
          setReactivateDialog((s) => ({ ...s, open: v }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialog.reactivateTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleReactivate} disabled={isPending}>
              {t("dialog.reactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
