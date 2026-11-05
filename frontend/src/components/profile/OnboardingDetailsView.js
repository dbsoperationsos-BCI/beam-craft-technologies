"use client";

import SimpleTable from "@/components/data-table/SimpleTable";

import { fieldLabels, onboardingFormSections } from "@/constants/onboardingFormConfig";

/**
 * The record somebody filled in when they joined, read back to them.
 *
 * Drawn from `onboardingFormSections` — the very list the onboarding form itself is drawn from —
 * rather than from a second copy of the fields. A field added to that form appears here the same
 * day; a field renamed there is renamed here. The alternative is two lists that agree until the
 * first time somebody edits one of them.
 *
 * ── Read, not a form ──
 *
 * Stated as label-over-value, not as disabled text boxes. The page used to draw eleven read-only
 * `TextField`s, which asks somebody to look at a row of input boxes they cannot type in and work
 * out that none of them are for typing in. Nothing here is editable — the record is HR's to
 * change — so nothing here pretends to be.
 *
 * ── Empty answers are left out ──
 *
 * A fact nobody gave is not shown at all, rather than shown as an empty box. That is also what
 * handles the fields the form only asks some people: an unmarried employee simply has no spouse
 * row, without this needing to know the rule that decides it.
 */

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/** The lists the form collects as rows, each read back as its own small table. */
const LIST_COLUMNS = {
  qualifications: [["degree", "Degree"], ["branch", "Branch"], ["college", "College"], ["passedOutYear", "Passed Out"]],
  experiences: [["companyName", "Company"], ["companyLocation", "Location"], ["role", "Role"], ["years", "Years"], ["attachmentName", "Letter"]],
  children: [["name", "Name"], ["dateOfBirth", "Date of Birth"]],
};

/**
 * The identity proofs, each read as one fact rather than two.
 *
 * The form asks for the numbers first and the photographs after, because that is the order they
 * are easiest to type in - but "Aadhar Card Number" in one corner and "Aadhar Card Photo" three
 * fields away is a document split in half on the page. Paired here: the number on the left, the
 * photograph of that same card on its right.
 */
const DOCUMENT_PAIRS = { aadharCardNumber: "aadharCardImage", panCardNumber: "panCardImage" };
const PAIRED_IMAGES = new Set(Object.values(DOCUMENT_PAIRS));

/** The onboarding form's own name for a field, so nothing here writes a label a second time. */
const labelOf = (name) => fieldLabels[name] || name;

/** The two fields the form collects as tick-lists, stored joined by ", ". */
const CHIP_FIELDS = new Set(["skills", "languagesKnown"]);

function Chips({ value }) {
  const items = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{item}</span>
      ))}
    </div>
  );
}

function ListTable({ name, rows }) {
  const columns = LIST_COLUMNS[name] || [];
  return (
    // Its own scroller, so a wide list never makes the page scroll sideways at 360px.
    <SimpleTable
      variant="form"
      classNames={{ wrapper: "mt-1", table: "text-xs sm:text-sm", head: "!font-normal !tracking-normal sm:!text-sm", th: "whitespace-nowrap font-medium", row: "text-slate-700" }}
      columns={columns.map(([key, label]) => ({
        key,
        label,
        render: (row) => (key === "dateOfBirth" ? formatDate(row[key]) : (row[key] === null || row[key] === "" || row[key] === undefined ? "—" : String(row[key]))),
      }))}
      rows={rows}
      rowKey={(_row, index) => index}
    />
  );
}

function DocumentFact({ field, value, image, imageLabel }) {
  return (
    // Its own boxed unit, and never narrower than half a row: a number beside a thumbnail needs
    // the width, and two of them side by side read as the two cards they are.
    <div className="sm:col-span-1 lg:col-span-1">
      <div className="flex h-full items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
        <div className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{field.label}</dt>
          <dd className="mt-0.5 break-words font-mono text-sm tracking-wide text-slate-800">{String(value)}</dd>
        </div>
        {/* The card itself, beside its number. Fixed-width and `shrink-0`, so a long number pushes
            nothing off the row and the two proofs line up down the page. */}
        {image ? (
          <a
            href={image}
            target="_blank"
            rel="noreferrer"
            className="block shrink-0 overflow-hidden rounded-md border border-slate-200 transition hover:border-slate-400"
            title={`Open ${imageLabel}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt={imageLabel} className="h-16 w-24 bg-slate-50 object-contain sm:h-20 sm:w-32" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Fact({ field, value }) {
  const wide = field.colSpan === 2 || field.type === "textarea" || field.type === "custom" || field.type === "image";
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{field.label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">
        {CHIP_FIELDS.has(field.name) ? <Chips value={value} />
            : LIST_COLUMNS[field.name] ? <ListTable name={field.name} rows={value} />
              : field.type === "date" ? formatDate(value)
                : <span className="whitespace-pre-line break-words">{String(value)}</span>}
      </dd>
    </div>
  );
}

/** Has this field an answer worth printing? An empty list is as absent as an empty string. */
function answered(field, value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim() !== "";
}

export default function OnboardingDetailsView({ onboarding }) {
  if (!onboarding) {
    return (
      <p className="mx-auto max-w-3xl rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
        This login has no employee record, so there is no onboarding form behind it.
      </p>
    );
  }

  const sections = onboardingFormSections
    .map((section) => ({
      ...section,
      // The photo is already the largest thing on the page, in the header above this; and the
      // "same as current address" tick is a question the form asked itself, not an answer.
      fields: section.fields
        // The photo is already the largest thing on the page, in the header above this; the "same
        // as current address" tick is a question the form asked itself, not an answer; and the two
        // proof photographs are drawn beside their own numbers rather than as facts of their own.
        .filter((field) => field.name !== "profilePhoto" && field.type !== "checkbox" && !PAIRED_IMAGES.has(field.name))
        .filter((field) => answered(field, onboarding[field.name])),
    }))
    .filter((section) => section.fields.length)
    // A card is wide if anything in it is: an address, one of the three lists, or a tick-list.
    .map((section) => ({
      ...section,
      wide: section.fields.some((field) => field.colSpan === 2 || field.type === "textarea" || field.type === "custom"),
    }));

  if (!sections.length) {
    return (
      <p className="mx-auto max-w-3xl rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
        Nothing has been filled in on your onboarding form yet.
      </p>
    );
  }

  return (
    /* Wider than the 3xl column this started as, and more columns inside each card as it widens.
       A record of forty-odd facts read as one narrow strip down the middle of a 1280px screen with
       most of the page empty on either side - and the narrower the column, the longer the scroll. */
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
      {sections.map((section) => (
        <section
          key={section.id}
          /* A card holding a full-width field - an address, a table, a tick-list - takes the whole
             row; the short ones pair up beside each other. Which is what fills a 1280px screen
             without stretching "Gender: Male" across half of it. */
          className={`rounded-xl border border-slate-200 bg-white p-4 sm:p-5 ${section.wide ? "lg:col-span-2" : ""}`}
        >
          <h3 className="text-sm font-semibold text-slate-800">{section.title}</h3>
          {/* Two columns, never three. The form's fields come in pairs - a nominee's name and
              their phone, a father's name and his occupation - and they are written one after the
              other, so an odd number of columns puts half of a pair at the end of one row and the
              other half at the start of the next. The page is filled by putting the *cards* side
              by side instead; see the grid above. */}
          <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {section.fields.map((field) => (DOCUMENT_PAIRS[field.name] ? (
              <DocumentFact
                key={field.name}
                field={field}
                value={onboarding[field.name]}
                image={onboarding[DOCUMENT_PAIRS[field.name]]}
                imageLabel={labelOf(DOCUMENT_PAIRS[field.name])}
              />
            ) : (
              <Fact key={field.name} field={field} value={onboarding[field.name]} />
            )))}
          </dl>
        </section>
      ))}
      <p className="text-xs text-slate-500 lg:col-span-2">
        Maintained by HR in the Employee Repository — ask HR to correct anything here.
      </p>
    </div>
  );
}
