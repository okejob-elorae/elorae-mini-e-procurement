import type { AccountType } from "@/lib/constants/enums";

type ValidationResult = { ok: true } | { ok: false; code: string; message: string };

export type AccountForValidation = {
  id: string;
  code: string;
  type: AccountType;
  depth: number;
  isActive: boolean;
  parentId: string | null;
};

export type CreateInput = {
  code: string;
  name: string;
  parentId: string | null;
  type?: AccountType;
};

const MAX_DEPTH = 4;
const MAX_CODE_LENGTH = 8;

function fail(code: string, message: string): ValidationResult {
  return { ok: false, code, message };
}

export function validateCreate(input: CreateInput, parent: AccountForValidation | null): ValidationResult {
  if (!/^[0-9]+$/.test(input.code)) return fail("code_format_invalid", "Code must be digits only.");
  if (input.code.length > MAX_CODE_LENGTH) return fail("code_too_long", `Code exceeds ${MAX_CODE_LENGTH} characters.`);
  if (parent === null) {
    if (input.parentId !== null) return fail("parent_not_found", "Parent not found.");
    if (!input.type) return fail("root_type_required", "Root accounts must declare a type.");
    return { ok: true };
  }
  if (!parent.isActive) return fail("parent_inactive", "Parent account is inactive.");
  if (parent.depth >= MAX_DEPTH) return fail("max_depth_exceeded", `Max depth ${MAX_DEPTH} reached.`);
  if (input.code.length <= parent.code.length) return fail("code_too_short", "Code must extend parent code.");
  if (!input.code.startsWith(parent.code)) return fail("code_prefix_mismatch", "Code must start with parent code.");
  return { ok: true };
}

export function validateReparent(
  account: AccountForValidation,
  newParent: AccountForValidation | null,
  allAccounts: AccountForValidation[],
): ValidationResult {
  // Children check must run regardless of whether newParent is null (root-promotion).
  const hasChildren = allAccounts.some((a) => a.parentId === account.id);
  if (hasChildren) return fail("has_children_reparent_forbidden", "Reparenting an account with children is not supported.");
  if (newParent === null) return { ok: true };
  if (newParent.id === account.id) return fail("cycle_detected", "Cannot reparent under self.");
  // Cycle: walk newParent ancestors; if account.id appears, fail.
  const byId = new Map(allAccounts.map((a) => [a.id, a]));
  let cursor: AccountForValidation | undefined = newParent;
  while (cursor) {
    if (cursor.id === account.id) return fail("cycle_detected", "Cycle detected.");
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  if (newParent.type !== account.type) return fail("reparent_type_mismatch", "New parent must share the same type.");
  if (!newParent.isActive) return fail("parent_inactive", "New parent is inactive.");
  if (newParent.depth >= MAX_DEPTH) return fail("max_depth_exceeded", "New parent at max depth.");
  return { ok: true };
}

export function validateDeactivate(account: AccountForValidation, activeChildrenCount: number): ValidationResult {
  if (activeChildrenCount > 0) return fail("has_active_children", "Cannot deactivate an account with active children.");
  return { ok: true };
}
