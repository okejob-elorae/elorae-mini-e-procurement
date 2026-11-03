import { prisma } from "@elorae/db";
import { daysOverdue } from "./aging";
import { OVERDUE_THRESHOLD_SETTING_KEY, parseOverdueThresholds } from "./overdue-thresholds";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { sendNotificationToUsers } from "@/lib/notifications/recipients";
import { capNotificationText, NOTIFICATION_TEXT_MAX } from "@/lib/notifications/text";
import { daftarPiutang, type BarisPiutang } from "@/lib/receivables/queries";
import type { JenisTahanan, KeadaanPiutang } from "@/lib/receivables/rules";
import { rangkaiDalamBatas } from "@/lib/spg/antaran";
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
  /** The receivables module's recomputed balance is zero, whatever the team `status` column says. Konsi bills included: `daftarPiutang` lists them like any other. */
  | "SETTLED"
  /** A payment report (BKM, or the team's collection submission / settlement) is waiting for its check. */
  | "PAYMENT_REPORT_PENDING"
  /**
   * The WHOLE balance waits for a return deduction the warehouse has not counted, or whose
   * shortfall nobody has borne yet. A nota only PARTLY held is reminded for the part outside the
   * hold (owner decision Q15), so it never lands here.
   */
  | "RETURN_HELD"
  /** The invoice sits in a running kontrabon, which is chased by its own promised date instead. */
  | "KONTRABON"
  /** `daftarPiutang` did not return the receivable — in practice only a row that changed under the sweep between its reads. */
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
  /** Announcements of a nota partly held by a return deduction — the reminder names the held part. */
  partlyHeld: number;
  deferred: number;
  /** Announcements whose phone notice went to a person (the store's holder, else the invoice's seller). */
  collectorNotified: number;
  /** Announcements with nobody to tell on the phone: no holder and no seller, or that user is gone. */
  unassigned: number;
  failed: number;
  skipped: Record<OverdueSkipReason, number>;
};

/**
 * What the sweep needs from the receivables module's view of one receivable. The split of a held
 * nota is `daftarPiutang`'s own (`pisahTahananRetur`): `bolehDilunasi` is the part outside the
 * hold, `ditahanRetur` the part waiting for the return count or the shortfall decision, and
 * `sebabDitahan` which of the two it waits for. A field left out reads as nothing collectable —
 * the whole balance held — which is the safe direction.
 */
type MoneyState = Pick<BarisPiutang, "invoiceNo" | "keadaan" | "outstanding"> & {
  bolehDilunasi?: number;
  adaKontrabon?: boolean;
  ditahanRetur?: number;
  sebabDitahan?: JenisTahanan | null;
};

/**
 * Whether a newly crossed threshold is announced, judged by the receivables module's own rules
 * (`daftarPiutang` → `keadaanPiutang` in `lib/receivables/rules.ts`), not by the team `status`
 * column alone. `null` means announce.
 *
 * The money state `belum` — open, nothing hanging on it — is chased from the due date, the same
 * rule as the receivables screens' "lewat jatuh tempo" (`hariLewatJatuhTempo`): a salesman who has
 * already reported a payment is not scolded as a defaulter while finance checks it, and a running
 * kontrabon is chased by its promise date. A nota held by a return deduction (`tertahan`) is
 * chased for the part OUTSIDE the hold (owner decision Q15, 2026-11-02, "Ya, diingatkan"): it is
 * announced while `bolehDilunasi` is above zero, and skipped `RETURN_HELD` only when the whole
 * balance waits — the same membership as the "Lewat jatuh tempo" list (P46,
 * `lewatTempoDiLuarTahanan`). The order mirrors `keadaanPiutang`: settled beats everything, a
 * pending report beats a held return, and a running kontrabon still wins over a partly held nota.
 *
 * `teamReportPending` covers the team's two payment-report paths that `daftarPiutang` cannot see —
 * a PENDING `CollectionSubmission` or a PENDING `StoreSettlement` — for as long as they still exist
 * beside the BKM. Someone who reported through them has reported all the same.
 */
export function overdueSkipReason(input: {
  row: Pick<MoneyState, "keadaan" | "outstanding" | "bolehDilunasi" | "adaKontrabon"> | undefined;
  teamReportPending: boolean;
}): OverdueSkipReason | null {
  const { row } = input;
  if (!row) return "NOT_LISTED";
  if (row.outstanding <= 0) return "SETTLED";
  const byState = skipForMoneyState(row.keadaan);
  if (byState === "SETTLED") return byState;
  if (input.teamReportPending) return "PAYMENT_REPORT_PENDING";
  if (row.keadaan === "tertahan") return row.adaKontrabon ? "KONTRABON" : (row.bolehDilunasi ?? 0) > 0 ? null : "RETURN_HELD";
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
 * A konsi bill (`Receivable.isConsignment`) goes to the store's holder ONLY, never to the seller
 * (P31): its amounts reach the holder's phone, and only the holder's. A konsi store always has a
 * holder (P47); a legacy one without gets the office row alone.
 *
 * The team's `Receivable.collectorId` is deliberately not read: it is set only from the team's
 * Penagihan screen, which never runs for imported or manual invoices, so a reminder keyed on it
 * reached nobody's phone for most of them.
 */
export function overdueRecipient(r: {
  storeHolderId: string | null;
  sellerId: string | null;
  konsi: boolean;
}): { userId: string; basis: OverdueRecipientBasis } | null {
  const holder = r.storeHolderId || null;
  const seller = r.sellerId || null;
  if (r.konsi) return holder ? { userId: holder, basis: "STORE_HOLDER" } : null;
  if (seller) {
    const userId = penagihPiutang({ penanggungJawabId: holder, penjualId: seller }) ?? seller;
    return { userId, basis: userId === holder ? "STORE_HOLDER" : "SELLER" };
  }
  return holder ? { userId: holder, basis: "STORE_HOLDER" } : null;
}

function dueText(days: number): string {
  return days === 0 ? "jatuh tempo hari ini" : `sudah lewat ${days} hari dari jatuh tempo`;
}

/**
 * How the part of a nota still held by a return deduction is named, by WHY it waits: the warehouse
 * has not counted the return yet, or the count is closed and nobody has been named to bear its
 * shortfall. A deduction whose return note was cancelled or is missing is not here — it is owed,
 * and reminded with the rest.
 */
export const KALIMAT_TAHANAN_PENGINGAT: Record<JenisTahanan, string> = {
  BELUM_DIHITUNG: "lagi menunggu hitungan retur",
  MENUNGGU_BEBAN: "lagi menunggu keputusan selisih retur",
  CAMPURAN: "lagi ditahan potongan retur",
};

/** "; Rp 300.000 lagi menunggu hitungan retur." when part of the nota is held, else ".". */
function heldClause(held: { nilai: number; sebab: JenisTahanan | null } | undefined): string {
  if (!held || !(held.nilai > 0)) return ".";
  return `; ${rupiah.format(held.nilai)} ${KALIMAT_TAHANAN_PENGINGAT[held.sebab ?? "CAMPURAN"]}.`;
}

/**
 * The phone notice's text, addressed to the collector. `outstanding` is the amount being reminded
 * (for a partly held nota, the part outside the hold); `held` names the part that waits and why.
 * Both amounts are always printed: P18 lets the salesman's phone show konsi in full, and P31 holds
 * by recipient instead — a konsi bill reaches only the store's holder (`overdueRecipient`), and a
 * konsi store always has one (P47). The push `data` carries ids and day counts only.
 *
 * `NotificationQueue.body` is VARCHAR(191): the body is fitted with `rangkaiDalamBatas`, dropping
 * the store name to 40 code points and then entirely before it ever loses an amount or the held
 * clause, and "Mohon ditagih." only when it still fits.
 */
export function overduePhoneText(n: {
  docNo: string;
  storeName: string;
  outstanding: number;
  days: number;
  held?: { nilai: number; sebab: JenisTahanan | null };
}): { title: string; body: string } {
  const inti = (nama: string | null) =>
    `Nota ${n.docNo}${nama ? ` di ${nama}` : ""} sebesar ${rupiah.format(n.outstanding)} ${dueText(n.days)}${heldClause(n.held)}`;
  return {
    title: n.days === 0 ? "Tagihan jatuh tempo hari ini" : `Tagihan lewat jatuh tempo ${n.days} hari`,
    body: rangkaiDalamBatas(
      [[inti(n.storeName), inti(capNotificationText(n.storeName, 40)), inti(null)], "Mohon ditagih."],
      NOTIFICATION_TEXT_MAX,
    ),
  };
}

/** The receivables module's view of each id, read in chunks; an id it does not list is absent from the map. */
async function readReceivableStates(ids: string[]): Promise<Map<string, MoneyState>> {
  const byId = new Map<string, MoneyState>();
  for (let i = 0; i < ids.length; i += RECOMPUTE_CHUNK) {
    const rows = await daftarPiutang({ receivableIds: ids.slice(i, i + RECOMPUTE_CHUNK) });
    for (const row of rows) {
      byId.set(row.id, {
        invoiceNo: row.invoiceNo,
        keadaan: row.keadaan,
        outstanding: row.outstanding,
        bolehDilunasi: row.bolehDilunasi,
        adaKontrabon: Boolean(row.alasan.noKontrabon),
        ditahanRetur: row.alasan.ditahanRetur ?? 0,
        sebabDitahan: row.alasan.sebabDitahan ?? null,
      });
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
 *   recomputed from zero (`daftarPiutang`), and a pending payment report or an open kontrabon
 *   skips it, as does a return deduction that holds the WHOLE balance. Both sides have to say
 *   "unpaid", so nobody is ever reminded about an invoice either side considers settled.
 * - The phone notice goes to the store's current holder, else the invoice's seller
 *   (`overdueRecipient`), never to the team's assigned collector; a konsi bill goes to the holder
 *   only (P31).
 * - The amount in the reminder is the recomputed balance, not the stored `outstandingAmount`.
 *
 * Owner decision Q15 (2026-11-02, "Ya, diingatkan"): a nota partly held by a return deduction is
 * reminded for the part OUTSIDE the hold, and the reminder names the waiting part and why it waits
 * (`KALIMAT_TAHANAN_PENGINGAT`). A deduction whose return note was cancelled or is missing is a
 * permanent hold: it is owed, so it is reminded with the rest and never named as waiting. Konsi
 * bills go through `daftarPiutang` like every other bill.
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
      isConsignment: true,
      salesman: { select: { name: true, fcmToken: true } },
      store: {
        select: { name: true, salesmanId: true, salesman: { select: { name: true, fcmToken: true } } },
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

  let announced = 0;
  let partlyHeld = 0;
  let deferred = 0;
  let collectorNotified = 0;
  let unassigned = 0;
  let failed = 0;
  const skipped = Object.fromEntries(OVERDUE_SKIP_REASONS.map((k) => [k, 0])) as Record<OverdueSkipReason, number>;

  for (const { r, days, tStar } of crossings) {
    const state = states.get(r.id);
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
    const recipient = overdueRecipient({ storeHolderId: r.store.salesmanId, sellerId: r.salesmanId, konsi: r.isConsignment });
    const recipientUser = recipient === null ? null : recipient.basis === "STORE_HOLDER" ? r.store.salesman : r.salesman;
    const collectorId = recipient !== null && recipientUser ? recipient.userId : null;
    const collectorName = collectorId ? (recipientUser?.name ?? null) : null;
    if (!collectorId) unassigned++;

    const docNo = state.invoiceNo;
    const outstandingAmount = state.outstanding;
    /*
     * Q15: a partly held nota is reminded for the part outside the hold, and names the waiting part.
     * Both come from `daftarPiutang`'s one split (`pisahTahananRetur`), so the reminder and the
     * screens never differ by a rupiah.
     */
    const amount = state.keadaan === "tertahan" ? (state.bolehDilunasi ?? 0) : state.outstanding;
    const held = state.keadaan === "tertahan" ? (state.ditahanRetur ?? 0) : 0;
    const heldInfo = held > 0 ? { nilai: held, sebab: state.sebabDitahan ?? null } : undefined;
    const heading = days === 0 ? "Piutang jatuh tempo hari ini" : `Piutang jatuh tempo ${days} hari`;
    const collectorRole = recipient?.basis === "SELLER" ? "penjual nota, toko belum punya pemegang" : "pemegang toko";

    /* `AdminNotification.title` is VARCHAR(191); a long store name would otherwise fail this crossing on every run. */
    const title = capNotificationText(
      collectorId ? `${heading} — ${r.store.name}` : `${heading} (belum ada penagih) — ${r.store.name}`,
    );
    const message =
      `Nota ${docNo} sebesar ${rupiah.format(amount)} ${dueText(days)}${heldClause(heldInfo)}` +
      (collectorId
        ? ` Penagih: ${collectorName ?? "-"} (${collectorRole}).`
        : " Belum ada penagih yang bisa dikabari: tetapkan pemegang toko di data toko.");

    /* `storeId` in `data` opens the store's Tagihan screen on the phone (`/pwa/piutang/<storeId>`), konsi bills included. */
    const collectorPayload = {
      ...overduePhoneText({ docNo, storeName: r.store.name, outstanding: amount, days, held: heldInfo }),
      data: { receivableId: r.id, storeId: r.storeId, thresholdDays: String(tStar), daysOverdue: String(days) },
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
       * `outstandingAmount` is the full recomputed balance; `overdueAmount` the amount reminded (the
       * part outside a return hold, Q15) and `heldAmount` the part still waiting (0 when none).
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
            overdueAmount: amount,
            heldAmount: held,
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
    if (held > 0) partlyHeld++;
    announced++;
  }

  return { scanned: receivables.length, announced, partlyHeld, deferred, collectorNotified, unassigned, failed, skipped };
}
