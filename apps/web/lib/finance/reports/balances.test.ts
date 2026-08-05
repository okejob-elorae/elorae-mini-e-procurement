import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { getAccountBalances } from "./balances";

/* Creates journals + chart accounts — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getAccountBalances (test bed only)", () => {
  /*
   * Ids are recorded the moment a row is created and every teardown step is a
   * `deleteMany` (a no-op on a missing id) run inside its own try/catch, so a
   * test that fails halfway through its setup still gets a complete cleanup.
   * A teardown built from bare `delete` calls in one chain leaks rows into the
   * shared :3308 dev database as soon as the first step throws. Child accounts
   * go first: `relationMode = "prisma"` makes Prisma refuse to delete a parent
   * whose children are still present.
   */
  let journalIds: string[] = [];
  let accountIds: string[] = [];
  let userIds: string[] = [];

  afterEach(async () => {
    const steps = [
      () => prisma.journalLine.deleteMany({ where: { journalId: { in: journalIds } } }),
      () => prisma.journal.deleteMany({ where: { id: { in: journalIds } } }),
      () => prisma.chartAccount.deleteMany({ where: { parentId: { in: accountIds } } }),
      () => prisma.chartAccount.deleteMany({ where: { id: { in: accountIds } } }),
      () => prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ];
    const failures: unknown[] = [];
    for (const step of steps) {
      try {
        await step();
      } catch (e) {
        failures.push(e);
      }
    }
    journalIds = [];
    accountIds = [];
    userIds = [];
    if (failures.length > 0) throw failures[0];
  });

  /** Digits-only suffix — chart-account codes are numeric. */
  function token(): string {
    return Math.floor(Math.random() * 10_000_000).toString();
  }

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `test-balances-${token()}@test.local`, name: "Test Reporter" },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function createAccount(opts?: { isActive?: boolean; parentId?: string }): Promise<string> {
    const account = await prisma.chartAccount.create({
      data: {
        code: `8${token()}${accountIds.length}`,
        name: "Balances spec account",
        type: "ASET",
        depth: 1,
        isActive: opts?.isActive ?? true,
        parentId: opts?.parentId,
      },
    });
    accountIds.push(account.id);
    return account.id;
  }

  async function createJournal(opts: {
    date: Date;
    postedById: string;
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
  }): Promise<string> {
    const journal = await prisma.journal.create({
      data: {
        date: opts.date,
        description: "Balances spec journal",
        isManual: true,
        postedById: opts.postedById,
        lines: {
          create: [
            { chartAccountId: opts.debitAccountId, debit: opts.amount, credit: 0 },
            { chartAccountId: opts.creditAccountId, debit: 0, credit: opts.amount },
          ],
        },
      },
      select: { id: true },
    });
    journalIds.push(journal.id);
    return journal.id;
  }

  /** Scopes the DB-wide result to this spec's own accounts, keyed by account id. */
  function ownRows(rows: Awaited<ReturnType<typeof getAccountBalances>>, ids: string[]) {
    return new Map(rows.filter((r) => ids.includes(r.accountId)).map((r) => [r.accountId, r]));
  }

  it("includes a journal dated on the inclusive `to` boundary and excludes the next day", async () => {
    const postedById = await createUser();
    const debitId = await createAccount();
    const creditId = await createAccount();
    const to = parseDateOnlyEnd("2026-03-31")!;

    /* 23:59:59.999 WIB on the `to` day — the last instant `parseDateOnlyEnd` admits. */
    await createJournal({ date: to, postedById, debitAccountId: debitId, creditAccountId: creditId, amount: 500 });
    /* 00:00:00.000 WIB the following day — one millisecond past the window. */
    await createJournal({
      date: parseDateOnly("2026-04-01")!,
      postedById,
      debitAccountId: debitId,
      creditAccountId: creditId,
      amount: 700,
    });

    const rows = ownRows(await getAccountBalances({ to }), [debitId, creditId]);

    expect(rows.get(debitId)).toMatchObject({ debit: 500, credit: 0 });
    expect(rows.get(creditId)).toMatchObject({ debit: 0, credit: 500 });
  });

  it("excludes a journal dated before `from`", async () => {
    const postedById = await createUser();
    const debitId = await createAccount();
    const creditId = await createAccount();
    const from = parseDateOnly("2026-03-01")!;
    const to = parseDateOnlyEnd("2026-03-31")!;

    await createJournal({
      date: parseDateOnly("2026-02-28")!,
      postedById,
      debitAccountId: debitId,
      creditAccountId: creditId,
      amount: 900,
    });
    await createJournal({
      date: from,
      postedById,
      debitAccountId: debitId,
      creditAccountId: creditId,
      amount: 250,
    });

    const rows = ownRows(await getAccountBalances({ from, to }), [debitId, creditId]);

    expect(rows.get(debitId)).toMatchObject({ debit: 250, credit: 0 });
    expect(rows.get(creditId)).toMatchObject({ debit: 0, credit: 250 });
  });

  it("sums since inception when `from` is omitted", async () => {
    const postedById = await createUser();
    const debitId = await createAccount();
    const creditId = await createAccount();
    const to = parseDateOnlyEnd("2026-03-31")!;

    await createJournal({
      date: parseDateOnly("2025-01-15")!,
      postedById,
      debitAccountId: debitId,
      creditAccountId: creditId,
      amount: 100,
    });
    await createJournal({
      date: parseDateOnly("2026-03-10")!,
      postedById,
      debitAccountId: debitId,
      creditAccountId: creditId,
      amount: 40,
    });

    const rows = ownRows(await getAccountBalances({ to }), [debitId, creditId]);

    expect(rows.get(debitId)).toMatchObject({ debit: 140, credit: 0 });
    expect(rows.get(creditId)).toMatchObject({ debit: 0, credit: 140 });
  });

  it("keeps an inactive account that carries movement and drops one that does not", async () => {
    const postedById = await createUser();
    const inactiveWithMovement = await createAccount({ isActive: false });
    const activeCounterparty = await createAccount();
    const inactiveEmpty = await createAccount({ isActive: false });
    const to = parseDateOnlyEnd("2026-03-31")!;

    await createJournal({
      date: parseDateOnly("2026-03-05")!,
      postedById,
      debitAccountId: inactiveWithMovement,
      creditAccountId: activeCounterparty,
      amount: 300,
    });

    const rows = ownRows(await getAccountBalances({ to }), [
      inactiveWithMovement,
      activeCounterparty,
      inactiveEmpty,
    ]);

    expect(rows.get(inactiveWithMovement)).toMatchObject({ isActive: false, debit: 300 });
    expect(rows.has(inactiveEmpty)).toBe(false);
    expect(rows.get(activeCounterparty)).toMatchObject({ isActive: true, credit: 300 });
  });

  it("flags an account with children even when the child has no movement in range", async () => {
    const postedById = await createUser();
    const parentId = await createAccount();
    const counterpartyId = await createAccount();
    await createAccount({ parentId });
    const to = parseDateOnlyEnd("2026-03-31")!;

    await createJournal({
      date: parseDateOnly("2026-03-09")!,
      postedById,
      debitAccountId: parentId,
      creditAccountId: counterpartyId,
      amount: 75,
    });

    const rows = ownRows(await getAccountBalances({ to }), [parentId]);

    expect(rows.get(parentId)).toMatchObject({ hasChildren: true, debit: 75 });
  });
});
