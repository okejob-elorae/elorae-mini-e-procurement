import { describe, expect, it } from "vitest";
import { DocType } from "@elorae/db";
import enMessages from "../i18n/messages/en.json";
import idMessages from "../i18n/messages/id.json";
import { DOC_TYPE_GROUP, DOC_TYPE_GROUP_ORDER, docTypesInGroup, isDocTypeValue } from "./doc-type-groups";

describe("DOC_TYPE_GROUP", () => {
  it("covers exactly the Prisma DocType members", () => {
    expect(Object.keys(DOC_TYPE_GROUP).sort()).toEqual(Object.values(DocType).sort());
  });

  it("places every doc type in exactly one ordered, non-empty group", () => {
    const listed = DOC_TYPE_GROUP_ORDER.flatMap((group) => docTypesInGroup(group));
    expect(listed.sort()).toEqual(Object.keys(DOC_TYPE_GROUP).sort());
    for (const group of DOC_TYPE_GROUP_ORDER) expect(docTypesInGroup(group).length).toBeGreaterThan(0);
  });

  it("recognises members and rejects anything else", () => {
    expect(isDocTypeValue("PUTUS")).toBe(true);
    expect(isDocTypeValue("putus")).toBe(false);
    expect(isDocTypeValue("toString")).toBe(false);
  });

  it("has a label for every doc type and group in both locales", () => {
    for (const messages of [enMessages, idMessages]) {
      const docs = messages.documents as { docTypes: Record<string, string>; groups: Record<string, string> };
      for (const type of Object.keys(DOC_TYPE_GROUP)) expect(docs.docTypes[type], type).toBeTruthy();
      for (const group of DOC_TYPE_GROUP_ORDER) expect(docs.groups[group], group).toBeTruthy();
    }
  });
});
