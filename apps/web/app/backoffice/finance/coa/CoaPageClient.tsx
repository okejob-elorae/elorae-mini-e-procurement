"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Folder,
  Circle,
  Pencil,
  Trash2,
  RotateCcw,
  ListTree,
  ScrollText,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  absoluteBalance,
  balanceSide,
  type CoaTreeNodeWithBalance,
} from "@/lib/finance/coa/roll-up-balances";
import { ACCOUNT_TYPE_VALUES } from "@/lib/constants/enums";
import type { AccountType } from "@/lib/constants/enums";
import { cn } from "@/lib/utils";

type Props = {
  tree: CoaTreeNodeWithBalance[];
  includeInactive: boolean;
  canManage: boolean;
  canViewLedger: boolean;
  showBalances: boolean;
};

type CreateDialogState = {
  open: boolean;
  parentId: string | null;
  parentNode: CoaTreeNodeWithBalance | null;
};

type EditDialogState = {
  open: boolean;
  account: CoaTreeNodeWithBalance | null;
};

type ConfirmDialogState = {
  open: boolean;
  accountId: string | null;
  accountName: string | null;
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Collect every node id (for Expand All). */
function collectIds(nodes: CoaTreeNode[]): string[] {
  const ids: string[] = [];
  function walk(list: CoaTreeNode[]) {
    for (const n of list) {
      ids.push(n.id);
      if (n.children.length > 0) walk(n.children);
    }
  }
  walk(nodes);
  return ids;
}

/** Flatten the tree into a list (depth-first, pre-order). */
function flattenTree(nodes: CoaTreeNodeWithBalance[]): CoaTreeNodeWithBalance[] {
  const result: CoaTreeNodeWithBalance[] = [];
  function walk(list: CoaTreeNodeWithBalance[]) {
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
function filterTree(
  nodes: CoaTreeNodeWithBalance[],
  search: string,
): CoaTreeNodeWithBalance[] {
  if (!search.trim()) return nodes;
  const q = search.toLowerCase();

  function matches(node: CoaTreeNodeWithBalance): boolean {
    return (
      node.code.toLowerCase().includes(q) ||
      node.name.toLowerCase().includes(q)
    );
  }

  function filterNode(node: CoaTreeNodeWithBalance): CoaTreeNodeWithBalance | null {
    const filteredChildren = node.children
      .map(filterNode)
      .filter((c): c is CoaTreeNodeWithBalance => c !== null);
    if (matches(node) || filteredChildren.length > 0) {
      // Re-sum from visible children. Matching group with no visible children → 0
      // (not the full rolled-up total). Matching leaf keeps its own balance.
      const balance =
        filteredChildren.length > 0
          ? filteredChildren.reduce((sum, c) => sum + c.balance, 0)
          : node.isLeaf
            ? node.balance
            : 0;
      return { ...node, children: filteredChildren, balance };
    }
    return null;
  }

  return nodes.map(filterNode).filter((n): n is CoaTreeNodeWithBalance => n !== null);
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  const t = useTranslations("finance.coa");
  return isActive ? null : (
    <Badge variant="outline" className="text-muted-foreground text-xs font-normal">
      {t("status.inactive")}
    </Badge>
  );
}

export function CoaPageClient({
  tree,
  includeInactive,
  canManage,
  canViewLedger,
  showBalances,
}: Props) {
  const t = useTranslations("finance.coa");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Default: all nodes expanded (ERPNext-style open tree).
  const [openSet, setOpenSet] = useState<Set<string>>(
    () => new Set(collectIds(tree)),
  );
  const [search, setSearch] = useState("");

  const [createDialog, setCreateDialog] = useState<CreateDialogState>({
    open: false,
    parentId: null,
    parentNode: null,
  });
  const [createCode, setCreateCode] = useState("");
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<AccountType | "">("");

  const [editDialog, setEditDialog] = useState<EditDialogState>({
    open: false,
    account: null,
  });
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState<string | "">("");

  const [deactivateDialog, setDeactivateDialog] = useState<ConfirmDialogState>({
    open: false,
    accountId: null,
    accountName: null,
  });

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

  function expandAll() {
    setOpenSet(new Set(collectIds(tree)));
  }

  function collapseAll() {
    setOpenSet(new Set());
  }

  const filtered = useMemo(() => filterTree(tree, search), [tree, search]);
  const allFlat = useMemo(() => flattenTree(tree), [tree]);
  const searching = Boolean(search.trim());

  // Auto-expand the filtered tree while searching so Collapse All / chevrons stay consistent.
  useEffect(() => {
    if (!searching) return;
    setOpenSet(new Set(collectIds(filtered)));
  }, [searching, filtered]);

  const parentCandidates = useMemo(
    () => allFlat.filter((n) => n.isActive && n.depth < 4),
    [allFlat],
  );

  function parentCandidatesForType(type: AccountType | ""): CoaTreeNodeWithBalance[] {
    if (!type) return parentCandidates;
    return parentCandidates.filter((n) => n.type === type);
  }

  function openCreate(parentNode: CoaTreeNodeWithBalance | null) {
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

  function openEdit(account: CoaTreeNodeWithBalance) {
    setEditCode(account.code);
    setEditName(account.name);
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

  function formatBalance(node: CoaTreeNodeWithBalance): string {
    if (!showBalances) return "—";
    const abs = absoluteBalance(node.balance);
    const side = balanceSide(node.type, node.balance);
    const sideLabel = side === "Dr" ? t("balance.dr") : t("balance.cr");
    return `${formatRupiah(abs)} ${sideLabel}`;
  }

  function renderRows(nodes: CoaTreeNodeWithBalance[]): React.ReactNode[] {
    const rows: React.ReactNode[] = [];

    function walk(list: CoaTreeNodeWithBalance[]) {
      for (const node of list) {
        const isOpen = openSet.has(node.id);
        const showActions = canManage || (canViewLedger && node.isLeaf);
        const indent = Math.max(0, node.depth - 1);

        rows.push(
          <div
            key={node.id}
            className={cn(
              "group flex items-center gap-2 border-b border-border/60 px-2 py-2 last:border-b-0",
              "hover:bg-muted/50",
              !node.isActive && "opacity-60",
            )}
          >
            <div
              className="flex min-w-0 flex-1 items-center gap-1.5"
              style={{ paddingLeft: `${indent * 1.25}rem` }}
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
                <span className="inline-block h-6 w-6 shrink-0" />
              )}

              {!node.isLeaf ? (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Circle className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}

              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {node.code}
              </span>
              <span className="truncate text-sm font-medium">{node.name}</span>
              <StatusBadge isActive={node.isActive} />

              {showActions && (
                <div
                  className={cn(
                    "ml-2 flex shrink-0 flex-wrap items-center gap-1",
                    "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100",
                    "transition-opacity",
                  )}
                >
                  {canManage && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => openEdit(node)}
                    >
                      <Pencil className="mr-1 h-3 w-3" />
                      {t("dialog.editTitle")}
                    </Button>
                  )}
                  {canManage && node.depth < 4 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => openCreate(node)}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      {t("addChild")}
                    </Button>
                  )}
                  {canViewLedger && node.isLeaf && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      asChild
                    >
                      <Link href={`/backoffice/finance/journals/ledger/${node.id}`}>
                        <ScrollText className="mr-1 h-3 w-3" />
                        {t("viewLedger")}
                      </Link>
                    </Button>
                  )}
                  {canManage &&
                    (node.isActive ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() =>
                          setDeactivateDialog({
                            open: true,
                            accountId: node.id,
                            accountName: node.name,
                          })
                        }
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        {t("dialog.deactivate")}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setReactivateDialog({
                            open: true,
                            accountId: node.id,
                            accountName: node.name,
                          })
                        }
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        {t("dialog.reactivate")}
                      </Button>
                    ))}
                </div>
              )}
            </div>

            <div className="shrink-0 tabular-nums text-sm text-muted-foreground">
              {formatBalance(node)}
            </div>
          </div>,
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={collapseAll}
            disabled={searching}
          >
            {t("collapseAll")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={expandAll}
            disabled={searching}
          >
            {t("expandAll")}
          </Button>
          {canManage && (
            <Button onClick={() => openCreate(null)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("newAccount")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
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
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-muted-foreground">
              <ListTree className="h-8 w-8 opacity-40" />
              <p>{t("empty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">{rows}</div>
          )}
        </CardContent>
      </Card>

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
                <div className="rounded bg-muted px-3 py-2 font-mono text-sm">
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
