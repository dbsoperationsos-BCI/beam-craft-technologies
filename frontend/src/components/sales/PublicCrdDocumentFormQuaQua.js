"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateField from "@/components/shared/DateField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import PhoneField from "@/components/shared/PhoneField";
import RadioGroupField from "@/components/shared/RadioGroupField";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import { savePublicCrdDocument, submitPublicCrdDocument } from "@/services/sales/public-crd-document.service";
import {
  CrdDocumentFooter,
  CrdDocumentHeader,
  CrdFooterButton,
  CrdSectionRail,
  Field,
  Notice,
  PhotoReferenceImages,
  PublicLayout,
  ReferenceLinks,
  filled,
  parseReferenceRows,
  validHttpUrl,
  mergeSavedDocument,
  CrdEventsFields,
  CrdTermsAgreement,
  scrollToFirstMissing,
  holdRail,
  railHeld,
  sectionInView,
  FILL_MANDATORY,
} from "./crdDocumentShared";

/**
 * The Qua Qua Customer Identification Document, as the client fills it in from the link Sales sends.
 *
 * Recreates the studio's Jotform CRD for this vertical in two steps. Identification comes first,
 * on its own, because Birthdays cannot be drawn until the Shoot Type it depends on is answered — so
 * it is a locked, "Next"-gated section the way the whole document briefly was. Past that, Birthdays
 * (whose questions depend on the Shoot Type picked in Identification) and References (special notes,
 * uploaded files, one reference link, and the terms & conditions agreement) have no such dependency
 * on each other, so they are one continuous scrollable page — the same shape the Dum Dum document
 * uses throughout — and the left rail scrolls between them rather than switching sections.
 */

// Mirrors SHOOT_TYPE_OPTIONS / BRANCH_OPTIONS / IDENTIFICATION_REQUIRED /
// BIRTHDAYS_REQUIRED_BY_CATEGORY / REFERENCES_REQUIRED_CHECKED / birthdaysCategoryFor in
// backend/src/modules/sales/crd-documents/documentQQ.js. The server is what decides; this copy is
// what renders the choices and moves the progress bar as the client types, so the two must be kept
// in step.
const SHOOT_TYPE_OPTIONS = [
  "Baby Shoot",
  "Toddler Shoot",
  "Ear Piercing Ceremony",
  "Naming Ceremony",
  "Puberty Function",
  "Maternity Shoot",
  "Baby Shower",
  "Combo Packages",
  "Other",
];

const BRANCH_OPTIONS = [
  "Erode, TN",
  "Coimbatore, TN",
  "Tiruppur, TN",
  "Bangalore, KA",
  "Vizag, AP",
  "Hyderabad, TS",
];

const BIRTHDAYS_CATEGORY_BY_SHOOT_TYPE = {
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

function birthdaysCategoryFor(shootType) {
  return BIRTHDAYS_CATEGORY_BY_SHOOT_TYPE[shootType] || "";
}

/*
 * Identification's own required fields. Last Name and Referred By are optional, the same way they
 * are on the Dum Dum document.
 *
 * The WhatsApp Group Name is not among them, and that follows from its being read-only rather than
 * being a judgement about how important it is. It is the studio's name for the booking, prefilled
 * from the project and shown to be checked - the same treatment it has always had on the Dum Dum
 * document - and a field the form will not let anybody type in cannot be a field that blocks
 * submission. A document raised by hand has no project to take a name from, so requiring it would
 * strand that document with no screen anywhere able to fix it.
 */
const IDENTIFICATION_REQUIRED = ["firstName", "phoneNumber", "shootType", "branch"];
const BIRTHDAYS_REQUIRED_BY_CATEGORY = {
  baby: ["babyName", "babyDateOfBirth", "motherName", "motherDateOfBirth", "fatherName", "fatherBirthday"],
  maternity: ["motherName", "motherDateOfBirth", "fatherName", "fatherBirthday", "expectedDeliveryDate"],
  combo: ["motherName", "motherDateOfBirth", "fatherName", "fatherBirthday", "childBirthdayOrExpectedDeliveryDate"],
};
// The one field whose label changes with the category — "Mother's Birthday" for a baby already
// born, "Mother Date of Birth" everywhere else. The Jotform's own wording, reproduced as-is.
const MOTHER_DATE_LABEL_BY_CATEGORY = { baby: "Mother's Birthday", maternity: "Mother Date of Birth", combo: "Mother Date of Birth" };


// Ticked, not filled in — a checkbox is answered by being true, and `false` is a perfectly good
// string, so it cannot go through the same emptiness test as the text fields. Special Notes, the
// uploaded files and the reference link are all optional.
const REFERENCES_REQUIRED_CHECKED = ["termsAccepted"];

const emptyDocument = {
  eventId: "", whatsappGroupName: "", firstName: "", phoneNumber: "", shootType: "", branch: "", referredBy: "",
  babyName: "", babyDateOfBirth: "", motherName: "", motherDateOfBirth: "", fatherName: "", fatherBirthday: "",
  expectedDeliveryDate: "", childBirthdayOrExpectedDeliveryDate: "",
  specialNotes: "", photoReferenceLinks: "", videoReferenceLinks: "", otherReferenceLinks: "",
  referenceFiles: [], referenceLink: "", termsAccepted: false,
  // One per shoot of the project, built by the server (`crd-documents/events.js`).
  events: [],
};

function identificationMissing(document) {
  return IDENTIFICATION_REQUIRED.filter((field) => !filled(document?.[field]));
}

function birthdaysMissing(document) {
  const category = birthdaysCategoryFor(document?.shootType);
  return category ? BIRTHDAYS_REQUIRED_BY_CATEGORY[category].filter((field) => !filled(document?.[field])) : [];
}

function referencesMissing(document) {
  return REFERENCES_REQUIRED_CHECKED.filter((field) => document?.[field] !== true);
}

function missingRequired(document) {
  return [...identificationMissing(document), ...birthdaysMissing(document), ...referencesMissing(document)];
}

function referenceFieldsWithInvalidLinks(document) {
  return [
    ["photoReferenceLinks", true],
    ["videoReferenceLinks", false],
    ["otherReferenceLinks", false],
  ].filter(([field, allowImages]) => parseReferenceRows(document?.[field], { allowImages }).some((row) => row.link && !validHttpUrl(row.link))).map(([field]) => field);
}

const SECTIONS = [
  ["identification", "Identification"],
  ["birthdays", "Birthdays"],
  ["references", "References"],
];

/** Whichever section the client left off at: the first one that still has something outstanding, so
 *  a returning client is not sent back through what they already finished. */
function firstIncompleteSection(document) {
  if (identificationMissing(document).length) return "identification";
  if (birthdaysMissing(document).length) return "birthdays";
  return "references";
}

function IdentificationFields({ document, set, invalid }) {
  return <div className="grid gap-4 md:grid-cols-2">
    {/* Which booking this form is for, in the studio's own words, sharing its line with the name
        the studio calls it by - the same pairing the Dum Dum document opens with, and read-only for
        the same reason: it is what Sales already knows, not something the client is being asked.
        Never required, so it cannot block a submission, and a document raised before its project
        exists shows an empty box rather than a made-up id. */}
    <Field label="Event ID" readOnly value={document.eventId} onChange={set("eventId")} helperText="The studio's reference for this booking, shown for checking." />
    {/* The studio's name for this booking, prefilled from the project and read back rather than
        asked - the same treatment it has on the Dum Dum document. It used to ask the client to type
        the exact name of their WhatsApp group, which made the project's name depend on a stranger
        spelling it the same way Sales had; the project already carries it, so it is shown to be
        checked instead. Read-only means it cannot be required - see `IDENTIFICATION_REQUIRED`. */}
    <Field label="WhatsApp Group Name" readOnly value={document.whatsappGroupName} onChange={set("whatsappGroupName")} helperText="The name of this booking's WhatsApp group, shown for checking." />
    <Field label="Name" required value={document.firstName} onChange={set("firstName")} invalid={invalid("firstName")} helperText="Your name as the studio should address you." />
    {/* The shared picker, so the country code is chosen rather than typed — it stores
        `+<dial code> <national number>`, which is the one shape every phone number in the app is
        held in. */}
    <PhoneField
      label="Phone Number"
      helperText="A number the studio can reach you on about the shoot. WhatsApp is preferable."
      field="phoneNumber"
      required
      value={document.phoneNumber}
      onChange={(_field, value) => set("phoneNumber")(value)}
      error={invalid("phoneNumber") ? "Phone Number is required." : ""}
    />
    <RadioGroupField
      className="md:col-span-2"
      label="Shoot Type"
      required
      helperText="Decides which names and dates the Birthdays step asks for."
      layout="column"
      value={document.shootType}
      onChange={set("shootType")}
      options={SHOOT_TYPE_OPTIONS}
      controlClassName="px-0 py-1"
      error={invalid("shootType") ? "Choose the Shoot Type." : ""}
    />
    <RadioGroupField
      className="md:col-span-2"
      label="Branch"
      required
      helperText="The studio branch your shoot is booked with."
      layout="column"
      value={document.branch}
      onChange={set("branch")}
      options={BRANCH_OPTIONS}
      controlClassName="px-0 py-1"
      error={invalid("branch") ? "Choose the Branch." : ""}
    />
    <Field label="Referred By" value={document.referredBy} onChange={set("referredBy")} helperText="Who told you about the studio, if anyone." />
  </div>;
}

function BirthdaysFields({ document, set, invalid, category }) {
  if (!category) return <p className="text-sm text-slate-500">Pick a Shoot Type in Identification first.</p>;
  const motherDateLabel = MOTHER_DATE_LABEL_BY_CATEGORY[category];
  // `DateField` marks a problem with an error line rather than the red ring `Field` takes, so the
  // same "required and still empty" answer is phrased for it.
  const dateError = (field) => (invalid(field) ? "This date is required." : "");
  return <div className="grid gap-4 md:grid-cols-2">
    {category === "baby" && <>
      <Field label="Baby Name" required value={document.babyName} onChange={set("babyName")} invalid={invalid("babyName")} helperText="Your baby's name as the studio should use it." />
      {/* `restriction="future"` disables days after today: somebody already born cannot have been
          born tomorrow. The delivery date below is the mirror of it. */}
      <DateField label="Baby Date of Birth" required restriction="future" helperText="Your baby's date of birth; days after today cannot be chosen." value={document.babyDateOfBirth} onChange={set("babyDateOfBirth")} error={dateError("babyDateOfBirth")} />
    </>}
    <Field label="Mother's Name" required value={document.motherName} onChange={set("motherName")} invalid={invalid("motherName")} helperText="The mother's name as the studio should use it." />
    <DateField label={motherDateLabel} required restriction="future" helperText="The mother's date of birth; days after today cannot be chosen." value={document.motherDateOfBirth} onChange={set("motherDateOfBirth")} error={dateError("motherDateOfBirth")} />
    <Field label="Father's Name" required value={document.fatherName} onChange={set("fatherName")} invalid={invalid("fatherName")} helperText="The father's name as the studio should use it." />
    <DateField label="Father's Birthday" required restriction="future" helperText="The father's date of birth; days after today cannot be chosen." value={document.fatherBirthday} onChange={set("fatherBirthday")} error={dateError("fatherBirthday")} />
    {category === "maternity" && <DateField label="Expected Delivery Date" required restriction="past" helperText="The date the baby is due; past days cannot be chosen." value={document.expectedDeliveryDate} onChange={set("expectedDeliveryDate")} error={dateError("expectedDeliveryDate")} />}
    {/* Unrestricted on purpose: a Combo or Other booking covers a child already born and one still
        expected, and this one field answers for both. */}
    {category === "combo" && <DateField label="Child Birthday / Expected Delivery Date" required helperText="The child's birthday, or the due date if not yet born." value={document.childBirthdayOrExpectedDeliveryDate} onChange={set("childBirthdayOrExpectedDeliveryDate")} error={dateError("childBirthdayOrExpectedDeliveryDate")} />}
  </div>;
}

function ReferencesFields({ document, set, showErrors, termsText }) {
  const termsInvalid = showErrors && document.termsAccepted !== true;
  return <div className="grid gap-5">
    <Field label="Any Special Notes?" className="max-w-md" value={document.specialNotes} onChange={set("specialNotes")} helperText="Anything the studio should know before your shoot." />

    <PhotoReferenceImages value={document.photoReferenceLinks} onChange={set("photoReferenceLinks")} />
    <ReferenceLinks label="Video Reference Links" helperText="Links to videos in a style you like, each with a short note." value={document.videoReferenceLinks} onChange={set("videoReferenceLinks")} />
    <ReferenceLinks label="Other Reference Links" helperText="Any other links that show what you want, each with a short note." value={document.otherReferenceLinks} onChange={set("otherReferenceLinks")} />

    <div>
      {/* Scrolls inside its own box rather than making the page long — the same shape the
          onboarding policy agreement and the Dum Dum document use. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 shadow-inner sm:h-72 sm:overflow-y-auto sm:p-5">
        <p className="whitespace-pre-line">{termsText}</p>
      </div>
      <CrdTermsAgreement checked={document.termsAccepted === true} onChange={set("termsAccepted")} invalid={termsInvalid} />
    </div>
  </div>;
}

/** `initialContext` is the already-fetched `GET /crd-documents/:token` response — the parent shell
 *  fetches once, learns the vertical, and hands the result down instead of fetching twice. */
export default function PublicCrdDocumentFormQuaQua({ token, initialContext }) {
  const [document, setDocument] = useState(() => ({ ...emptyDocument, ...(initialContext?.document || {}) }));
  const [activeSection, setActiveSection] = useState(() => firstIncompleteSection({ ...emptyDocument, ...(initialContext?.document || {}) }));
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(initialContext?.submittedAt));
  const [showErrors, setShowErrors] = useState(false);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  // What was last written to the server, as JSON — seeded from what was just loaded, which is what
  // stops the first render from saving a document nobody has touched yet.
  const lastSavedRef = useRef(JSON.stringify({ ...emptyDocument, ...(initialContext?.document || {}) }));

  const category = birthdaysCategoryFor(document.shootType);
  const missing = useMemo(() => missingRequired(document), [document]);
  const total = IDENTIFICATION_REQUIRED.length + (category ? BIRTHDAYS_REQUIRED_BY_CATEGORY[category].length : 0) + REFERENCES_REQUIRED_CHECKED.length;
  const completion = total === 0 ? 100 : Math.round(((total - missing.length) / total) * 100);
  const documentJson = useMemo(() => JSON.stringify(document), [document]);

  const set = (field) => (value) => setDocument((current) => ({ ...current, [field]: value }));
  const requiredNow = useMemo(() => [...IDENTIFICATION_REQUIRED, ...(category ? BIRTHDAYS_REQUIRED_BY_CATEGORY[category] : [])], [category]);
  const invalid = (field) => showErrors && requiredNow.includes(field) && !filled(document[field]);

  const identificationDone = identificationMissing(document).length === 0;
  // Birthdays and References are one scrollable page once Identification is done — Identification
  // is the only section that gates the next, the same way a Shoot Type has to be picked before
  // Birthdays knows what to ask.
  const lockedIds = useMemo(() => {
    const locked = new Set();
    if (!identificationDone) { locked.add("birthdays"); locked.add("references"); }
    return locked;
  }, [identificationDone]);
  const mainRef = useRef(null);

  // A section picked on the rail holds its highlight while the form scrolls to it.
  const railHold = useRef({ picking: false, timer: null });

  function scrollToSection(id) {
    holdRail(railHold.current);
    mainRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // Keeps the rail's highlight in step while scrolling through the combined Birthdays/References
  // page — the same threshold the Dum Dum document's own rail uses.
  function updateActiveSectionFromScroll() {
    if (activeSection === "identification" || railHeld(railHold.current)) return;
    const current = sectionInView(mainRef.current, ["birthdays", "references"]);
    if (current && current !== activeSection) setActiveSection(current);
  }

  // A returning client whose first outstanding section is References lands scrolled to it rather
  // than at the top of Birthdays.
  useEffect(() => {
    if (activeSection !== "identification") scrollToSection(activeSection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDocument = useCallback(async (current, { announce = false } = {}) => {
    if (referenceFieldsWithInvalidLinks(current).length) {
      if (announce) showError("Please fix the reference links before saving. Only working http or https links are accepted.");
      return;
    }
    setSaving(true);
    try {
      const response = await savePublicCrdDocument(token, current);
      const stored = response?.data?.document ? { ...emptyDocument, ...response.data.document } : current;
      // What is on screen is kept where the server only trimmed it (`mergeSavedDocument`), and is
      // counted as saved, so the next autosave is not set off by a space the server will trim again.
      lastSavedRef.current = JSON.stringify(mergeSavedDocument(current, current, stored));
      setDocument((latest) => mergeSavedDocument(latest, current, stored));
      if (announce) showSuccess("Saved. You can close this page and pick up from the same link.");
    } catch (error) {
      showError(error.message || "We couldn't save just now. Your answers are still here — we'll try again as you carry on.");
    } finally {
      setSaving(false);
    }
  }, [showError, showSuccess, token]);

  // Saves on its own a moment after typing stops, so a half-filled document is never lost to a
  // closed tab — the same debounced autosave the Dum Dum document uses.
  useEffect(() => {
    if (saving || submitting || submitted) return undefined;
    if (documentJson === lastSavedRef.current) return undefined;
    const timer = window.setTimeout(() => { void saveDocument(document); }, 1200);
    return () => window.clearTimeout(timer);
  }, [document, documentJson, saveDocument, saving, submitted, submitting]);

  function goNext(sectionMissing, nextSection) {
    if (sectionMissing.length) {
      setShowErrors(true);
      showNotice(FILL_MANDATORY, "error");
      scrollToFirstMissing(mainRef.current);
      return;
    }
    setShowErrors(false);
    setActiveSection(nextSection);
  }

  function selectSection(sectionId) {
    if (lockedIds.has(sectionId)) return;
    setShowErrors(false);
    setActiveSection(sectionId);
    if (sectionId !== "identification") window.setTimeout(() => scrollToSection(sectionId), 0);
  }

  async function submit(event) {
    event.preventDefault();
    const invalidRefFields = referenceFieldsWithInvalidLinks(document);
    if (invalidRefFields.length) {
      setShowErrors(true);
      setActiveSection("references");
      window.setTimeout(() => scrollToSection("references"), 0);
      showNotice("Some of the reference links are invalid. Only working http or https links are accepted.", "error");
      return;
    }
    if (missing.length) {
      setShowErrors(true);
      const target = firstIncompleteSection(document);
      setActiveSection(target);
      showNotice(FILL_MANDATORY, "error");
      scrollToFirstMissing(mainRef.current);
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

  return <PublicLayout>
    <CrdDocumentHeader title="QQ - Customer Identification Document" eventId={initialContext?.eventId} logoUrl={initialContext?.logoUrl} />

    <FloatingNotice notice={notice} onClose={clearNotice} />

    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <CrdSectionRail sections={SECTIONS} activeId={activeSection} onSelect={selectSection} lockedIds={lockedIds} />
        <main ref={mainRef} onScroll={updateActiveSectionFromScroll} className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {activeSection === "identification" ? <>
            <SchemaFormSection id="identification" title="Identification">
              <IdentificationFields document={document} set={set} invalid={invalid} />
            </SchemaFormSection>
            {/* One event per shoot of the project - its dates and venue - on the same page. */}
            {(document.events || []).length > 0 && <SchemaFormSection id="events" title="Events">
              <CrdEventsFields events={document.events} onChange={set("events")} />
            </SchemaFormSection>}
          </> : <>
            <SchemaFormSection id="birthdays" title="Don't Miss Special Offers on Your Birthdays">
              <BirthdaysFields document={document} set={set} invalid={invalid} category={category} />
            </SchemaFormSection>

            <SchemaFormSection id="references" title="References">
              <ReferencesFields document={document} set={set} showErrors={showErrors} termsText={initialContext?.termsText} />
            </SchemaFormSection>
          </>}
        </main>
      </div>

      <CrdDocumentFooter completion={completion}>
        {activeSection === "identification" ? <CrdFooterButton type="button" variant="primary" disabled={saving || submitting} onClick={() => goNext(identificationMissing(document), "birthdays")}>
          Next
        </CrdFooterButton> : <>
          <CrdFooterButton type="button" variant="secondary" disabled={saving || submitting} onClick={() => selectSection("identification")}>
            Back
          </CrdFooterButton>
          <CrdFooterButton type="button" variant="secondary" disabled={saving || submitting} onClick={() => void saveDocument(document, { announce: true })}>
            {saving ? "Saving…" : "Save Draft"}
          </CrdFooterButton>
          <CrdFooterButton type="submit" variant="primary" disabled={saving || submitting}>
            {/* Three to a row on a phone: the short word there, the full one with room for it. */}
            {submitting ? "Submitting…" : <><span className="sm:hidden">Submit</span><span className="hidden sm:inline">Submit document</span></>}
          </CrdFooterButton>
        </>}
      </CrdDocumentFooter>
    </form>
  </PublicLayout>;
}
