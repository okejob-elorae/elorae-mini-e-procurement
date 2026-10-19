import { describe, it, expect } from "vitest";
import { Prisma } from "@elorae/db";
import { isOpenKeyCollision } from "./writer";

/* Meta shapes copied from a real P2002 on the MariaDB driver adapter (2026-10-19). */
function p2002(meta: Record<string, unknown> | undefined) {
  return new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test", meta });
}
function adapterMeta(index: string) {
  return {
    modelName: "StoreStocktake",
    driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", constraint: { index } } },
  };
}

describe("isOpenKeyCollision", () => {
  it("reads the driver adapter's index name for openKey", () => {
    expect(isOpenKeyCollision(p2002(adapterMeta("StoreStocktake_openKey_key")))).toBe(true);
  });

  it("rethrows a collision on another unique index, such as docNo", () => {
    expect(isOpenKeyCollision(p2002(adapterMeta("StoreStocktake_docNo_key")))).toBe(false);
    expect(isOpenKeyCollision(p2002(adapterMeta("StoreStocktakeLine_stocktakeId_itemId_variantSku_key")))).toBe(false);
  });

  it("reads the classic meta.target shape too", () => {
    expect(isOpenKeyCollision(p2002({ target: ["openKey"] }))).toBe(true);
    expect(isOpenKeyCollision(p2002({ target: ["docNo"] }))).toBe(false);
  });

  it("keeps the old ALREADY_OPEN reading when the error names no constraint", () => {
    expect(isOpenKeyCollision(p2002(undefined))).toBe(true);
  });

  it("is false for anything that is not a P2002", () => {
    expect(isOpenKeyCollision(new Error("boom"))).toBe(false);
    expect(
      isOpenKeyCollision(new Prisma.PrismaClientKnownRequestError("x", { code: "P2025", clientVersion: "test" })),
    ).toBe(false);
  });
});
