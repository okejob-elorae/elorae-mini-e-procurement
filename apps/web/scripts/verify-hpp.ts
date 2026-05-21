/**
 * Verify HPP calculation for the client test case (Article 2700001).
 * Run after seed: npm run db:seed && npx tsx scripts/verify-hpp.ts
 * Requires DATABASE_URL (set in .env or shell). Load dotenv first so lib/prisma gets it.
 */
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Set it in .env or run with: DATABASE_URL="mysql://..." npx tsx scripts/verify-hpp.ts');
  process.exit(1);
}

const WO_DOC_NUMBER = 'WO/2026/HPP01';
const EXPECTED_FABRIC = 59_200;
const EXPECTED_ACCESSORIES = 10_050;
const EXPECTED_SERVICE = 26_750;
const EXPECTED_SUBTOTAL = 96_000;
const EXPECTED_SELLING = 195_000;
const EXPECTED_MARGIN_PERCENT = 100;
const EXPECTED_ADDITIONAL = 3_000;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('Assertion failed:', message);
    process.exit(1);
  }
}

async function main() {
  const { prisma } = await import('../lib/prisma');
  const { calculateHPP } = await import('../app/actions/hpp');

  const wo = await prisma.workOrder.findFirst({
    where: { docNumber: WO_DOC_NUMBER },
    select: { id: true },
  });
  if (!wo) {
    console.error('HPP test WO not found. Run: npm run db:seed');
    process.exit(1);
  }

  const breakdown = await calculateHPP(wo.id);

  assert(
    Math.abs(breakdown.fabricCostPerPcs - EXPECTED_FABRIC) < 1,
    `Fabric cost/pcs: expected ${EXPECTED_FABRIC}, got ${breakdown.fabricCostPerPcs}`,
  );
  assert(
    Math.abs(breakdown.accessoriesCostPerPcs - EXPECTED_ACCESSORIES) < 1,
    `Accessories cost/pcs: expected ${EXPECTED_ACCESSORIES}, got ${breakdown.accessoriesCostPerPcs}`,
  );
  assert(
    Math.abs(breakdown.serviceCostPerPcs - EXPECTED_SERVICE) < 1,
    `Service cost/pcs: expected ${EXPECTED_SERVICE}, got ${breakdown.serviceCostPerPcs}`,
  );
  assert(
    Math.abs(breakdown.subtotal - EXPECTED_SUBTOTAL) < 1,
    `Subtotal: expected ${EXPECTED_SUBTOTAL}, got ${breakdown.subtotal}`,
  );
  assert(breakdown.hasMixedPPN === true, 'Expected hasMixedPPN true');
  assert(
    breakdown.marginPercent != null && Math.abs(breakdown.marginPercent - EXPECTED_MARGIN_PERCENT) < 0.01,
    `Margin %: expected ${EXPECTED_MARGIN_PERCENT}, got ${breakdown.marginPercent}`,
  );
  assert(
    breakdown.additionalCost != null && Math.abs(breakdown.additionalCost - EXPECTED_ADDITIONAL) < 1,
    `Additional cost: expected ${EXPECTED_ADDITIONAL}, got ${breakdown.additionalCost}`,
  );
  assert(
    breakdown.sellingPrice != null && Math.abs(breakdown.sellingPrice - EXPECTED_SELLING) < 1,
    `Selling price: expected ${EXPECTED_SELLING}, got ${breakdown.sellingPrice}`,
  );

  const kancingLine = breakdown.lines.find((l) => l.category === 'ACCESSORIES' && (l.itemName === 'Kancing' || l.itemName?.includes('Kancing')));
  const jahitLine = breakdown.lines.find((l) => l.category === 'SERVICE' && l.itemName?.includes('Jahit'));
  if (kancingLine) assert(kancingLine.ppnIncluded === false, 'Kancing should have ppnIncluded false');
  if (jahitLine) assert(jahitLine.ppnIncluded === false, 'Jahit step should have ppnIncluded false');

  console.log('HPP verification passed:', breakdown.woDocNumber, 'HPP/pcs', breakdown.subtotal, 'Selling', breakdown.sellingPrice);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('../lib/prisma');
    await prisma.$disconnect();
  });
