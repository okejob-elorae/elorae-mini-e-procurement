import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { loadActor } from "./akses";
import { ViraAuthError, type ViraAuthReason } from "./errors";
import { passwordFingerprint } from "./token";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `VIRA-AKSES-${Math.random().toString(36).slice(2, 8)}`;
const HASH = `hash-${tag}`;
const CODE_A = `${tag.toLowerCase()}:view`;
const CODE_B = `${tag.toLowerCase()}:edit`;

async function reasonOf(promise: Promise<unknown>): Promise<ViraAuthReason> {
  const err = await promise.then(
    () => {
      throw new Error("expected a ViraAuthError, got success");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ViraAuthError);
  return (err as ViraAuthError).reason;
}

d("loadActor (test bed only)", () => {
  let peran = "";
  let peranSistem = "";
  let permA = "";
  let permB = "";
  let pengguna = "";
  let penggunaSistem = "";

  beforeAll(async () => {
    peran = "";
    peranSistem = "";
    permA = "";
    permB = "";
    pengguna = "";
    penggunaSistem = "";
    permA = (await prisma.permission.create({ data: { code: CODE_A, module: tag, action: "view" } })).id;
    permB = (await prisma.permission.create({ data: { code: CODE_B, module: tag, action: "edit" } })).id;
    peran = (
      await prisma.roleDefinition.create({
        data: {
          name: `${tag}-BIASA`,
          isSystem: false,
          permissions: { create: [{ permissionId: permA }, { permissionId: permB }] },
        },
      })
    ).id;
    peranSistem = (await prisma.roleDefinition.create({ data: { name: `${tag}-SISTEM`, isSystem: true } })).id;
    pengguna = (
      await prisma.user.create({
        data: { email: `${tag}-a@uji.local`, name: `${tag} A`, roleId: peran, passwordHash: HASH },
      })
    ).id;
    penggunaSistem = (
      await prisma.user.create({
        data: { email: `${tag}-s@uji.local`, name: null, roleId: peranSistem, passwordHash: HASH },
      })
    ).id;
  });

  afterAll(async () => {
    if (pengguna) await prisma.user.delete({ where: { id: seededId(pengguna) } });
    if (penggunaSistem) await prisma.user.delete({ where: { id: seededId(penggunaSistem) } });
    if (peran) await prisma.roleDefinition.delete({ where: { id: seededId(peran) } });
    if (peranSistem) await prisma.roleDefinition.delete({ where: { id: seededId(peranSistem) } });
    if (permA) await prisma.permission.delete({ where: { id: seededId(permA) } });
    if (permB) await prisma.permission.delete({ where: { id: seededId(permB) } });
  });

  it("an existing user with a matching pwf → actor with the role's permissions", async () => {
    const actor = await loadActor({ sub: pengguna, pwf: passwordFingerprint(HASH) });
    expect(actor.id).toBe(pengguna);
    expect(actor.name).toBe(`${tag} A`);
    expect([...actor.permissions].sort()).toEqual([CODE_A, CODE_B].sort());
  });

  it('an unknown sub → "invalid"', async () => {
    expect(await reasonOf(loadActor({ sub: `${tag}-tidak-ada`, pwf: passwordFingerprint(HASH) }))).toBe("invalid");
  });

  it('a wrong pwf → "invalid"', async () => {
    expect(await reasonOf(loadActor({ sub: pengguna, pwf: passwordFingerprint("another-hash") }))).toBe("invalid");
  });

  it("a permission removed from the role after the first call is gone on the second call", async () => {
    const claims = { sub: pengguna, pwf: passwordFingerprint(HASH) };
    expect((await loadActor(claims)).permissions).toContain(CODE_B);
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: seededId(peran), permissionId: seededId(permB) } },
    });
    const second = await loadActor(claims);
    expect(second.permissions).toContain(CODE_A);
    expect(second.permissions).not.toContain(CODE_B);
  });

  it('a system role → permissions ["*"]; a null name gives an empty name', async () => {
    const actor = await loadActor({ sub: penggunaSistem, pwf: passwordFingerprint(HASH) });
    expect(actor.permissions).toEqual(["*"]);
    expect(actor.name).toBe("");
  });
});
