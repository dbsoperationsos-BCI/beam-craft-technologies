"use client";

import Image from "next/image";

/**
 * A submitted CRD document, read back.
 *
 * One renderer for both places a response is read: the studio's own View on the CRD Documents row,
 * and the public link that shares it. They must show the same answers — a response that reads one
 * way in the office and another in the client's inbox is worse than no share link at all — so
 * neither owns the markup.
 *
 * Deliberately not the form. Nothing here is editable, blanks are shown as blank rather than as
 * empty inputs waiting to be filled, and the section a vertical never asked is simply absent.
 */

const compact = (value) => String(value ?? "").trim();
const isFilled = (value) => compact(value) !== "";

/** A date as the studio reads it, from the `YYYY-MM-DD` the form stores. */
function readableDate(value) {
  const raw = compact(value);
  if (!raw) return "";
  const date = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", ...(raw.length > 10 ? { timeStyle: "short" } : {}) }).format(date);
}

function Answer({ label, value, type = "text" }) {
  const shown = type === "date" ? readableDate(value) : compact(value);
  return <div className="min-w-0">
    <dt className="text-[11px] font-semibold text-slate-500 sm:text-xs">{label}</dt>
    {/* An unanswered optional question reads as a dash rather than as a gap, so it is clear the
        question was asked and left blank rather than never asked at all. */}
    <dd className={`mt-1 break-words text-sm ${shown ? "text-slate-900" : "text-slate-400"}`}>{shown || "—"}</dd>
  </div>;
}

function Group({ title, children }) {
  return <section className="border-t border-slate-200 px-4 py-5 first:border-t-0 sm:px-6">
    <h3 className="text-sm font-semibold text-slate-900 sm:text-base">{title}</h3>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2">{children}</dl>
  </section>;
}

/** Pictures the client uploaded, shown as pictures — the point of them is to be looked at. */
function Images({ title, values }) {
  const list = (Array.isArray(values) ? values : []).filter(Boolean);
  if (!list.length) return null;
  return <section className="border-t border-slate-200 px-4 py-5 sm:px-6">
    <h3 className="text-sm font-semibold text-slate-900 sm:text-base">{title}</h3>
    <div className="mt-4 flex flex-wrap gap-3">
      {list.map((source, index) => <a key={`${index}-${String(source).slice(-24)}`} href={source} target="_blank" rel="noreferrer" className="block">
        <Image src={source} alt={`${title} ${index + 1}`} width={96} height={96} unoptimized className="h-24 w-24 rounded-lg border border-slate-200 object-cover transition hover:border-blue-400" />
      </a>)}
    </div>
  </section>;
}

/** Files the client attached, as links — a document is opened, not previewed. */
function Files({ title, values }) {
  const list = (Array.isArray(values) ? values : []).filter((file) => file && (file.url || file.data));
  if (!list.length) return null;
  return <section className="border-t border-slate-200 px-4 py-5 sm:px-6">
    <h3 className="text-sm font-semibold text-slate-900 sm:text-base">{title}</h3>
    <ul className="mt-4 space-y-2">
      {list.map((file, index) => <li key={`${file.name || "file"}-${index}`}>
        {file.url
          ? <a href={file.url} target="_blank" rel="noreferrer" className="break-all text-sm text-blue-700 underline">{file.name || `File ${index + 1}`}</a>
          : <span className="text-sm text-slate-700">{file.name || `File ${index + 1}`}</span>}
      </li>)}
    </ul>
  </section>;
}

/**
 * Reference rows, which the form stores as JSON but older documents stored as one link per line.
 * Both are read here for the same reason the form reads both: a document filled before the change
 * is still somebody's answer.
 */
function referenceRows(value) {
  const raw = compact(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((row) => ({ link: compact(row?.link), remark: compact(row?.remark), image: compact(row?.image) }))
        .filter((row) => row.link || row.remark || row.image);
    }
  } catch {
    // Not JSON: the older one-per-line shape.
  }
  return raw.split(/\n+/).map((link) => ({ link: compact(link), remark: "", image: "" })).filter((row) => row.link);
}

function References({ title, value }) {
  const rows = referenceRows(value);
  if (!rows.length) return null;
  const images = rows.map((row) => row.image).filter(Boolean);
  const remarks = rows.map((row) => row.remark).filter(Boolean);
  const links = rows.map((row) => row.link).filter(Boolean);
  return <section className="border-t border-slate-200 px-4 py-5 sm:px-6">
    <h3 className="text-sm font-semibold text-slate-900 sm:text-base">{title}</h3>
    {links.length > 0 && <ul className="mt-4 space-y-2">
      {rows.filter((row) => row.link).map((row, index) => <li key={`${row.link}-${index}`}>
        <a href={row.link} target="_blank" rel="noreferrer" className="break-all text-sm text-blue-700 underline">{row.link}</a>
        {row.remark && <span className="ml-2 text-sm text-slate-500">— {row.remark}</span>}
      </li>)}
    </ul>}
    {images.length > 0 && <div className="mt-4 flex flex-wrap gap-3">
      {images.map((source, index) => <a key={`${index}-${String(source).slice(-24)}`} href={source} target="_blank" rel="noreferrer">
        <Image src={source} alt={`${title} ${index + 1}`} width={96} height={96} unoptimized className="h-24 w-24 rounded-lg border border-slate-200 object-cover transition hover:border-blue-400" />
      </a>)}
    </div>}
    {!links.length && remarks.length > 0 && <p className="mt-3 text-sm text-slate-700">{remarks.join(" · ")}</p>}
  </section>;
}

/**
 * One side of a Dum Dum document — the same questions asked of the groom and of the bride.
 *
 * No event here any more, and no "also wants help with". Those four were asked of each side, which
 * is two answers to each of four questions about one wedding; they are asked once now, and read
 * under Event Details where the rest of the event already was.
 */
function DumDumSide({ title, side }) {
  const values = side || {};
  const family = (Array.isArray(values.familyDetails) ? values.familyDetails : []).filter((row) => isFilled(row?.name) || isFilled(row?.relationship));
  return <>
    <Group title={title}>
      <Answer label="First Name" value={values.firstName} />
      <Answer label="Nickname" value={values.nickname} />
      <Answer label="Name to be Used In Project" value={values.nameToBeUsedInProject} />
      <Answer label="Insta ID" value={values.instaId} />
      <Answer label="Date Of Birth" value={values.dateOfBirth} type="date" />
      <Answer label="Contact Number" value={values.contactNumber} />
      <Answer label="Street Address" value={values.streetAddress} />
      <Answer label="City" value={values.city} />
      <Answer label="State" value={values.state} />
      <Answer label="Postal / Zip Code" value={values.postalCode} />
    </Group>
    {isFilled(values.photo) && <Images title={`${title} — Photo`} values={[values.photo]} />}
    <Images title={`${title} — Close Family Relatives`} values={values.familyImages} />
    {family.length > 0 && <section className="border-t border-slate-200 px-4 py-5 sm:px-6">
      <h3 className="text-sm font-semibold text-slate-900 sm:text-base">{title} — Family Details</h3>
      <ul className="mt-4 space-y-1.5">
        {family.map((row, index) => <li key={`${row.name}-${index}`} className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">{compact(row.name) || "—"}</span>
          {isFilled(row.relationship) && <span className="text-slate-500"> — {compact(row.relationship)}</span>}
        </li>)}
      </ul>
    </section>}
  </>;
}

function DumDumResponse({ document }) {
  const common = document.common || {};
  const helpWith = (Array.isArray(common.helpWith) ? common.helpWith : []).filter(Boolean);
  return <>
    {/* The order the client filled it in, which is the order it is read back in. */}
    <Group title="Event Details">
      <Answer label="WhatsApp Group Name" value={common.whatsappGroupName} />
      <Answer label="Event Type" value={common.eventType} />
      <Answer label="Referred By" value={common.referredBy} />
      <Answer label="Point of Contact Phone Number" value={common.pointOfContactPhone} />
      <Answer label="Point Of Contact Name" value={common.pointOfContactName} />
      <Answer label="Event Start" value={common.eventStartAt} type="date" />
      <Answer label="Event End" value={common.eventEndAt} type="date" />
      <Answer label="Event Address Link" value={common.eventAddressLink} />
    </Group>
    {helpWith.length > 0 && <section className="border-t border-slate-200 px-4 py-5 sm:px-6">
      <h3 className="text-sm font-semibold text-slate-900 sm:text-base">Also Wants Help With</h3>
      <p className="mt-3 text-sm text-slate-700">{helpWith.join(", ")}</p>
    </section>}
    <DumDumSide title="Groom" side={document.groom} />
    <DumDumSide title="Bride" side={document.bride} />
    <References title="Photo References" value={common.photoReferenceLinks} />
    <References title="Video Reference Links" value={common.videoReferenceLinks} />
    <References title="Other Reference Links" value={common.otherReferenceLinks} />
    <Group title="Terms &amp; Conditions">
      <Answer label="Agreed" value={common.termsAccepted === true ? "Yes" : "No"} />
    </Group>
  </>;
}

// Which Birthdays questions a Qua Qua document asked depends on the Shoot Type answered — the same
// three groupings the form branches into. Mirrors BIRTHDAYS_CATEGORY_BY_SHOOT_TYPE in
// PublicCrdDocumentFormQuaQua.js.
const QQ_BIRTHDAYS_CATEGORY = {
  "Baby Shoot": "baby",
  "Toddler Shoot": "baby",
  "Ear Piercing Ceremony": "baby",
  "Naming Ceremony": "baby",
  "Puberty Function": "baby",
  "Maternity Shoot": "maternity",
  "Baby Shower": "maternity",
  "Combo Packages": "combo",
  "Other": "combo",
};

function QuaQuaResponse({ document }) {
  const category = QQ_BIRTHDAYS_CATEGORY[compact(document.shootType)] || "";
  return <>
    <Group title="Identification">
      <Answer label="WhatsApp Group Name" value={document.whatsappGroupName} />
      <Answer label="Name" value={document.firstName} />
      <Answer label="Phone Number" value={document.phoneNumber} />
      <Answer label="Shoot Type" value={document.shootType} />
      <Answer label="Branch" value={document.branch} />
      <Answer label="Referred By" value={document.referredBy} />
    </Group>
    <Group title="Birthdays">
      {category === "baby" && <>
        <Answer label="Baby Name" value={document.babyName} />
        <Answer label="Baby Date of Birth" value={document.babyDateOfBirth} type="date" />
      </>}
      <Answer label="Mother's Name" value={document.motherName} />
      <Answer label={category === "baby" ? "Mother's Birthday" : "Mother Date of Birth"} value={document.motherDateOfBirth} type="date" />
      <Answer label="Father's Name" value={document.fatherName} />
      <Answer label="Father's Birthday" value={document.fatherBirthday} type="date" />
      {category === "maternity" && <Answer label="Expected Delivery Date" value={document.expectedDeliveryDate} type="date" />}
      {category === "combo" && <Answer label="Child Birthday / Expected Delivery Date" value={document.childBirthdayOrExpectedDeliveryDate} type="date" />}
    </Group>
    <Group title="References">
      <Answer label="Any Special Notes?" value={document.specialNotes} />
      <Answer label="Add References (link)" value={document.referenceLink} />
    </Group>
    <Files title="Uploaded References" values={document.referenceFiles} />
    <References title="Photo References" value={document.photoReferenceLinks} />
    <References title="Video Reference Links" value={document.videoReferenceLinks} />
    <References title="Other Reference Links" value={document.otherReferenceLinks} />
    <Group title="Terms &amp; Conditions">
      <Answer label="Agreed" value={document.termsAccepted === true ? "Yes" : "No"} />
    </Group>
  </>;
}

export default function CrdDocumentResponse({ response }) {
  if (!response?.document) return <p className="px-4 py-6 text-sm text-slate-500 sm:px-6">There is nothing to show for this document yet.</p>;
  // Qua Qua is the one vertical with a shape of its own; everything else reads as Dum Dum's, which
  // is the same fallback the server applies when a document's vertical is unresolved.
  return response.vertical === "QQ"
    ? <QuaQuaResponse document={response.document} />
    : <DumDumResponse document={response.document} />;
}
