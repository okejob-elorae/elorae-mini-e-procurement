import { prisma } from "@elorae/db";
import { daysOverdue } from "./aging";
import { OVERDUE_THRESHOLD_SETTING_KEY, parseOverdueThresholds } from "./overdue-thresholds";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { sendNotificationToUsers } from "@/lib/notifications/recipients";
import { capNotificationText } from "@/lib/notifications/text";
import { PILIH_POTONGAN, potonganRetur } from "@/lib/receivables/deductions";
import { daftarPiutang, type BarisPiutang } from "@/lib/receivables/queries";
import { keadaanPiutang, returTertahan, type KeadaanPiutang } from "@/lib/receivables/rules";
import { penagihPiutang } from "@/lib/stores/penanggung-jawab";

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" });

/** Oldest-due-first, so a large historical backlog drains in the order that matters most. */
const MAX_ANNOUNCEMENTS_PER_RUN = 200;

/** `daftarPiutang` filters on an id list; chunked so a large first-run backlog never builds one enormous `IN (...)`. */
const RECOMPUTE_CHUNK = 500;

/**
 * Why a newly crossed threshold was NOT announced. Each one leaves no `AR_OVERDUE` marker, so the
 * crossing is judged again on the next run: a payment report that is rejected, a kontrabon that is
 * cancelled or a held return that is settled lets the reminder fire then, at the highest threshold
 * crossed by that day.
 */
export type OverdueSkipReason =
  /** The receivables module's recomputed balance is zero, whatever the team `status` column says (a konsi bill, for now: its stored balance — `konsiInterimState`). */
  | "SETTLED"
  /** A payment report (BKM, or the team's collection submission / settlement) is waiting for its check. */
  | "PAYMENT_REPORT_PENDING"
  /** Part of the balance is held by a return deduction the warehouse has not counted or nobody has borne yet. */
  | "RETURN_HELD"
  /** The invoice sits in a running kontrabon, which is chased by its own promised date instead. */
  | "KONTRABON"
  /**
   * Neither `daftarPiutang` nor the interim KONSI read (`readKonsiInterimStates`) returned the
   * receivable — in practice only a row that changed under the sweep between its reads.
   */
  | "NOT_LISTED";

const OVERDUE_SKIP_REASONS: readonly OverdueSkipReason[] = [
  "SETTLED",
  "PAYMENT_REPORT_PENDING",
  "RETURN_HELD",
  "KONTRABON",
  "NOT_LISTED",
];

export type OverdueSweepResult = {
  scanned: number;
  announced: number;
  deferred: number;
  /** Announcements whose phone notice went to a person (the store's holder, else the invoice's seller). */
  collectorNotified: number;
  /** Announcements with nobody to tell on the phone: no holder and no seller, or that user is gone. */
  unassigned: number;
  failed: number;
  skipped: Record<OverdueSkipReason, number>;
};

/** What the sweep needs from the receivables module's view of one receivable. */
type MoneyState = Pick<BarisPiutang, "invoiceNo" | "keadaan" | "outstanding">;

/**
 * Whether a newly crossed threshold is announced, judged by the receivables module's own rules
 * (`daftarPiutang` → `keadaanPiutang` in `lib/receivables/rules.ts`), not by the team `status`
 * column alone. `null` means announce.
 *
 * Only the money state `belum` — open, nothing hanging on it — is chased from the due date. That is
 * the same rule as the receivables screens' "lewat jatuh tempo" (`hariLewatJatuhTempo`): a salesman
 * who has already reported a payment is not scolded as a defaulter while finance checks it, a
 * running kontrabon is chased by its promise date, and a held return deduction is a money rule
 * waiting on the warehouse, not a debt to chase. The order mirrors `keadaanPiutang`: settled beats
 * everything, and a pending report beats a held return.
 *
 * `teamReportPending` covers the team's two payment-report paths that `daftarPiutang` cannot see —
 * a PENDING `CollectionSubmission` or a PENDING `StoreSettlement` — for as long as they still exist
 * beside the BKM. Someone who reported through them has reported all the same.
 */
export function overdueSkipReason(input: {
  row: Pick<MoneyState, "keadaan" | "outstanding"> | undefined;
  teamReportPending: boolean;
}): OverdueSkipReason | null {
  const { row } = input;
  if (!row) return "NOT_LISTED";
  if (row.outstanding <= 0) return "SETTLED";
  const byState = skipForMoneyState(row.keadaan);
  if (byState === "SETTLED") return byState;
  if (input.teamReportPending) return "PAYMENT_REPORT_PENDING";
  return byState;
}

function skipForMoneyState(keadaan: KeadaanPiutang): OverdueSkipReason | null {
  switch (keadaan) {
    case "lunas":
      return "SETTLED";
    case "klaim":
      return "PAYMENT_REPORT_PENDING";
    case "tertahan":
      return "RETURN_HELD";
    case "tt":
    case "lewat":
      return "KONTRABON";
    case "belum":
      return null;
    default: {
      /* A new money state is a compile error here until someone decides whether it is chased. */
      const unhandled: never = keadaan;
      return unhandled;
    }
  }
}

export type OverdueRecipientBasis = "STORE_HOLDER" | "SELLER";

/**
 * Who is told on the phone: the receivables module's collector rule (`penagihPiutang`, owner
 * decision) — the store's CURRENT holder (`Store.salesmanId`), or the invoice's seller while the
 * store has no holder. The same person sees the invoice on their Tagihan screen
 * (`daftarPiutang({ penagihId })`), whichever path created it: a delivery, an Excel import or a
 * manual invoice. An imported or manual invoice may carry no seller; with no holder either, nobody
 * is told on the phone and only the office hears of it.
 *
 * The team's `Receivable.collectorId` is deliberately not read: it is set only from the team's
 * Penagihan screen, which never runs for imported or manual invoices, so a reminder keyed on it
 * reached nobody's phone for most of them.
 */
export function overdueRecipient(r: {
  storeHolderId: string | null;
  sellerId: string | null;
}): { userId: string; basis: OverdueRecipientBasis } | null {
  const holder = r.storeHolderId || null;
  const seller = r.sellerId || null;
  if (seller) {
    const userId = penagihPiutang({ penanggungJawabId: holder, penjualId: seller });
    return { userId, basis: userId === holder ? "STORE_HOLDER" : "SELLER" };
  }
  return holder ? { userId: holder, basis: "STORE_HOLDER" } : null;
}

function dueText(days: number): string {
  return days === 0 ? "jatuh tempo hari ini" : `sudah lewat ${days} hari dari jatuh tempo`;
}

/**
 * The phone notice's text, addressed to the collector. A KONSI store's amount never goes into it:
 * consignment totals never reach the salesman's phone, not on screen and not in a payload (the
 * push `data` carries ids and day counts only). Konsi bills do reach this push — through
 * `konsiInterimState` today, through `daftarPiutang` once it lists them. The office row keeps the
 * amount.
 */
export function overduePhoneText(n: {
  docNo: string;
  storeName: string;
  termsType: string;
  outstanding: number;
  days: number;
}): { title: string; body: string } {
  const amount = n.termsType === "KONSI" ? "" : ` sebesar ${rupiah.format(n.outstanding)}`;
  return {
    title: n.days === 0 ? "Tagihan jatuh tempo hari ini" : `Tagihan lewat jatuh tempo ${n.days} hari`,
    body: `Nota ${n.docNo} di ${n.storeName}${amount} ${dueText(n.days)}. Mohon ditagih.`,
  };
}

/** The receivables module's view of each id, read in chunks; an id it does not list is absent from the map. */
async function readReceivableStates(ids: string[]): Promise<Map<string, MoneyState>> {
  const byId = new Map<string, MoneyState>();
  for (let i = 0; i < ids.length; i += RECOMPUTE_CHUNK) {
    const rows = await daftarPiutang({ receivableIds: ids.slice(i, i + RECOMPUTE_CHUNK) });
    for (const row of rows) byId.set(row.id, row);
  }
  return byId;
}

/**
 * INTERIM, KONSI stores only — delete it together with the KONSI filter in `daftarPiutang`.
 *
 * The owner decided that konsi bills are receivables (clarification of 2026-10-29: the rule "a
 * konsi store never appears in receivables" is deleted, the list gets a konsi/non-konsi filter),
 * but `daftarPiutang` still filters `store.termsType != KONSI`. Without this, every konsi
 * sell-through bill crossing a threshold would be dropped as NOT_LISTED — no office reminder at
 * all, where the team's sweep used to send one.
 *
 * The balance is the team's stored `outstandingAmount`, which the payment and BKM writers keep in
 * step (`selaraskanSisaPiutang` and the office-payment columns in `lib/receivables/writer.ts`), not
 * a recomputation: recomputing would be a second copy of `daftarPiutang`'s claim mapping. The
 * owner's skip rules still apply through the same `keadaanPiutang`, in the same order: a BKM
 * waiting for its check, a return deduction held on a verified BKM (read through the one
 * translator, `potonganRetur`), a running kontrabon. Once `daftarPiutang` lists konsi bills, it
 * returns them first and this is never consulted.
 */
export function konsiInterimState(input: {
  invoiceNo: string;
  storedOutstanding: number;
  pendingClaimDocNo: string | null;
  heldReturn: number;
  runningKontrabon: { docNo: string; promisedDate: Date } | null;
  asOf: Date;
}): MoneyState {
  return {
    invoiceNo: input.invoiceNo,
    outstanding: input.storedOutstanding,
    keadaan: keadaanPiutang({
      sisa: input.storedOutstanding,
      klaimMenunggu: input.pendingClaimDocNo ? { docNo: input.pendingClaimDocNo } : null,
      nilaiTertahan: input.heldReturn,
      kontrabon: input.runningKontrabon
        ? { docNo: input.runningKontrabon.docNo, janjiBayar: input.runningKontrabon.promisedDate }
        : null,
      hariIni: input.asOf,
    }),
  };
}

/** `konsiInterimState` for each id, read in chunks. Filters on the store's terms itself, so a non-konsi id can never take this path. */
async function readKonsiInterimStates(ids: string[], asOf: Date): Promise<Map<string, MoneyState>> {
  const byId = new Map<string, MoneyState>();
  for (let i = 0; i < ids.length; i += RECOMPUTE_CHUNK) {
    const rows = await prisma.receivable.findMany({
      where: { id: { in: ids.slice(i, i + RECOMPUTE_CHUNK) }, store: { termsType: "KONSI" } },
      select: {
        id: true,
        invoiceNo: true,
        outstandingAmount: true,
        claimLinks: {
          where: { paymentClaim: { status: { in: ["DIKIRIM", "TERVERIFIKASI"] } } },
          select: { paymentClaim: { select: { docNo: true, status: true, deductions: { select: PILIH_POTONGAN } } } },
        },
        collectionLinks: {
          where: { collectionNote: { status: "BERJALAN" } },
          select: { collectionNote: { select: { docNo: true, promisedDate: true } } },
          take: 1,
        },
      },
    });
    for (const r of rows) {
      const pending = r.claimLinks.find((l) => l.paymentClaim.status === "DIKIRIM");
      const heldReturn = r.claimLinks
        .filter((l) => l.paymentClaim.status === "TERVERIFIKASI")
        .reduce((sum, l) => sum + returTertahan(potonganRetur(l.paymentClaim.deductions)), 0);
      const note = r.collectionLinks[0]?.collectionNote ?? null;
      byId.set(
        r.id,
        konsiInterimState({
          invoiceNo: r.invoiceNo,
          storedOutstanding: Number(r.outstandingAmount),
          pendingClaimDocNo: pending?.paymentClaim.docNo ?? null,
          heldReturn,
          runningKontrabon: note,
          asOf,
        }),
      );
    }
  }
  return byId;
}

/**
 * The phone push to the collector. Carries no `VITEST` guard of its own, unlike its siblings in the
 * konsi count sweep and the settlement reject writer: `sendNotificationToUsers` is guarded itself,
 * and a second guard here would stop the sweep's spec from ever reaching the helper, which is the
 * seam its failure case stubs to make one receivable's notify throw. Not `kabariPengguna`, for the
 * same reason and because that helper swallows its own failure — the loop below must see a throw to
 * leave the crossing unannounced for a retry.
 *
 * The type stays `AR_OVERDUE`: the office row and the phone row are one reminder. `storeId` in
 * `data` is what opens the store's Tagihan screen on the phone (`/pwa/piutang/<storeId>`).
 */
async function notifyCollectorOfOverdue(
  collectorId: string,
  fcmToken: string | null,
  payload: { title: string; body: string; data: Record<string, string> },
): Promise<void> {
  await sendNotificationToUsers([{ id: collectorId, fcmToken }], { type: "AR_OVERDUE", ...payload });
}

/**
 * Fires one `AR_OVERDUE` `AdminNotification` per receivable per run, at the highest configured
 * threshold it has newly crossed, and one `NotificationQueue` row to the person who collects it.
 * See docs/superpowers/specs/2026-09-01-overdue-notification-design.md for the reasoning behind the
 * thresholds, the dedup marker and the cap. Since the owner's decision of 2026-11-01 (keep the
 * reminders, with the receivables module's rules) it differs from that spec in three ways:
 *
 * - A candidate is still picked by the team `status` (OUTSTANDING/PARTIAL), but announced only when
 *   the receivables module also calls it open and chaseable (`overdueSkipReason`): its balance is
 *   recomputed from zero (`daftarPiutang`), and a pending payment report, an open kontrabon or a
 *   held return deduction skips it. Both sides have to say "unpaid", so nobody is ever reminded
 *   about an invoice either side considers settled.
 * - The phone notice goes to the store's current holder, else the invoice's seller
 *   (`overdueRecipient`), never to the team's assigned collector.
 * - The amount in the reminder is the recomputed balance, not the stored `outstandingAmount`.
 *
 * Konsi bills are the one interim exception: `daftarPiutang` does not list them yet, so they are
 * judged by `konsiInterimState` (stored balance, same skip rules) — see there for why and when it
 * goes.
 *
 * As before, the collector push runs BEFORE the `AR_OVERDUE` row, and a receivable that throws is
 * logged, counted in `failed` and skipped instead of halting the run — the loop body says why.
 *
 * `receivableIds` scopes the sweep to specific rows; omitted, it sweeps every OUTSTANDING/PARTIAL
 * receivable. Every test MUST pass it — this repo's specs share the `:3308` dev bed with real
 * data, and an unscoped sweep invoked from a test mutates real rows.
 */
export async function runOverdueSweep(options?: {
  receivableIds?: string[];
  asOf?: Date;
  maxAnnouncementsPerRun?: number;
}): Promise<OverdueSweepResult> {
  const asOf = options?.asOf ?? new Date();
  const cap = options?.maxAnnouncementsPerRun ?? MAX_ANNOUNCEMENTS_PER_RUN;

  const setting = await prisma.systemSetting.findUnique({
    where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
    select: { value: true },
  });
  const thresholds = parseOverdueThresholds(setting?.value ?? null);

  const receivables = await prisma.receivable.findMany({
    where: {
      status: { in: ["OUTSTANDING", "PARTIAL"] },
      ...(options?.receivableIds ? { id: { in: options.receivableIds } } : {}),
    },
    orderBy: { dueDate: "asc" },
    select: {
      id: true,
      storeId: true,
      dueDate: true,
      salesmanId: true,
      salesman: { select: { name: true, fcmToken: true } },
      store: {
        select: { name: true, termsType: true, salesmanId: true, salesman: { select: { name: true, fcmToken: true } } },
      },
      submissions: { where: { status: "PENDING" }, select: { id: true }, take: 1 },
      settlementInvoices: { where: { settlement: { status: "PENDING" } }, select: { id: true }, take: 1 },
    },
  });

  /*
   * Deliberately NO `take` and NO `createdAt` floor. A capped dedup read would be a bug here:
   * a duplicate alert is cheap elsewhere, but this IS the only record that a one-shot crossing
   * already fired — a row falling outside a window would make the sweep re-announce it forever.
   * Volume is bounded by construction (roughly one row per receivable per threshold), and
   * `@@index([category, createdAt])` makes the read indexed even unfiltered.
   */
  const priorRows = await prisma.adminNotification.findMany({
    where: { category: "AR_OVERDUE" },
    select: { metadata: true },
  });
  const highestAnnounced = new Map<string, number>();
  for (const row of priorRows) {
    const meta = row.metadata as { receivableId?: string; thresholdDays?: number } | null;
    if (!meta?.receivableId || typeof meta.thresholdDays !== "number") continue;
    const current = highestAnnounced.get(meta.receivableId);
    if (current === undefined || meta.thresholdDays > current) highestAnnounced.set(meta.receivableId, meta.thresholdDays);
  }

  const crossings: { r: (typeof receivables)[number]; days: number; tStar: number }[] = [];
  for (const r of receivables) {
    const days = daysOverdue(r.dueDate, asOf);
    const crossed = thresholds.filter((t) => t <= days);
    if (crossed.length === 0) continue; // not yet due at any configured threshold

    const tStar = crossed[crossed.length - 1];
    const tLast = highestAnnounced.get(r.id);
    if (tLast !== undefined && tStar <= tLast) continue;
    crossings.push({ r, days, tStar });
  }

  /* Recomputed only for the rows with a new crossing — a day-to-day run touches a handful. */
  const states = await readReceivableStates(crossings.map((c) => c.r.id));
  const konsiUnlisted = crossings.filter((c) => !states.has(c.r.id) && c.r.store.termsType === "KONSI").map((c) => c.r.id);
  const konsiStates = konsiUnlisted.length > 0 ? await readKonsiInterimStates(konsiUnlisted, asOf) : new Map<string, MoneyState>();

  let announced = 0;
  let deferred = 0;
  let collectorNotified = 0;
  let unassigned = 0;
  let failed = 0;
  const skipped = Object.fromEntries(OVERDUE_SKIP_REASONS.map((k) => [k, 0])) as Record<OverdueSkipReason, number>;

  for (const { r, days, tStar } of crossings) {
    const listed = states.get(r.id);
    const state = listed ?? konsiStates.get(r.id);
    const skip = overdueSkipReason({
      row: state,
      teamReportPending: r.submissions.length > 0 || r.settlementInvoices.length > 0,
    });
    if (skip !== null || state === undefined) {
      skipped[skip ?? "NOT_LISTED"]++;
      continue;
    }

    /* A skipped crossing never takes a slot: the cap counts reminders, not rows looked at. */
    if (announced >= cap) {
      deferred++;
      continue;
    }

    /*
     * `Store.salesmanId` and `Receivable.salesmanId` are FK-free under `relationMode = "prisma"`.
     * On an OPTIONAL relation a stale id resolves the user object to `null` rather than throwing,
     * and such a receivable is treated as having nobody to tell — never re-routed to the other
     * person, which would contradict the collector rule the Tagihan screen applies.
     */
    const recipient = overdueRecipient({ storeHolderId: r.store.salesmanId, sellerId: r.salesmanId });
    const recipientUser = recipient === null ? null : recipient.basis === "STORE_HOLDER" ? r.store.salesman : r.salesman;
    const collectorId = recipient !== null && recipientUser ? recipient.userId : null;
    const collectorName = collectorId ? (recipientUser?.name ?? null) : null;
    if (!collectorId) unassigned++;

    const docNo = state.invoiceNo;
    const outstandingAmount = state.outstanding;
    const heading = days === 0 ? "Piutang jatuh tempo hari ini" : `Piutang jatuh tempo ${days} hari`;
    const collectorRole = recipient?.basis === "SELLER" ? "penjual nota, toko belum punya pemegang" : "pemegang toko";

    /* `AdminNotification.title` is VARCHAR(191); a long store name would otherwise fail this crossing on every run. */
    const title = capNotificationText(
      collectorId ? `${heading} — ${r.store.name}` : `${heading} (belum ada penagih) — ${r.store.name}`,
    );
    const message =
      `Nota ${docNo} sebesar ${rupiah.format(outstandingAmount)} ${dueText(days)}.` +
      (collectorId
        ? ` Penagih: ${collectorName ?? "-"} (${collectorRole}).`
        : " Belum ada penagih yang bisa dikabari: tetapkan pemegang toko di data toko.");

    /*
     * A konsi bill judged by `konsiInterimState` carries no `receivableId`/`storeId`, so tapping it
     * opens the Tagihan list (`/pwa/piutang`): `/pwa/piutang/<storeId>` is `notFound()` for a store
     * `daftarPiutang` lists nothing for, and without `storeId` but with `receivableId` the phone
     * would open the team's retiring Penagihan screen. Once `daftarPiutang` lists konsi bills,
     * `listed` is set and they take the normal link.
     */
    const timing = { thresholdDays: String(tStar), daysOverdue: String(days) };
    const collectorPayload = {
      ...overduePhoneText({ docNo, storeName: r.store.name, termsType: r.store.termsType, outstanding: outstandingAmount, days }),
      data: listed ? { receivableId: r.id, storeId: r.storeId, ...timing } : timing,
    };

    /**
     * One receivable's failure must not halt the run, and must not mark its crossing announced.
     * The `AR_OVERDUE` row is the dedup marker, so it is written LAST, after the collector push —
     * the same order as the konsi count sweep's `KONSI_COUNT_DUE` marker. A throw before it leaves
     * no marker, and the next run retries the crossing; a crossing that did land has its marker and
     * is never re-announced. The catch sits here, around the collector push and the marker, and
     * NOT inside `sendNotificationToUsers`: swallowing a `NotificationQueue` insert failure there
     * would report success to this loop, which would then write the marker for a collector who was
     * never told. The collector push has one recipient, and the helper's only uncaught write is that
     * recipient's queue insert, so a throw from it means nothing reached the collector and a retry
     * does not double-notify. The one duplicate this order can cost: the push lands and the marker
     * insert then throws, so the next run pushes to the collector again.
     */
    try {
      if (collectorId) await notifyCollectorOfOverdue(collectorId, recipientUser?.fcmToken ?? null, collectorPayload);

      /*
       * Every metadata value is a flat scalar. `toFcmData` (admin-fanout.ts) stringifies scalars
       * and DROPS null/undefined/objects/arrays — a nested value would silently vanish from the
       * push payload. `collectorId`/`collectorName`/`collectorBasis` are written as `""` rather than
       * null for the same reason. `thresholdDays` is the dedup key read back above and is
       * load-bearing: a row written without it is invisible to the dedup map and re-announces every
       * future run. `collectorId` names the person told on the phone (holder or seller).
       */
      const notification = await prisma.adminNotification.create({
        data: {
          category: "AR_OVERDUE",
          severity: "WARNING",
          title,
          message,
          metadata: {
            receivableId: r.id,
            thresholdDays: tStar,
            daysOverdue: days,
            storeId: r.storeId,
            storeName: r.store.name,
            docNo,
            outstandingAmount,
            collectorId: collectorId ?? "",
            collectorName: collectorName ?? "",
            collectorBasis: collectorId && recipient ? recipient.basis : "",
          },
        },
      });

      /**
       * AWAITED — a deliberate exception, shared with the konsi count sweep, where no user is
       * waiting either. `reportStuckDeliveryCompletionAction` awaits too, but it is no precedent: the
       * PWA's offline queue calls it mostly from background sync, and also from the pending screen's
       * Retry, where a salesman IS waiting. Interactive callers fire
       * `void fanOutAdminNotification(...)` because a user is waiting on an already-committed
       * transaction; in a cron nobody is waiting, and hundreds of unawaited fan-outs in one tick
       * (each an FCM call retrying for roughly a minute on network failure) is a stampede.
       * `fanOutAdminNotification` wraps its whole body in try/catch and never throws, so awaiting
       * it here is safe, and sitting inside this try can never count a crossing whose marker was
       * written as failed. DO NOT copy this `await` into any interactive call site.
       */
      await fanOutAdminNotification(notification);
    } catch (err) {
      failed++;
      console.error(`[overdue-sweep] receivable ${r.id} at ${tStar} days failed; its crossing stays unannounced for the next run`, err);
      continue;
    }

    if (collectorId) collectorNotified++;
    announced++;
  }

  return { scanned: receivables.length, announced, deferred, collectorNotified, unassigned, failed, skipped };
}
