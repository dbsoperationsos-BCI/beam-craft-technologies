const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const prisma = require("../src/config/db");
const dataScope = require("../src/services/dataScope.service");
const transcripts = require("../src/modules/sales/call-transcripts/repository");
const controller = require("../src/modules/sales/crm-leads/controller");

/*
 * Whose leads a request reaches is asked about the board's own permission, `SALES / CRM Leads`,
 * whatever finer guard the route stacked after it - delete, select-all and import overwrite
 * `req.permission` - and at the level the request acts at.
 */

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "controller.js"), "utf8");

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const realResolve = dataScope.resolve;
const realFindById = transcripts.findById;
after(async () => {
  dataScope.resolve = realResolve;
  transcripts.findById = realFindById;
  await prisma.$disconnect();
});

async function askedWith(method) {
  const calls = [];
  dataScope.resolve = async (options) => { calls.push(options); return { unlimited: false, allows: () => false }; };
  const req = {
    method,
    user: { id: 1 },
    // What a finer guard leaves behind it - not the permission the leads are granted by.
    permission: { module: "SALES", feature: "CRM Lead Deletion" },
    params: { id: "no-such-lead" },
  };
  await controller.getOne(req, fakeRes());
  dataScope.resolve = realResolve;
  return calls;
}

test("lead reach is always asked about SALES / CRM Leads, never the finer guard's permission", async () => {
  const [options] = await askedWith("GET");
  assert.equal(options.module, "SALES");
  assert.equal(options.feature, "CRM Leads");
  assert.doesNotMatch(SOURCE, /req\.permission\.(module|feature)/, "the controller reads the scope from req.permission again");
});

test("a read is scoped at READ and a write at READ_WRITE", async () => {
  assert.equal((await askedWith("GET"))[0].level, "READ");
  assert.equal((await askedWith("HEAD"))[0].level, "READ");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal((await askedWith(method))[0].level, "READ_WRITE", method);
  }
});

test("a transcript is reached only through a lead in scope", async () => {
  transcripts.findById = async (id) => ({ id, enquiryId: null, suggestions: null, appliedFields: null, segments: [] });
  const res = fakeRes();
  await controller.transcriptDetail({ method: "GET", user: { id: 1 }, params: { transcriptId: "t-1" } }, res);
  assert.equal(res.statusCode, 404, "a transcript on no lead - an interview call - is not the CRM's to show");
  transcripts.findById = realFindById;

  const body = SOURCE.slice(SOURCE.indexOf("async function transcriptDetail("));
  assert.match(body.slice(0, 900), /scopedLead\(req, row\.enquiryId\)/);
});
