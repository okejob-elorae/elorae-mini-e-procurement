/**
 * Teardown-filter guard for the DB specs.
 *
 * Those specs run against the SHARED MariaDB test bed on :3308, which also holds
 * real development data. Prisma DROPS an `undefined` filter term, so a teardown
 * written as `deleteMany({ where: { itemId } })` collapses to `deleteMany({})`
 * and wipes the whole table whenever the fixture hook threw before assigning
 * that id — a unique-code collision, a connection blip, a hook timeout.
 *
 * Every id that reaches a spec teardown filter goes through this. All ids in the
 * schema are cuids, so the empty string can never match a row: an unset id
 * yields a filter that deletes nothing instead of everything.
 *
 * Fixture variables should also be declared as `let x = ""` and reset to `""` at
 * the top of their hook, so "unset" is an unmatchable value rather than
 * `undefined`. This function is the second net, for when that slips.
 */
export function seededId(id: string | undefined): string {
  return id ?? "";
}
