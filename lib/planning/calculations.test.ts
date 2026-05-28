import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkMonthlyMismatch,
  getActualQty,
  getAllMonthlyTargets,
  getCompletionBand,
  getCompletionPercent,
  getEffectiveTarget,
  getMonthlyTarget,
  sumMonthlyTargets,
  validateChildShares,
  type PlanActualsPrismaClient,
  type PlanningCategoryNode,
  type PlanningMonthlyRow,
} from './calculations';

function makeMonthlyOverrides(overrides: Array<Partial<PlanningMonthlyRow> & { month: number }>) {
  return overrides.map((row) => ({
    month: row.month,
    targetQty: row.targetQty ?? null,
    isManualOverride: row.isManualOverride ?? false,
  }));
}

describe('planning calculations', () => {
  it('computes effective target for parent and child', () => {
    const parent: PlanningCategoryNode = {
      id: 'parent',
      parentId: null,
      targetQty: 54000,
      parentSharePercent: null,
      itemId: null,
    };
    const child: PlanningCategoryNode = {
      id: 'child',
      parentId: 'parent',
      targetQty: null,
      parentSharePercent: '50',
      itemId: 'fg-1',
      parent,
    };

    assert.equal(getEffectiveTarget(parent), 54000);
    assert.equal(getEffectiveTarget(child), 27000);
  });

  it('handles null parent target and rounding share', () => {
    const parent: PlanningCategoryNode = {
      id: 'parent',
      parentId: null,
      targetQty: null,
      parentSharePercent: null,
      itemId: null,
    };
    const child: PlanningCategoryNode = {
      id: 'child',
      parentId: 'parent',
      targetQty: null,
      parentSharePercent: 33.33,
      itemId: null,
      parent: { targetQty: 10000 },
    };
    assert.equal(getEffectiveTarget(parent), 0);
    assert.equal(getEffectiveTarget(child), 3333);
  });

  it('splits monthly target evenly with remainder to earliest months', () => {
    const monthlyRows: PlanningMonthlyRow[] = [];
    assert.equal(getMonthlyTarget(100, 1, monthlyRows), 9);
    assert.equal(getMonthlyTarget(100, 2, monthlyRows), 9);
    assert.equal(getMonthlyTarget(100, 5, monthlyRows), 8);
    assert.equal(getMonthlyTarget(100, 12, monthlyRows), 8);
    assert.equal(sumMonthlyTargets(100, monthlyRows), 100);
  });

  it('splits 10000 with remainder across months', () => {
    const monthlyRows: PlanningMonthlyRow[] = [];
    assert.equal(getMonthlyTarget(10000, 1, monthlyRows), 834);
    assert.equal(getMonthlyTarget(10000, 5, monthlyRows), 833);
    assert.equal(sumMonthlyTargets(10000, monthlyRows), 10000);
  });

  it('uses manual override and redistributes remaining months', () => {
    const monthlyRows = makeMonthlyOverrides([
      { month: 1, targetQty: 20, isManualOverride: true },
      { month: 2, targetQty: 10, isManualOverride: true },
    ]);

    assert.equal(getMonthlyTarget(120, 1, monthlyRows), 20);
    assert.equal(getMonthlyTarget(120, 2, monthlyRows), 10);
    assert.equal(getMonthlyTarget(120, 3, monthlyRows), 9);
    assert.equal(getMonthlyTarget(120, 12, monthlyRows), 9);
    assert.equal(sumMonthlyTargets(120, monthlyRows), 120);
  });

  it('supports manual total mismatch without forcing effective target', () => {
    const monthlyRows = makeMonthlyOverrides(
      Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        targetQty: 100,
        isManualOverride: true,
      }))
    );
    assert.equal(sumMonthlyTargets(800, monthlyRows), 1200);
  });

  it('getAllMonthlyTargets returns 12 entries', () => {
    const rows = getAllMonthlyTargets(12000, []);
    assert.equal(rows.length, 12);
    assert.equal(rows.reduce((s, r) => s + r.targetQty, 0), 12000);
  });

  it('checkMonthlyMismatch detects override drift', () => {
    const noMismatch = checkMonthlyMismatch(27000, []);
    assert.equal(noMismatch.hasMismatch, false);
    assert.equal(noMismatch.monthlySum, 27000);

    const allManual = makeMonthlyOverrides(
      Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        targetQty: 100,
        isManualOverride: true,
      }))
    );
    const withOverride = checkMonthlyMismatch(800, allManual);
    assert.equal(withOverride.hasMismatch, true);
    assert.equal(withOverride.monthlySum, 1200);
  });

  it('validateChildShares enforces 100% cap', () => {
    assert.deepEqual(validateChildShares([50, 30, 20]), {
      valid: true,
      totalPercent: 100,
      remaining: 0,
    });
    assert.deepEqual(validateChildShares([50, 30]), {
      valid: true,
      totalPercent: 80,
      remaining: 20,
    });
    assert.equal(validateChildShares([60, 50]).valid, false);
    assert.deepEqual(validateChildShares([]), {
      valid: true,
      totalPercent: 0,
      remaining: 100,
    });
    assert.equal(validateChildShares([40], 70).valid, false);
  });

  it('getCompletionPercent and getCompletionBand', () => {
    assert.equal(getCompletionPercent(0, 100), 0);
    assert.equal(getCompletionPercent(50, 100), 50);
    assert.equal(getCompletionBand(0), 'red');
    assert.equal(getCompletionBand(49), 'red');
    assert.equal(getCompletionBand(50), 'yellow');
    assert.equal(getCompletionBand(79), 'yellow');
    assert.equal(getCompletionBand(80), 'green');
    assert.equal(getCompletionBand(150), 'green');
  });

  it('aggregates actuals from children and excludes cancelled work orders', async () => {
    const parent: PlanningCategoryNode = {
      id: 'parent',
      parentId: null,
      targetQty: 1000,
      parentSharePercent: null,
      itemId: 'parent-item',
      children: [
        {
          id: 'child-1',
          parentId: 'parent',
          targetQty: null,
          parentSharePercent: '50',
          itemId: 'fg-1',
        },
        {
          id: 'child-2',
          parentId: 'parent',
          targetQty: null,
          parentSharePercent: '50',
          itemId: 'fg-2',
        },
      ],
    };

    const aggregateCalls: string[] = [];
    const prisma = {
      fGReceipt: {
        aggregate: async (args) => {
          aggregateCalls.push(args.where.wo.finishedGoodId);
          if (args.where.wo.finishedGoodId === 'fg-1') return { _sum: { qtyAccepted: 300 } };
          if (args.where.wo.finishedGoodId === 'fg-2') return { _sum: { qtyAccepted: 150 } };
          return { _sum: { qtyAccepted: 9999 } };
        },
      },
    } satisfies PlanActualsPrismaClient;

    const total = await getActualQty(prisma, parent, 2026);
    assert.equal(total, 450);
    assert.deepEqual(aggregateCalls.sort(), ['fg-1', 'fg-2']);
  });

  it('returns 0 actual when leaf has no itemId', async () => {
    const leaf: PlanningCategoryNode = {
      id: 'leaf',
      parentId: null,
      targetQty: 1,
      parentSharePercent: null,
      itemId: null,
    };

    const prisma = {
      fGReceipt: {
        aggregate: async () => {
          throw new Error('should not be called for null item');
        },
      },
    } as unknown as PlanActualsPrismaClient;

    const total = await getActualQty(prisma, leaf, 2026);
    assert.equal(total, 0);
  });
});
