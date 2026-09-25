import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  auditEntityLabel,
  humanizeAuditCode,
  type AuditLabelTranslator,
} from "./action-label";

function fakeTranslator(messages: Record<string, string>): AuditLabelTranslator {
  const t = ((key: string, values?: Record<string, string | number>) => {
    const message = messages[key];
    if (message === undefined) throw new Error(`missing key ${key}`);
    return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  }) as AuditLabelTranslator;
  t.has = (key: string) => key in messages;
  return t;
}

const t = fakeTranslator({
  unknownEntity: "Data",
  "actions.CREATE": "{entity} dibuat",
  "actions.CONTENT_PLAN_SWAPPED": "Rencana konten ditukar",
  "entities.PlanYear": "Tahun rencana",
  "entities.ContentPlan": "Rencana konten",
});

describe("humanizeAuditCode", () => {
  it("turns SNAKE_CASE into a sentence", () => {
    expect(humanizeAuditCode("CONTENT_PLAN_SWAPPED")).toBe("Content plan swapped");
    expect(humanizeAuditCode("CREATE")).toBe("Create");
  });

  it("splits PascalCase and keeps acronyms", () => {
    expect(humanizeAuditCode("ContentPlan")).toBe("Content plan");
    expect(humanizeAuditCode("PurchaseOrderPaymentReceipt")).toBe("Purchase order payment receipt");
    expect(humanizeAuditCode("FGReceipt")).toBe("FG receipt");
    expect(humanizeAuditCode("GRN")).toBe("Grn");
  });

  it("handles other separators, stray spaces and empty input", () => {
    expect(humanizeAuditCode("  stock-card.printed ")).toBe("Stock card printed");
    expect(humanizeAuditCode("")).toBe("");
    expect(humanizeAuditCode(null)).toBe("");
    expect(humanizeAuditCode(undefined)).toBe("");
  });

  it("never returns an underscore", () => {
    for (const code of ["A_B_C", "__LEADING", "TRAILING__", "Mixed_Case_Code"]) {
      expect(humanizeAuditCode(code)).not.toContain("_");
    }
  });
});

describe("auditActionLabel", () => {
  it("uses the translated label for a specific action", () => {
    expect(auditActionLabel(t, "CONTENT_PLAN_SWAPPED", "ContentPlan")).toBe("Rencana konten ditukar");
  });

  it("fills the entity into a generic action", () => {
    expect(auditActionLabel(t, "CREATE", "PlanYear")).toBe("Tahun rencana dibuat");
    expect(auditActionLabel(t, "CREATE", "SomeNewThing")).toBe("Some new thing dibuat");
    expect(auditActionLabel(t, "CREATE")).toBe("Data dibuat");
  });

  it("falls back to a humanised code for an unknown action", () => {
    expect(auditActionLabel(t, "KOL_BRIEF_ARCHIVED", "KolBrief")).toBe("Kol brief archived");
    expect(auditActionLabel(t, "weird.code", "KolBrief")).toBe("Weird code");
    expect(auditActionLabel(t, "")).toBe("—");
  });
});

describe("auditEntityLabel", () => {
  it("translates a known entity and humanises an unknown one", () => {
    expect(auditEntityLabel(t, "ContentPlan")).toBe("Rencana konten");
    expect(auditEntityLabel(t, "VendorReturn")).toBe("Vendor return");
    expect(auditEntityLabel(t, null)).toBe("—");
  });
});
