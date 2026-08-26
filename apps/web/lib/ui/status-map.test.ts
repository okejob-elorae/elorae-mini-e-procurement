import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_MAPS, getStatusMeta, type StatusDomain } from './status-map';

/**
 * The status map is hand-written against Prisma enums, and a mismatch is
 * invisible at runtime: getStatusMeta falls back to a grey "unknown" pill
 * rather than throwing, so a wrong key ships as a quietly wrong label.
 *
 * That is exactly what happened — the work-order map was written with
 * RELEASED and IN_PROGRESS, which do not exist, while ISSUED, IN_PRODUCTION
 * and PARTIAL were missing. Three of six real statuses rendered as "unknown"
 * and nothing failed. This test reads the schema so the two cannot drift again.
 */

const SCHEMA = readFileSync(
  join(__dirname, '../../../../packages/db/prisma/schema.prisma'),
  'utf8',
);

function enumMembers(name: string): string[] {
  const match = SCHEMA.match(new RegExp(`^enum ${name} \\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`enum ${name} not found in schema.prisma`);
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'));
}

const DOMAIN_ENUM: Record<StatusDomain, string> = {
  purchaseOrder: 'POStatus',
  salesOrder: 'SalesOrderStatus',
  fulfillment: 'SalesOrderFulfillmentStatus',
  workOrder: 'WOStatus',
  fieldSales: 'FieldSalesOrderStatus',
  delivery: 'FieldSalesDeliveryStatus',
  taxInvoice: 'TaxInvoiceStatus',
};

describe('status map covers every Prisma enum exactly', () => {
  for (const [domain, enumName] of Object.entries(DOMAIN_ENUM) as [StatusDomain, string][]) {
    it(`${domain} matches ${enumName}`, () => {
      const real = enumMembers(enumName).sort();
      const mapped = Object.keys(STATUS_MAPS[domain]).sort();
      expect(mapped).toEqual(real);
    });
  }
});

describe('getStatusMeta', () => {
  it('falls back to an unremarkable grey pill for an unknown status', () => {
    // Fail soft: a status this map has not caught up with must never crash the
    // list it appears in.
    expect(getStatusMeta('purchaseOrder', 'NOT_A_REAL_STATUS')).toEqual({
      labelKey: 'unknown',
      tone: 'inactive',
    });
  });

  it('falls back for null and undefined', () => {
    expect(getStatusMeta('workOrder', null).labelKey).toBe('unknown');
    expect(getStatusMeta('workOrder', undefined).labelKey).toBe('unknown');
  });
});

describe('every mapped label exists in both locales', () => {
  const locales = ['id', 'en'] as const;
  for (const locale of locales) {
    it(`${locale}.json has every statuses key the map points at`, () => {
      const messages = JSON.parse(
        readFileSync(join(__dirname, `../i18n/messages/${locale}.json`), 'utf8'),
      ) as { statuses?: Record<string, string> };
      const available = new Set(Object.keys(messages.statuses ?? {}));
      const referenced = Object.values(STATUS_MAPS)
        .flatMap((map) => Object.values(map))
        .map((meta) => meta.labelKey);
      const missing = [...new Set(referenced)].filter((key) => !available.has(key));
      expect(missing).toEqual([]);
    });
  }
});
