/**
 * Every branch value the studio actually holds, and whether it names a real branch.
 *
 * Read-only, and safe to run against production: it issues `SELECT` and nothing else. It exists
 * because the free-text branch columns cannot be turned into foreign keys until somebody can see
 * what is in them - "Erode" and "Erode TN" are the same branch written two ways, and a backfill
 * matching on name alone would leave one of them behind without saying so.
 *
 * The CRM's own `branch` is deliberately absent: it holds the vertical (Dum Dum, Qua Qua, Corp),
 * not a branch, and is being renamed rather than converted.
 *
 *   node scripts/auditBranchValues.js
 */
const prisma = require("../src/config/db");

/** `[table, column]` - the free-text branch columns, named rather than discovered, so a new one is a deliberate addition. */
const COLUMNS = [
  ["sales_project", "source_branch"],
  ["sales_quotation", "source_branch"],
  ["sales_crm_lead", "assigned_branch"],
  ["payment_request", "branch"],
  ["cash_entry", "branch"],
  ["sales_whatsapp_group_name", "branch"],
  ["sales_google_sheet_link", "branch"],
];

const norm = (value) => String(value ?? "").trim().toLowerCase();

async function main() {
  const locations = await prisma.branch.findMany({ select: { id: true, name: true, code: true } });
  const byName = new Map(locations.map((l) => [norm(l.name), l]));

  console.log(`\nBranches on record: ${locations.map((l) => l.name).join(", ")}\n`);

  let unmatchedTotal = 0;
  for (const [table, column] of COLUMNS) {
    let rows;
    try {
      // Identifiers are from the fixed list above, never from input.
      rows = await prisma.$queryRawUnsafe(
        `SELECT \`${column}\` AS value, COUNT(*) AS n FROM \`${table}\` GROUP BY \`${column}\` ORDER BY n DESC`,
      );
    } catch (error) {
      console.log(`${table}.${column}  — skipped (${error.message.split("\n")[0]})`);
      continue;
    }

    console.log(`${table}.${column}`);
    if (!rows.length) { console.log("   (no rows)\n"); continue; }

    for (const row of rows) {
      const count = Number(row.n);
      const raw = row.value;
      if (raw === null || String(raw).trim() === "") { console.log(`   ${String(count).padStart(6)}  (blank)`); continue; }
      const hit = byName.get(norm(raw));
      if (hit) {
        console.log(`   ${String(count).padStart(6)}  ${String(raw).padEnd(28)} -> location ${hit.id} (${hit.name})`);
      } else {
        // The near-misses are the whole point: these are what an alias has to be decided for.
        const near = locations.filter((l) => norm(l.name).startsWith(norm(raw)) || norm(raw).startsWith(norm(l.name)));
        const hint = near.length ? `  did you mean: ${near.map((l) => `${l.name} (${l.id})`).join(", ")}` : "  no candidate";
        console.log(`   ${String(count).padStart(6)}  ${String(raw).padEnd(28)} -> UNMATCHED${hint}`);
        unmatchedTotal += count;
      }
    }
    console.log("");
  }

  console.log(unmatchedTotal
    ? `${unmatchedTotal} row(s) carry a branch that names no location. Each needs an alias or a correction before the column can be made a foreign key.`
    : "Every branch value names a real location. The backfill can match on name alone.");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
