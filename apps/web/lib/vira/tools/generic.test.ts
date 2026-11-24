/**
 * Generic read layer unit tests.
 * Run by vitest (lib/vira).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FIELD_DENY_RE,
  VIRA_ENTITIES,
  filterAllowedFields,
  isDeniedField,
} from "../entities";
import { ViraInputError } from "../errors";
import { tools as genericTools } from "./generic";
import { getEntity } from "../entities";
import { aggregateEntity, parseWhere, queryEntity, toPrismaSelect, toWibIso } from "../generic-query";

describe("VIRA field denylist", () => {
  it("denies password/hash/token/secret/key and PII names", () => {
    for (const name of [
      "passwordHash",
      "pinHash",
      "fcmToken",
      "apiSecret",
      "idempotencyKey",
      "openKey",
      "buyerNpwp",
      "customerPhone",
      "customerEmail",
      "shippingAddress",
      "gajiPokok",
      "bankAccountEnc",
      "proofPhotoUrl",
      "signatureR2Key",
      "lat",
      "lng",
    ]) {
      expect(isDeniedField(name), name).toBe(true);
    }
  });

  it("allows ordinary business fields", () => {
    for (const name of ["orderNo", "docNumber", "total", "status", "sku", "variantSku", "storeId"]) {
      expect(isDeniedField(name), name).toBe(false);
    }
  });

  it("every entity field list is scrubbed of denied names", () => {
    for (const entity of VIRA_ENTITIES) {
      const denied = entity.fields.filter((f) => isDeniedField(f.name));
      expect(denied, entity.name).toEqual([]);
      expect(filterAllowedFields(entity.fields).length).toBe(entity.fields.length);
    }
  });

  it("FIELD_DENY_RE is applied to relation-like names", () => {
    expect(FIELD_DENY_RE.test("proofPhoto")).toBe(true);
  });
});

describe("parseWhere", () => {
  const entity = VIRA_ENTITIES.find((e) => e.name === "purchase_order")!;

  it("accepts equals / in / comparison / AND", () => {
    const w = parseWhere(entity, {
      AND: [{ status: "PARTIAL" }, { grandTotal: { gte: 1000 } }],
      docNumber: { startsWith: "EVAL-" },
    });
    expect(w).toMatchObject({
      AND: [{ status: "PARTIAL" }, { grandTotal: { gte: 1000 } }],
      docNumber: { startsWith: "EVAL-" },
    });
  });

  it("YYYY-MM-DD date filters use WIB start/end (lte is inclusive end-of-day)", () => {
    const w = parseWhere(entity, {
      etaDate: { gte: "2026-11-01", lte: "2026-11-24" },
    }) as { etaDate: { gte: Date; lte: Date } };
    expect(w.etaDate.gte.toISOString()).toBe("2026-10-31T17:00:00.000Z"); // 00:00 WIB
    expect(w.etaDate.lte.toISOString()).toBe("2026-11-24T16:59:59.999Z"); // 23:59:59.999 WIB
  });

  it("date-only equals/in expand to a whole WIB day range", () => {
    const eq = parseWhere(entity, { createdAt: "2026-11-24" }) as {
      createdAt: { gte: Date; lte: Date };
    };
    expect(eq.createdAt).toEqual({
      gte: new Date("2026-11-23T17:00:00.000Z"),
      lte: new Date("2026-11-24T16:59:59.999Z"),
    });
    const inn = parseWhere(entity, { createdAt: { in: ["2026-11-01", "2026-11-02"] } }) as {
      createdAt: { OR: { gte: Date; lte: Date }[] };
    };
    expect(inn.createdAt.OR).toHaveLength(2);
    expect(inn.createdAt.OR[0].gte.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("rejects unknown fields with a list of valid ones", () => {
    expect(() => parseWhere(entity, { passwordHash: "x" })).toThrow(ViraInputError);
    expect(() => parseWhere(entity, { notAField: 1 })).toThrow(/Unknown field "notAField"/);
    try {
      parseWhere(entity, { notAField: 1 });
    } catch (e) {
      expect(String(e)).toMatch(/docNumber/);
    }
  });

  it("rejects nesting deeper than 3", () => {
    const deep = { AND: [{ AND: [{ AND: [{ AND: [{ status: "DRAFT" }] }] }] }] };
    expect(() => parseWhere(entity, deep)).toThrow(/max depth/);
  });
});

describe("toWibIso", () => {
  it("formats with +07:00", () => {
    const s = toWibIso(new Date("2026-11-20T00:00:00.000+07:00"));
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000\+07:00$/);
  });
});

/** Refused before any DB call. */
describe("entity access on included relations", () => {
  const baca = (permissions: string[], entity: string, include?: unknown) =>
    queryEntity({
      actor: { id: "u", name: "U", permissions },
      baseUrl: "http://x",
      entity,
      include,
      limit: 1,
      offset: 0,
    });

  it("refuses an entity without its gate", async () => {
    await expect(baca(["items:view"], "inventory_value")).rejects.toThrow(/do not have access/);
    await expect(
      aggregateEntity({ actor: { id: "u", name: "U", permissions: [] }, entity: "item", count: true }),
    ).rejects.toThrow(/do not have access/);
  });

  it("refuses a relation whose entity the actor may not read", async () => {
    await expect(baca(["items:view"], "item", { inventoryValues: true })).rejects.toThrow(/do not have access/);
  });

  it("limits a relation without its gate to what the parent page shows", async () => {
    const include = { store: { fields: ["creditLimit"] } };
    await expect(baca(["field_sales_orders:view"], "field_sales_order", include)).rejects.toThrow(/creditLimit/);
  });

  it("a name on a record needs no user-admin permission, but listing people does", async () => {
    await expect(baca(["field_sales_orders:view"], "person")).rejects.toThrow(/do not have access/);
    const orang = VIRA_ENTITIES.find((e) => e.name === "person")!;
    expect(orang.fields.map((f) => f.name)).toEqual(["id", "name"]);
  });

  it("blind counts: no quantity or amount on store returns and warehouse opname", () => {
    for (const nama of ["store_return", "stock_opname"]) {
      const e = VIRA_ENTITIES.find((x) => x.name === nama)!;
      expect(e.fields.filter((f) => f.type === "number"), nama).toEqual([]);
      expect(e.relations.map((r) => r.entity).filter((r) => r !== "store" && r !== "person"), nama).toEqual([]);
    }
  });

  it("entity names are unique and no cost field is exposed outside inventory_value", () => {
    const nama = VIRA_ENTITIES.map((e) => e.name);
    expect(new Set(nama).size).toBe(nama.length);
    for (const e of VIRA_ENTITIES) {
      if (e.name === "inventory_value" || e.name === "fixed_asset") continue;
      expect(e.fields.map((f) => f.name).filter((n) => /cost|hpp|cogs|margin/i.test(n)), e.name).toEqual([]);
    }
  });

  it("list_entities and each description fit the chat's 12k result limit", async () => {
    const daftar = genericTools.find((t) => t.name === "list_entities")!;
    const ctx = { actor: { id: "u", name: "U", permissions: ["*"] }, baseUrl: "http://x" };
    const semua = (await daftar.handler({}, ctx)) as { total: number };
    expect(semua.total).toBe(VIRA_ENTITIES.length);
    expect(await daftar.handler({ entity: "" }, ctx)).toEqual(semua);
    expect(z.object(daftar.inputShape).safeParse({ entity: "" }).success).toBe(true);
    expect(JSON.stringify(semua).length).toBeLessThan(12_000);
    for (const e of VIRA_ENTITIES) {
      expect(JSON.stringify(await daftar.handler({ entity: e.name }, ctx)).length, e.name).toBeLessThan(12_000);
    }
  });

  it("parentShows names only allowed fields", () => {
    for (const e of VIRA_ENTITIES) {
      for (const r of e.relations) {
        const anak = VIRA_ENTITIES.find((x) => x.name === r.entity);
        expect(anak, `${e.name}.${r.name}`).toBeDefined();
        const nama = anak!.fields.map((f) => f.name);
        for (const p of r.parentShows ?? []) expect(nama, `${e.name}.${r.name}`).toContain(p);
      }
    }
  });

  it("restricted parentShows select stays on sel.fields — never the full allowlist", () => {
    const store = getEntity("store")!;
    const select = toPrismaSelect({
      entity: store,
      fields: ["code", "name"],
      restricted: true,
      children: new Map(),
    });
    expect(select).toEqual({ id: true, code: true, name: true });
    expect(select).not.toHaveProperty("creditLimit");
    expect(select).not.toHaveProperty("paymentTempo");
    expect(select).not.toHaveProperty("maxOpenInvoices");
  });

  it("unrestricted select keeps the allowlist so urlPath fields stay loaded", () => {
    const stock = getEntity("inventory_value")!;
    const select = toPrismaSelect({
      entity: stock,
      fields: ["qtyOnHand"],
      restricted: false,
      children: new Map(),
    });
    expect(select).toMatchObject({ id: true, qtyOnHand: true, itemId: true });
  });
});
