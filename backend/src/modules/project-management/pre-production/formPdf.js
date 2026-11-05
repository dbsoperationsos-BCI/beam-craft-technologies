const { getBrowser } = require("../../../services/quotationPdfService");
const { escapeHtml } = require("../../../services/emailTemplates");
const clientPreProduction = require("../../client/portal/preProduction");

/*
 * A shoot's whole pre production form as a PDF, for the team's Download beside Save: every section
 * and question of the form, in its order, with the answer as it stands - whoever gave it - and the
 * names of the files the client uploaded. Read-only, from the database; the form itself is not
 * involved, so unsaved edits on screen are not in it.
 */
const day = (value) => {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
};
const clock = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return "";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
};

function answerHtml(field) {
  const value = field.value;
  if (field.type === "files") {
    if (field.notAvailable) return "The client does not have these";
    return value.length ? value.map((file) => escapeHtml(file.name || "File")).join("<br>") : "";
  }
  if (field.type === "concepts") {
    return value.map((row, index) => `<div class="concept"><b>Concept ${index + 1}</b>${row.reference ? `<br>${escapeHtml(row.reference)}` : ""}${row.remarks ? `<br>${escapeHtml(row.remarks)}` : ""}</div>`).join("");
  }
  if (field.type === "yesno") return value === true ? "Yes" : value === false ? "No" : "";
  if (field.type === "date") return escapeHtml(day(value));
  if (field.type === "time") return escapeHtml(clock(value));
  return value ? escapeHtml(String(value)).replace(/\n/g, "<br>") : "";
}

function formHtml({ form, shoot, project }) {
  const facts = [
    ["Event ID", project.eventId],
    ["Client", project.whatsappGroupName],
    ["Client Number", project.clientMainNumber],
    ["Shoot ID", shoot.shootId],
    ["Shoot", shoot.shoot],
    ["Shoot Date", day(form.date)],
    ["Shoot Place", shoot.shootPlace],
  ].filter(([, value]) => value);
  const sections = form.sections.map((section) => {
    const rows = section.fields
      .filter((field) => !field.when || form.sections.flatMap((s) => s.fields).find((f) => f.name === field.when)?.value === true)
      .map((field) => `<tr><th>${escapeHtml(field.label)}</th><td>${answerHtml(field) || '<span class="empty">Not filled</span>'}</td></tr>`).join("");
    return `<h2>${escapeHtml(section.title)}</h2><table>${rows}</table>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1f2b28; font-size: 11px; }
    h1 { font-size: 18px; margin: 0 0 4px; } .sub { color: #6b7280; margin-bottom: 14px; }
    h2 { font-size: 13px; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #d1d5db; }
    table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 5px 6px; border-bottom: 1px solid #eef0f2; }
    th { width: 38%; color: #4b5563; font-weight: 600; } .empty { color: #9ca3af; } .concept { margin-bottom: 6px; }
    .facts th { width: 22%; }
  </style></head><body>
    <h1>Pre Production - ${escapeHtml(shoot.shoot)}</h1>
    <div class="sub">${escapeHtml([project.eventId, shoot.shootId].filter(Boolean).join(" · "))}</div>
    <table class="facts">${facts.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`).join("")}</table>
    ${sections}
  </body></html>`;
}

/** The PDF and the name to save it under, or null when there is no such shoot. */
async function renderFormPdf(shootId) {
  const found = await clientPreProduction.formOfShoot(shootId);
  if (!found) return null;
  const instance = await getBrowser();
  const page = await instance.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setContent(formHtml(found), { waitUntil: "load", timeout: 30_000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    const fileName = `Pre Production - ${found.project.eventId || ""} - ${found.shoot.shoot}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
    return { pdf, fileName };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { renderFormPdf, formHtml };
