const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { listCrmLeadsPage } = require("../src/modules/sales/crm-leads/leadQueryService");

/*
 * A Board column's own search box: `_search` keeps the leads with every typed word in their name,
 * number or Enquiry ID - any of the three - and matches symbols as themselves.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCSR-${STAMP}-${name}`;
const created = [];

test.before(async () => {
  for (const [key, name, contactNumber] of [["one", `Searchy Naidu ${STAMP}`, "9000000123"], ["two", `Searchy Kumar ${STAMP}`, "9000000456"]]) {
    created.push(await prisma.salesCrmLead.create({ data: { enquiryId: tag(key), name, contactNumber } }));
  }
});

test.after(async () => {
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { in: created.map((lead) => lead.enquiryId).filter(Boolean) } } });
  await prisma.$disconnect();
});

const found = async (query) => {
  const page = await listCrmLeadsPage({ board: "Dum Dum", filters: { _search: query }, limit: 50, today: "2026-10-29" });
  return (page.rows || page.data || []).map((row) => (row.lead || row).enquiryId).filter((id) => String(id).startsWith(`TCSR-${STAMP}`)).sort();
};

test("every word must match, each in the name, number or Enquiry ID", async () => {
  assert.deepEqual(await found(`searchy ${STAMP}`), [tag("one"), tag("two")]);
  assert.deepEqual(await found(`naidu ${STAMP}`), [tag("one")]);
  assert.deepEqual(await found("0000456"), [tag("two")], "by number");
  assert.deepEqual(await found(tag("one")), [tag("one")], "by Enquiry ID");
  assert.deepEqual(await found(`searchy ${STAMP} 0123`), [tag("one")], "a name word and a number word together");
});

test("symbols are matched as themselves, never as wildcards", async () => {
  assert.deepEqual(await found(`searchy%${STAMP}`), []);
  assert.deepEqual(await found("_000_"), []);
});
