"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { compressImageFile } from "@/lib/imageCompression";
import { shootOptions } from "@/components/project-management/AddShootDialog";
import ComboBoxField from "@/components/shared/ComboBoxField";
import DateField from "@/components/shared/DateField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import HelpTip from "@/components/shared/HelpTip";
import ImageUploadField from "@/components/shared/ImageUploadField";
import PhoneField from "@/components/shared/PhoneField";
import MultiSelectField from "@/components/shared/MultiSelectField";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import SharedTextField from "@/components/shared/TextField";
import CloseIcon from "@/components/ui/CloseIcon";
import { savePublicCrdDocument, submitPublicCrdDocument } from "@/services/sales/public-crd-document.service";
import { CrdDocumentFooter, CrdDocumentHeader, CrdEventsFields, CrdFooterButton, CrdSectionRail, CrdTermsAgreement, FILL_MANDATORY, Field, holdRail, railHeld, scrollToFirstMissing, sectionInView, Notice, PublicLayout, SectionHeading, digitsOnly, filled as sharedFilled, mergeSavedDocument, validHttpUrl } from "./crdDocumentShared";

/**
 * The Dum Dum Customer Identification Document, as the client fills it in from the link Sales sends.
 *
 * The event is described once at the top, then the same set of questions is asked of each side under
 * the Groom and Bride tabs — one link, both sides. The two sides are rarely the same person and
 * rarely at the same desk, so the document saves as it goes and is submitted once at the end; the
 * progress bar tracks the whole document rather than the tab on screen, which is what tells whoever
 * opens the link second how much is left.
 *
 * ── Event Details is the studio's half, and it is read-only ───────────────────────────────────
 *
 * Everything under Event Details — the group name, the event type, who to contact, when the event
 * is, where it is, and what else the studio can help with — is what Sales already knows about the
 * booking. It is prefilled from the project and the lead it came from, and the client is shown it
 * rather than asked it: this document is where somebody identifies *themselves*, not where they
 * tell the studio when its own shoot is. Every control there carries `readOnly`, which is this
 * application's own word for a value being read back: one grey tone, no chevron pointing at a list
 * that cannot open, and the value still selectable so a number or a link can be copied.
 *
 * Two consequences worth being plain about, because both are deliberate:
 *
 *   * The event was asked of **each side** and is now asked once. One wedding has one start, one
 *     end and one venue; asking the groom and the bride separately produced two answers to each with
 *     nothing to say which was right.
 *   * **Nothing in this section is required to submit.** A field the form will not let anybody type
 *     in cannot be a field that blocks submission — a document whose prefill came up short would
 *     otherwise be unsubmittable by the client *and* by the studio, with no screen anywhere that
 *     could fix it. What the client must still answer is both sides in full and the terms, which is
 *     everything the document exists to collect.
 */

// The extra services the studio can quote for. Kept beside the form because this is the only place
// that asks, and the list is a sales question rather than project master data.
const helpWithOptions = [
  "Branding",
  "Bridal Styling",
  "Personal Shopping",
  "Choreography",
  "Design & Decor",
  "Entertainment",
  "Event Timeline",
  "Favors & Gifts",
  "Honeymoon Packages & Bookings",
  "On the Day Planning & Co-ordination",
  "Out of Town Wedding Guests",
  "Permissions & Licenses",
  "Proposal Planning",
  "Security & Valet",
  "Transportation",
  "Wedding Gift Registries",
  "Wedding Insurance",
  "Wedding Invites",
  "Wedding Menu Planning",
  "Wedding Venue & Locations",
  "Wedding Websites",
  // Spelled as the studio's own design has them, which is also how the app spells "Al Feature"
  // elsewhere. Left alone rather than corrected — these are the labels the client is meant to read.
  "Wedding Lip Dum - With Choreographer",
  "Zimmy Zip Crane",
  "LED TV / Wall",
  "Al Feature",
  "Live Streaming",
  "Stage Management Team",
  "DJ",
  "Welcome Toys",
  "Other",
];

const sides = [
  { id: "groom", label: "Groom" },
  { id: "bride", label: "Bride" },
];

/*
 * Mirrors REQUIRED_COMMON / REQUIRED_SIDE in backend/src/modules/sales/crd-documents/document.js.
 * The server is what decides; this copy is what moves the progress bar as the client types, so the
 * two lists must be kept in step.
 *
 * `requiredCommon` is empty, and that is the list rather than a gap in it: every text field on the
 * common block is now inside the read-only Event Details section, and a field nobody can type in
 * must not be one that blocks submission. The terms are the exception below - a checkbox the client
 * ticks themselves.
 */
const requiredCommon = [];
// Ticked rather than filled in, so it cannot go through the same emptiness test as the text fields.
const requiredCommonChecked = ["termsAccepted"];
const requiredSide = ["firstName", "nameToBeUsedInProject", "instaId", "dateOfBirth", "photo", "contactNumber", "streetAddress", "city", "state", "postalCode"];

// No event on a side: one wedding has one start, one end and one venue, so they are asked once on
// the common block below. A document saved under the old shape is lifted onto it by the server.
const emptySide = { firstName: "", nickname: "", nameToBeUsedInProject: "", instaId: "", dateOfBirth: "", photo: "", contactNumber: "", streetAddress: "", city: "", state: "", postalCode: "", familyImages: [], familyDetails: [] };
const emptyCommon = { eventId: "", whatsappGroupName: "", eventType: "", pointOfContactName: "", pointOfContactPhone: "", referredBy: "", eventStartAt: "", eventEndAt: "", eventAddressLink: "", events: [], helpWith: [], photoReferenceLinks: "", videoReferenceLinks: "", otherReferenceLinks: "", termsAccepted: false };
const emptyDocument = { common: emptyCommon, groom: { ...emptySide }, bride: { ...emptySide } };

const filled = sharedFilled;

const MAX_FAMILY_IMAGES = 10;
const MAX_FAMILY_MEMBERS = 20;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 100;

function missingRequired(document) {
  const missing = [];
  requiredCommon.forEach((field) => { if (!filled(document.common?.[field])) missing.push(`common.${field}`); });
  requiredCommonChecked.forEach((field) => { if (document.common?.[field] !== true) missing.push(`common.${field}`); });
  sides.forEach(({ id }) => {
    requiredSide.forEach((field) => { if (!filled(document[id]?.[field])) missing.push(`${id}.${field}`); });
  });
  return missing;
}

function parseReferenceRows(value, { allowImages = false } = {}) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        link: compactReferenceValue(item?.link),
        remark: compactReferenceValue(item?.remark),
        image: allowImages ? compactReferenceValue(item?.image) : "",
      })).filter((item) => item.link || item.remark || item.image);
    }
  } catch {
    // Older documents stored one pasted link per line. Keep them editable as rows.
  }
  return String(value).split(/\n+/).map((link) => ({ link: compactReferenceValue(link), remark: "", image: "" })).filter((item) => item.link);
}

function compactReferenceValue(value) {
  return String(value ?? "").trim();
}

function stringifyReferenceRows(rows, { allowImages = false } = {}) {
  const clean = rows.map((row) => ({
    link: compactReferenceValue(row.link),
    remark: compactReferenceValue(row.remark),
    image: allowImages ? compactReferenceValue(row.image) : "",
  })).filter((row) => row.link || row.remark || row.image);
  return clean.length ? JSON.stringify(clean) : "";
}

function referenceFieldsWithInvalidLinks(common) {
  return [
    ["photoReferenceLinks", true],
    ["videoReferenceLinks", false],
    ["otherReferenceLinks", false],
  ].filter(([field, allowImages]) => parseReferenceRows(common?.[field], { allowImages }).some((row) => row.link && !validHttpUrl(row.link))).map(([field]) => field);
}

function referenceRowsForEdit(value, options) {
  const rows = parseReferenceRows(value, options);
  return rows.length ? [...rows, { link: "", remark: "", image: "" }] : [{ link: "", remark: "", image: "" }];
}

function PhotoReferenceImages({ value, onChange }) {
  const rows = parseReferenceRows(value, { allowImages: true });
  const images = rows.map((row) => row.image).filter(Boolean);
  const remark = rows.find((row) => row.remark)?.remark || "";
  const inputId = useId();
  const [error, setError] = useState("");

  function commit(nextImages, nextRemark = remark) {
    onChange(stringifyReferenceRows(nextImages.map((image, index) => ({ link: "", image, remark: index === 0 ? nextRemark : "" })), { allowImages: true }));
  }

  async function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const room = MAX_REFERENCE_IMAGES - images.length;
    if (room <= 0) {
      setError(`Up to ${MAX_REFERENCE_IMAGES} images.`);
      return;
    }
    setError("");
    const added = (await Promise.all(files.slice(0, room).map((file) => compressImageFile(file).then((result) => result.dataUrl).catch(() => null)))).filter(Boolean);
    if (!added.length) {
      setError("Unable to compress the selected image.");
      return;
    }
    if (added.length) commit([...images, ...added]);
  }

  return <div className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <span>Photo Reference Links<HelpTip text="Add photos in a style you like, so the team sees what you want." /></span>
    <div className="mt-1.5 flex flex-wrap items-center gap-3">
      {images.map((source, index) => <div key={`${index}-${String(source).slice(-24)}`} className="relative">
        <Image src={source} alt={`Photo reference ${index + 1}`} width={80} height={80} unoptimized className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
        <button
          type="button"
          aria-label={`Remove photo reference ${index + 1}`}
          onClick={() => commit(images.filter((_, imageIndex) => imageIndex !== index))}
          className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-red-50 hover:text-red-600"
        >
          ×
        </button>
      </div>)}
      {images.length < MAX_REFERENCE_IMAGES && <label htmlFor={inputId} className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-[11px] font-normal text-slate-500 hover:border-blue-400 hover:text-blue-700">
        <span className="text-lg leading-none">+</span>
        <span className="mt-1">Add photo</span>
      </label>}
      <input id={inputId} type="file" multiple accept=".avif,.gif,.jpeg,.jpg,.png,.webp" onChange={(event) => void addFiles(event)} className="sr-only" />
    </div>
    {error && <p className="mt-1.5 font-normal text-red-600">{error}</p>}
    <label className="mt-3 block max-w-xl text-[11px] font-semibold text-slate-600 sm:text-xs">
      <span>Remarks<HelpTip text="What you like about these photos, for the team to follow." /></span>
      <textarea
        value={remark}
        onChange={(event) => commit(images, event.target.value)}
        rows={4}
        placeholder="Remarks for photo references"
        className="mt-1.5 block min-h-28 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
      <span className="mt-1.5 block font-normal text-slate-500">Add remarks for photo references.</span>
    </label>
  </div>;
}

function ReferenceLinks({ label, helperText = "", value, onChange }) {
  const rows = referenceRowsForEdit(value, { allowImages: false });
  const hasInvalidLink = rows.some((row) => row.link && !validHttpUrl(row.link));

  function commit(nextRows) {
    onChange(stringifyReferenceRows(nextRows, { allowImages: false }));
  }

  function update(index, field, nextValue) {
    const nextRows = rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: nextValue } : row);
    commit(nextRows);
  }

  function removeRow(index) {
    commit(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  return <div className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span>{label}<HelpTip text={`${helperText ? `${helperText} ` : ""}Add a link with a remark. A new row appears automatically.`} /></span>
    </div>
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="hidden border-b border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-600 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem]">
        <span>Link</span>
        <span>Remark</span>
        <span />
      </div>
      {rows.map((row, index) => {
        const invalidLink = row.link && !validHttpUrl(row.link);
        const isBlankRow = index === rows.length - 1 && !row.link && !row.remark && !row.image;
        return <div key={`${index}-${row.image || ""}`} className="grid gap-2 border-b border-slate-200 px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] sm:items-start">
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-slate-600 sm:hidden">Link</span>
            <input
              type="url"
              value={row.link}
              onChange={(event) => update(index, "link", event.target.value)}
              placeholder="https://..."
              className={`block min-h-10 w-full rounded-md border bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${invalidLink ? "border-rose-400 focus:border-rose-500 focus:ring-rose-100" : "border-slate-300"}`}
            />
            {invalidLink && <p className="mt-1 text-[11px] font-normal text-red-600">Enter a working http or https link.</p>}
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-slate-600 sm:hidden">Remark</span>
            <input
              type="text"
              value={row.remark}
              onChange={(event) => update(index, "remark", event.target.value)}
              placeholder="Remark for this reference"
              className="block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex justify-end">
            {!isBlankRow && <button
              type="button"
              aria-label={`Remove ${label} row ${index + 1}`}
              onClick={() => removeRow(index)}
              className="inline-flex min-h-10 w-10 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            >
              <CloseIcon className="h-4 w-4" />
            </button>}
          </div>
        </div>;
      })}
    </div>
    {hasInvalidLink && <p role="alert" className="mt-1.5 font-normal text-red-600">Only working http or https links are accepted.</p>}
  </div>;
}

/*
 * What a close relative is to the client.
 *
 * Its own list rather than the `relationshipOptions` the CRM and the quotation share: those answer
 * a different question - how the person enquiring relates to the couple, which is why Self, Bride,
 * Wedding Planner and Event Manager are on it - and none of those is something a family member is
 * to them. This is the immediate family, and anything outside it is typed instead.
 */
const FAMILY_RELATIONSHIPS = ["Father", "Mother", "Brother", "Sister", "Son", "Daughter", "Husband", "Wife", "Other"];

/**
 * Name and relationship, one row at a time.
 *
 * There is always a row to type into, and the last row carries **+ Add Member** rather than a
 * remove control — a row that is being filled in is not one you want to delete. Adding is refused
 * until the row on screen has both answers, so the list cannot grow a trail of blanks. Nothing needs
 * to be "committed": every keystroke is already in the document, so a client who fills the last row
 * and moves on has lost nothing by never pressing the button.
 *
 * The relationship is picked from a list or typed. A list keeps the common answers spelled one way
 * rather than as fifteen versions of "brother in law"; being able to type is what stops the field
 * refusing a family this list's author did not think of, which on a form the client fills alone is
 * the difference between a right answer and the nearest wrong one.
 */
function FamilyDetails({ rows, onChange, disabled }) {
  // The field always shows a row even before one has been stored, so there is somewhere to start.
  const list = rows.length ? rows : [{ name: "", relationship: "" }];
  const lastIndex = list.length - 1;
  const rowComplete = (row) => filled(row?.name) && filled(row?.relationship);

  function update(index, field, value) {
    onChange(list.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function removeRow(index) {
    const next = list.filter((_, rowIndex) => rowIndex !== index);
    onChange(next.length ? next : [{ name: "", relationship: "" }]);
  }

  const canAdd = rowComplete(list[lastIndex]) && list.length < MAX_FAMILY_MEMBERS;

  return <div>
    <span className="block text-[11px] font-semibold text-slate-600 sm:text-xs">Family Details<HelpTip text="Each family member's name and how they are related to you." /></span>
    <div className="mt-1.5 space-y-2">
      {/*
        * The last column is a stated width rather than `auto`.
        *
        * Every row but the last carries a 36px ×, and the last carries **+ Add Member** at about
        * 120px. Sized to their contents, the two rows divided the remaining space differently, so
        * Name and Relationship started and ended at different places on each line and the block read
        * as though it were misaligned - which it was. One width for the column means one grid for
        * every row.
        */}
      {list.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
        {/* `!mt-0` because the label is empty: the field still reserves the 6px that sits under a
            label it does not have, which left it a step below the relationship box beside it. */}
        <SharedTextField label="" inputClassName="!mt-0" aria-label={`Family member ${index + 1} name`} value={row.name || ""} placeholder="Name" onChange={(event) => update(index, "name", event.target.value)} />
        <ComboBoxField hideLabel ariaLabel={`Family member ${index + 1} relationship`} value={row.relationship || ""} placeholder="Relationship" options={FAMILY_RELATIONSHIPS} onChange={(value) => update(index, "relationship", value)} />
        {index === lastIndex ? (
          <button
            type="button"
            disabled={disabled || !canAdd}
            title={canAdd ? undefined : "Enter a name and relationship first"}
            onClick={() => onChange([...list, { name: "", relationship: "" }])}
            className="min-h-11 whitespace-nowrap rounded-md border border-blue-300 bg-blue-50 px-3 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 sm:text-xs"
          >
            + Add Member
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove family member ${index + 1}`}
            onClick={() => removeRow(index)}
            className="inline-flex min-h-9 w-9 shrink-0 items-center justify-center justify-self-start rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        )}
      </div>)}
    </div>
  </div>;
}

/**
 * Relatives' photographs, shown as thumbnails rather than a list of file names — the point of these
 * is to be looked at, so "Image 3" tells the client nothing about whether they picked the right one.
 */
function FamilyImages({ values, onChange, disabled }) {
  const inputId = useId();
  const [error, setError] = useState("");

  async function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    const room = MAX_FAMILY_IMAGES - values.length;
    if (room <= 0) {
      setError(`Up to ${MAX_FAMILY_IMAGES} photos.`);
      return;
    }
    if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
      setError("Each photo must be 5 MB or smaller.");
      return;
    }

    setError("");
    // Compressed in the browser, exactly as every other image field in the app does it, so what
    // travels is already small.
    const added = (await Promise.all(files.slice(0, room).map((file) => compressImageFile(file).then((result) => result.dataUrl).catch(() => null)))).filter(Boolean);
    if (added.length) onChange([...values, ...added]);
  }

  return <div className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <span>Close Family Relatives Images<HelpTip text="Photos of close family, so the team can recognise them at the event." /></span>
    <div className="mt-1.5 flex flex-wrap items-center gap-3">
      {values.map((source, index) => <div key={`${index}-${String(source).slice(-24)}`} className="relative">
        <Image src={source} alt={`Family relative ${index + 1}`} width={80} height={80} unoptimized className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
        <button
          type="button"
          disabled={disabled}
          aria-label={`Remove family relative photo ${index + 1}`}
          onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
          className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
        >
          ×
        </button>
      </div>)}
      {values.length < MAX_FAMILY_IMAGES && <label htmlFor={inputId} className={`flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-[11px] font-normal text-slate-500 hover:border-blue-400 hover:text-blue-700 ${disabled ? "pointer-events-none opacity-60" : ""}`}>
        <span className="text-lg leading-none">+</span>
        <span className="mt-1">Add photo</span>
      </label>}
      <input id={inputId} type="file" multiple accept=".avif,.gif,.jpeg,.jpg,.png,.webp" disabled={disabled} onChange={(event) => void addFiles(event)} className="sr-only" />
    </div>
    {error && <p className="mt-1.5 font-normal text-red-600">{error}</p>}
  </div>;
}

function SideFields({ label, values, onChange, showErrors }) {
  // Held here rather than on the document, so a rejected file — too large, wrong format — is
  // reported instead of the picker appearing to do nothing, without that message ever being sent.
  const [photoError, setPhotoError] = useState("");
  const set = (field) => (value) => onChange({ ...values, [field]: value });
  const invalid = (field) => showErrors && requiredSide.includes(field) && !filled(values[field]);

  return <div className="space-y-8">
    <section>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="First Name" required value={values.firstName} onChange={set("firstName")} invalid={invalid("firstName")} helperText="Your first name as it should appear in our records." />

        <Field label="Nickname" value={values.nickname} onChange={set("nickname")} helperText="This will be used in Designs and Wherever Required in the Project." />
        <Field label="Name to be Used In Project" required value={values.nameToBeUsedInProject} onChange={set("nameToBeUsedInProject")} invalid={invalid("nameToBeUsedInProject")} helperText="This will be used in Designs and Wherever Required In The Project." />
        <Field label="Insta ID" required value={values.instaId} onChange={set("instaId")} invalid={invalid("instaId")} helperText="This will be used for Tagging Purpose." />
        {/* `restriction="future"` disables days after today — nobody was born tomorrow. */}
        <DateField label="Date Of Birth" required restriction="future" helperText="Your date of birth; days after today cannot be chosen." value={values.dateOfBirth} onChange={set("dateOfBirth")} error={invalid("dateOfBirth") ? "Date Of Birth is required." : ""} />
        {/* The shared picker, so the country code is chosen rather than typed. */}
        <PhoneField
          label="Contact Number"
          helperText="A number the studio can reach you on about the shoot. WhatsApp is preferable."
          field="contactNumber"
          required
          value={values.contactNumber}
          onChange={(_field, value) => set("contactNumber")(value)}
          error={invalid("contactNumber") ? "Contact Number is required." : ""}
        />
        <div className="md:col-span-2">
          <ImageUploadField
            label="Upload Your Photo/Selfie"
            required
            helperText="A clear, recent photo of you for the studio's team."
            value={values.photo || null}
            onChange={(value, error) => { setPhotoError(error || ""); set("photo")(value || ""); }}
            error={photoError || (invalid("photo") ? "A photo is required." : "")}
          />
        </div>
      </div>
    </section>

    <section>
      <SectionHeading title="Shipping Address" />
      <div className="grid gap-4 md:grid-cols-2">
        <Field className="md:col-span-2" label="Street Address" required value={values.streetAddress} onChange={set("streetAddress")} invalid={invalid("streetAddress")} helperText="House, street and area where anything from the studio is shipped." />
        <Field label="City" required value={values.city} onChange={set("city")} invalid={invalid("city")} helperText="The city of your shipping address." />
        <Field label="State" required value={values.state} onChange={set("state")} invalid={invalid("state")} helperText="The state of your shipping address." />
        <Field label="Postal / Zip Code" required inputMode="numeric" maxLength={10} value={values.postalCode} onChange={(value) => set("postalCode")(digitsOnly(value, 10))} invalid={invalid("postalCode")} helperText="Digits only, up to 10, for your shipping address." />
      </div>
    </section>

    {/* Family is the last of a side. The Event section that used to follow it has gone: it asked the
        groom and the bride the same four questions about one event and stored two answers to each,
        so it is asked once under Event Details instead. */}
    <section>
      <SectionHeading title="Family" />
      <div className="grid gap-5">
        <FamilyImages values={values.familyImages || []} onChange={set("familyImages")} />
        <FamilyDetails rows={values.familyDetails || []} onChange={set("familyDetails")} />
      </div>
    </section>
  </div>;
}

/** `initialContext` is the already-fetched `GET /crd-documents/:token` response — the parent shell
 *  fetches once, learns the vertical, and hands the result down instead of fetching twice. */
export default function PublicCrdDocumentFormDumDum({ token, initialContext }) {
  const [document, setDocument] = useState(() => ({ ...emptyDocument, ...(initialContext?.document || {}) }));
  /*
   * Which of the two event dates are the studio's answer rather than the client's.
   *
   * The server says so - `prefilledCommonFields` - and it is the only thing that can. Once the
   * client types a date and it saves, their answer is on the document and looks exactly like one
   * the studio knew, so a form reading "is this box filled" would hand the field over on the way in
   * and take it back on their next visit, with their own answer locked inside it. Reading the live
   * value is worse still: the field would lock on the first character they typed.
   *
   * Held from the first render and never recomputed, so a save cannot change it mid-session.
   */
  const [eventDatesFromStudio] = useState(() => {
    const prefilled = new Set(initialContext?.prefilledCommonFields || []);
    return { eventStartAt: prefilled.has("eventStartAt"), eventEndAt: prefilled.has("eventEndAt") };
  });
  const [activeSection, setActiveSection] = useState("event-details");
  // The project's shoots, as events; none on a document raised before its project had any.
  const hasEvents = (document.common.events || []).length > 0;
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(initialContext?.submittedAt));
  const [showErrors, setShowErrors] = useState(false);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  // What was last written to the server, as JSON — seeded from what was just loaded, which is what
  // stops the first render from saving a document nobody has touched yet.
  const lastSavedRef = useRef(JSON.stringify({ ...emptyDocument, ...(initialContext?.document || {}) }));
  const documentRef = useRef(null);

  const missing = useMemo(() => missingRequired(document), [document]);
  const total = requiredCommon.length + requiredCommonChecked.length + requiredSide.length * sides.length;
  const completion = total === 0 ? 100 : Math.round(((total - missing.length) / total) * 100);
  const documentJson = useMemo(() => JSON.stringify(document), [document]);

  const setCommon = (field) => (value) => setDocument((current) => ({ ...current, common: { ...current.common, [field]: value } }));
  const setSide = (side) => (values) => setDocument((current) => ({ ...current, [side]: values }));
  // A section picked on the rail holds its highlight while the form scrolls to it.
  const railHold = useRef({ picking: false, timer: null });
  const updateActiveSectionFromScroll = () => {
    if (railHeld(railHold.current)) return;
    const current = sectionInView(documentRef.current, schemaSections.map(([id]) => id));
    if (current && current !== activeSection) setActiveSection(current);
  };
  const selectSection = (sectionId) => {
    setActiveSection(sectionId);
    holdRail(railHold.current);
    documentRef.current?.querySelector(`#${CSS.escape(sectionId)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  /**
   * Writes the document to the server. `announce` is for the explicit button; the background save
   * stays quiet, because a snackbar every time someone stops typing is noise rather than news.
   */
  const saveDocument = useCallback(async (current, { announce = false } = {}) => {
    if (referenceFieldsWithInvalidLinks(current.common).length) {
      if (announce) showError("Please fix the reference links before saving. Only working http or https links are accepted.");
      return;
    }
    setSaving(true);
    try {
      const response = await savePublicCrdDocument(token, current);
      // The server hands back what it stored — image links in place of the data the browser sent —
      // so the form keeps working from stored links rather than re-uploading on the next save.
      const stored = response?.data?.document ? { ...emptyDocument, ...response.data.document } : current;
      // What is on screen is kept where the server only trimmed it (`mergeSavedDocument`), and is
      // counted as saved, so the next autosave is not set off by a space the server will trim again.
      lastSavedRef.current = JSON.stringify(mergeSavedDocument(current, current, stored));
      setDocument((latest) => mergeSavedDocument(latest, current, stored));
      setSavedAt(new Date());
      if (announce) showSuccess("Saved. You can close this page and pick up from the same link.");
    } catch (error) {
      showError(error.message || "We couldn't save just now. Your answers are still here — we'll try again as you carry on.");
    } finally {
      setSaving(false);
    }
  }, [showError, showSuccess, token]);

  /**
   * Saves on its own a moment after typing stops, so a half-filled document is never lost to a
   * closed tab. Compared against what was last written rather than against a dirty flag, so the save
   * coming back — with its image links swapped in for the uploaded data — is not immediately
   * mistaken for another change and saved again.
   */
  useEffect(() => {
    if (saving || submitting || submitted) return undefined;
    if (documentJson === lastSavedRef.current) return undefined;
    const timer = window.setTimeout(() => { void saveDocument(document); }, 1200);
    return () => window.clearTimeout(timer);
  }, [document, documentJson, saveDocument, saving, submitted, submitting]);

  async function submit(event) {
    event.preventDefault();
    const invalidReferenceFields = referenceFieldsWithInvalidLinks(document.common);
    if (invalidReferenceFields.length) {
      setActiveSection("reference-links");
      window.setTimeout(() => {
        documentRef.current?.querySelector("#reference-links")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 0);
      showNotice("Please fix the reference links before submitting. Only working http or https links are accepted.", "error");
      return;
    }
    if (missing.length) {
      setShowErrors(true);
      // Move to whichever side still has something outstanding, so the marked fields are on screen.
      const firstMissing = missing[0] || "";
      const firstMissingSide = sides.find(({ id }) => firstMissing.startsWith(`${id}.`));
      /*
       * Where to send them. Only two places can be outstanding now - one of the two sides, or the
       * terms - because Event Details is read-only and requires nothing. The terms are the fallback
       * rather than Event Details, which would have scrolled somebody to a section with nothing on
       * it they could act on.
       */
      const targetId = firstMissingSide ? `${firstMissingSide.id}-details` : "terms-conditions";
      setActiveSection(targetId);
      // Straight to the first field marked red, rather than the top of its section.
      scrollToFirstMissing(documentRef.current);
      showNotice(FILL_MANDATORY, "error");
      return;
    }
    setSubmitting(true);
    try {
      await submitPublicCrdDocument(token, document);
      setSubmitted(true);
    } catch (error) {
      setShowErrors(true);
      showError(error.message || "We couldn't submit this document. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) return <PublicLayout><Notice title="Thank you — your document has been submitted." tone="green">Our team has received your details and will be in touch. You can close this page.</Notice></PublicLayout>;

  const schemaSections = [
    ["event-details", "Event Details"],
    ["groom-details", "Groom Details"],
    ["bride-details", "Bride Details"],
    ["reference-links", "Reference photos and Links"],
    ["terms-conditions", "Terms & Conditions"],
  ];
  const termsInvalid = showErrors && document.common?.termsAccepted !== true;

  return <PublicLayout>
    <CrdDocumentHeader title="Customer Identification Document" eventId={initialContext?.eventId} logoUrl={initialContext?.logoUrl} />

    <FloatingNotice notice={notice} onClose={clearNotice} />

    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <CrdSectionRail sections={schemaSections} activeId={activeSection} onSelect={selectSection} />
        <main ref={documentRef} onScroll={updateActiveSectionFromScroll} className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
          <SchemaFormSection id="event-details" title="Event Details">
            {/*
              The studio's half of the document, shown rather than asked.

              Every control carries its own `readOnly` rather than the section being wrapped in a
              `disabled` fieldset, and the difference is what a reader sees. A fieldset disables:
              controls that style themselves off `:disabled` went grey and the ones that do not -
              the phone field, whose wrapper hardcodes a white fill around a transparent input -
              stayed white in a row of grey boxes; and every chevron stayed drawn, pointing at a
              list that could no longer be opened.

              `readOnly` is the application's own word for this - see `Dropdown`,
              `MultiSelectField` and `TextField` - and it means the same thing in each: one grey
              read-back tone, no chevron, no refused cursor. It also leaves the values selectable,
              which is most of what somebody does with a phone number or a maps link they are being
              shown.

              There is no explanatory line above these fields. The greyed boxes say they are not
              being asked for, the section they sit under says what they are, and a paragraph
              repeating that was the only sentence on this document addressed to the reader about
              the form rather than about their wedding.
            */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Which booking this form is for, in the studio's own words, beside the name the
                  studio calls it by. The two answer the same question - "which shoot is this?" -
                  one exactly and one readably, so they share a line rather than stacking into two
                  full-width boxes that pushed everything the client is actually asked further
                  down. Read-only like the rest of the block: what Sales knows, shown to be
                  checked. */}
              <Field label="Event ID" readOnly value={document.common.eventId} onChange={setCommon("eventId")} helperText="The studio's reference for this booking, shown for checking." />
              <Field label="WhatsApp Group Name" readOnly value={document.common.whatsappGroupName} onChange={setCommon("whatsappGroupName")} helperText="The name of this booking's WhatsApp group, shown for checking." />
              {/* The same control the studio sees, so the two views of this document read alike -
                  inert here, and without the chevron that would open a list nobody can choose from. */}
              <ComboBoxField
                label="Event Type"
                readOnly
                helperText="The kind of shoot booked, as the studio recorded it."
                value={document.common.eventType}
                onChange={(value) => setCommon("eventType")(value)}
                options={shootOptions}
              />
              <Field label="Referred By" readOnly value={document.common.referredBy} onChange={setCommon("referredBy")} helperText="Who referred you to the studio, as recorded at booking." />
              {/* The event itself, asked once. It used to be four questions on each of the Groom
                  and Bride tabs, which is two answers to each of them about one wedding.
                  Each date is read-back where the studio has answered it and the client's to fill
                  in where it has not - a booking taken before the venue was settled leaves these
                  blank, and the client is the one who can say. Decided from the document as it
                  loaded, never from the live value: see `eventDatesFromStudio`. */}
              {/* With shoots on the project, each is its own event below; a document with none
                  (raised before the project) asks the one event here, as it always did. */}
              {!hasEvents && <DateField label="Event Start Date & Time" helperText="When your event begins; the studio may have filled it in." withTime readOnly={eventDatesFromStudio.eventStartAt} placeholder="Select date and time" value={document.common.eventStartAt} onChange={setCommon("eventStartAt")} />}
              {!hasEvents && <DateField label="Event End Date & Time" helperText="When your event ends; the studio may have filled it in." withTime readOnly={eventDatesFromStudio.eventEndAt} placeholder="Select date and time" value={document.common.eventEndAt} onChange={setCommon("eventEndAt")} />}
              {/* The point of contact is the client's to give, not the studio's to state.
                  Prefilled from the lead where there is one, and editable either way: the person
                  the studio should call about this wedding is exactly the sort of thing the booking
                  gets wrong, and the client is the one who knows. */}
              <PhoneField
                label="Point of Contact Phone Number"
                helperText="The number the studio should call about this event."
                field="pointOfContactPhone"
                value={document.common.pointOfContactPhone}
                onChange={(_field, value) => setCommon("pointOfContactPhone")(value)}
              />
              <Field label="Point Of Contact Name" value={document.common.pointOfContactName} onChange={setCommon("pointOfContactName")} helperText="The person the studio should speak to about this event." />
              {/* The venue's map link, which the studio very often does not have and the client
                  always does. */}
              {!hasEvents && <Field className="md:col-span-2" label="Event Address Link" type="url" value={document.common.eventAddressLink} onChange={setCommon("eventAddressLink")} helperText="A Google Maps link to the venue." />}
              <MultiSelectField
                className="md:col-span-2"
                label="Help us to know what other things we can help you with?"
                helperText="Other services you would like the studio's help with."
                readOnly
                options={helpWithOptions}
                values={document.common.helpWith || []}
                onChange={setCommon("helpWith")}
                placeholder="Select anything you would like help with"
              />
            </div>
            {/* One event per shoot of the project, each with its own dates and venue. */}
            {hasEvents && <div className="mt-6"><CrdEventsFields events={document.common.events} onChange={setCommon("events")} /></div>}
          </SchemaFormSection>

          <SchemaFormSection id="groom-details" title="Groom Details">
            <SideFields label="Groom" values={document.groom} onChange={setSide("groom")} showErrors={showErrors} />
          </SchemaFormSection>

          <SchemaFormSection id="bride-details" title="Bride Details">
            <SideFields label="Bride" values={document.bride} onChange={setSide("bride")} showErrors={showErrors} />
          </SchemaFormSection>

          <SchemaFormSection id="reference-links" title="Reference photos and Links">
            <div className="grid gap-5">
              <PhotoReferenceImages value={document.common.photoReferenceLinks} onChange={setCommon("photoReferenceLinks")} />
              <ReferenceLinks label="Video Reference Links" helperText="Links to videos in a style you like, each with a short note." value={document.common.videoReferenceLinks} onChange={setCommon("videoReferenceLinks")} />
              <ReferenceLinks label="Other Reference Links" helperText="Any other links that show what you want, each with a short note." value={document.common.otherReferenceLinks} onChange={setCommon("otherReferenceLinks")} />
            </div>
          </SchemaFormSection>

          <SchemaFormSection id="terms-conditions" title="Terms & Conditions">
            {/* Scrolls inside its own box rather than making the page long — the same shape the
                onboarding policy agreement uses. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 shadow-inner sm:h-72 sm:overflow-y-auto sm:p-5">
              <p className="whitespace-pre-line">{initialContext?.termsText}</p>
            </div>
            <CrdTermsAgreement checked={document.common.termsAccepted === true} onChange={setCommon("termsAccepted")} invalid={termsInvalid} />
          </SchemaFormSection>
        </main>
      </div>

      <CrdDocumentFooter completion={completion}>
        <CrdFooterButton type="button" variant="secondary" disabled={saving || submitting} onClick={() => void saveDocument(document, { announce: true })}>
          {saving ? "Saving…" : "Save Draft"}
        </CrdFooterButton>
        <CrdFooterButton type="submit" variant="primary" disabled={saving || submitting}>
          {submitting ? "Submitting…" : "Submit document"}
        </CrdFooterButton>
      </CrdDocumentFooter>
    </form>
  </PublicLayout>;
}
