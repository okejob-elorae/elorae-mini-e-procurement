const path = require("node:path");
const { existsSync } = require("node:fs");

const repoRoot = path.resolve(__dirname, "..");
for (const envPath of [
  path.join(repoRoot, "packages", "db", ".env"),
  path.join(repoRoot, "apps", "web", ".env"),
  path.join(repoRoot, ".env"),
]) {
  if (existsSync(envPath)) {
    require("dotenv").config({ path: envPath });
    break;
  }
}

const dbRoot = path.resolve(__dirname, "..", process.env.SMOKE_DB_PACKAGE_ROOT || "packages/db");
const { prisma } = require(path.join(dbRoot, "dist", "src", "index.js"));

async function main() {
  const wos = await prisma.workOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      docNumber: true,
      status: true,
      plannedQty: true,
      notes: true,
      createdAt: true,
      finishedGood: { select: { sku: true } },
    },
  });
  console.log(JSON.stringify({ outbox: await prisma.jubelioOutbox.count(), wos }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
