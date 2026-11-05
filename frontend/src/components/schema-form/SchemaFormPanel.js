"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/shared/Button";
import FloatingNotice from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import IconButton from "@/components/shared/IconButton";
import CloseIcon from "@/components/ui/CloseIcon";
import SchemaFormEndSpacer from "./SchemaFormEndSpacer";
import SchemaFormField, { isVisible, visibleFields } from "./SchemaFormFields";
import SchemaFormSection from "./SchemaFormSection";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import SchemaFormSidebar from "./SchemaFormSidebar";
import SchemaFormSummary from "./SchemaFormSummary";
import useSchemaFormScrollSpy from "./useSchemaFormScrollSpy";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFocusTrap from "@/components/shared/useFocusTrap";
import requiredProblems, { describeMissing } from "./requiredProblems";

/** A section is either a described one, `{ id, title, fields }`, or a bare `[id, title]` link. */
const sectionLink = (section) => Array.isArray(section) ? section : [section.id, section.title];

/**
 * False while rendering on the server, true in the browser — asked the way React means it to be
 * asked, so it costs no second render and no state set from an effect. The panel portals into
 * `body` and there is no `body` to portal into until then.
 */
const neverChanges = () => () => {};
const useMounted = () => useSyncExternalStore(neverChanges, () => true, () => false);

/**
 * Every full-screen form in the app. Give it `sections` describing the fields and it renders them
 * against `values`, reporting each edit through `onChange(name, value)`; a form with something no
 * field type covers passes `children` instead, or mixes the two.
 *
 * The panel owns everything that would otherwise be repeated per form: the section sidebar and its
 * scroll spy, the error notice, the Cancel/submit footer, the wait before the record arrives, and
 * the dialog behaviour — Escape to close, a locked page behind it, and the roles that let a screen
 * reader announce it.
 *
 * `navigate` turns the sections into separate pages instead of one scrolling document, which is what
 * a settings surface wants; see the prop for the detail.
 */
export default function SchemaFormPanel({
  /*
   * `readOnly` makes every field in the panel un-editable in one move, and is what a caller should
   * reach for when the viewer holds READ but not READ_WRITE. The fields stay filled in and readable
   * - a form with its fields taken away is an empty record rather than a read-only one - and the
   * pointer says so over each control. Pair it with `onSubmit`/`submitLabel` left out, so there is
   * no save to press.
   */
  readOnly = false,
  readOnlyReason,
  title,
  description,
  sections,
  /** Fields shown above the first section, belonging to the form rather than to any one section. */
  leadFields,
  /*
   * A tab bar under the title, above the rail and the body — for a panel holding two things rather
   * than two parts of one thing, the way a record's own details and the payments read from Accounts
   * are not sections of each other. Rendered as given, so the caller decides what the tabs are and
   * which is current; the panel only finds it a place to sit and keeps it out of the scroll.
   *
   * The rail below it still navigates whatever the chosen tab put on screen. The two are different
   * questions — which part of this record, and where within it — and flattening them into one list
   * is what this exists to avoid.
   */
  tabs,
  values,
  onChange,
  errors,
  /*
   * Remarks about answers, as opposed to faults in them: `{ fieldName: "..." }`, drawn amber under
   * the box the way an error is drawn red, and never alongside one.
   *
   * Beside `errors` rather than folded into it because the two mean opposite things to the form -
   * an error stops the save and a note does not - and the Interview register needs to say "this
   * number is already on the register" while a number is being typed, not after the record has
   * been filled in and refused.
   */
  notes,
  context,
  sidebarAriaLabel,
  // A panel that shows one section at a time drives the rail itself: pass the section on screen and
  // a handler for the rail's clicks, and the scroll spy stands down. Settings works this way — each
  // section is its own screen rather than a stop on one long scroll — while every form that stacks
  // its sections leaves both unset and keeps following the scroll position.
  activeSectionId,
  onSectionSelect,
  closeAriaLabel,
  onClose,
  // A back arrow before the title, for a panel opened from another panel — the shoot form over the
  // pre production cards. Back and the × can do the same thing; they still both belong, because
  // "return to where I was" and "dismiss this" are different intents even when the destination is
  // the same, and only the arrow tells the reader there is somewhere to go back to.
  onBack,
  backAriaLabel,
  onSubmit,
  error,
  footer,
  submitLabel,
  savingLabel,
  submitVariant = "primary",
  submitDisabled = false,
  cancelLabel = "Cancel",
  saving = false,
  children,
  loading = false,
  loadingLabel = "Loading form...",
  zIndexClassName = "z-[110]",
  // A form is one long document its sections scroll through. A settings surface is not: its sections
  // are separate pages, and the rail moves between them rather than scrolling to them. With this on,
  // only the chosen section is drawn, and `children` may be a function of the chosen section's id.
  navigate = false,
  // For a panel whose rail is the map of what it will cover rather than a way around what is
  // already there - Settings, where the entries are the subject and one of them happens to be
  // the only one built so far.
  alwaysShowSidebar = false,
  /*
   * Refuse a submit that leaves a required field empty, redden those fields, and scroll to the
   * first of them. On for every form, because the alternative is each one remembering to do it and
   * the ones that forgot are exactly the forms this is for.
   *
   * `false` is for a panel whose `required` marks are a guide rather than a rule - a draft that is
   * meant to be saved half-finished. It turns off the panel's own check only; whatever the caller
   * puts in `errors` is still drawn and still scrolled to.
   */
  validateRequired = true,
}) {
  // A section can apply only to some of the answers so far, which is how one status form asks for
  // shipment details and another does not. Hidden ones leave the sidebar as well as the body.
  const shownSections = useMemo(
    () => (sections || []).filter((section) => Array.isArray(section) || isVisible(section, values, context)),
    [context, sections, values],
  );
  const links = useMemo(() => shownSections.map(sectionLink), [shownSections]);
  // A nav offering the one place the reader is already at is noise, and the rail it sits in leaves a
  // grey column beside a short form, so a single-section panel simply drops it - unless the caller
  // says the rail is the point.
  const showSidebar = alwaysShowSidebar || links.length > 1;

  const mounted = useMounted();
  const [scrolledSection, setScrolledSection] = useState(links[0]?.[0]);
  const contentRef = useRef(null);
  const { selectSection, onContentScroll } = useSchemaFormScrollSpy(contentRef, setScrolledSection);
  // Controlled when the caller supplies the handler: the rail then reports clicks instead of
  // scrolling, and the highlight is the caller's section rather than whatever the scroll last read.
  const sectionsControlled = typeof onSectionSelect === "function";
  const activeSection = sectionsControlled ? activeSectionId : scrolledSection;
  const goToSection = sectionsControlled ? onSectionSelect : navigate ? setScrolledSection : selectSection;
  /*
   * The notice belongs to whoever opened the panel, so dismissing it is tracked here.
   *
   * A dismissal is remembered by the *message*, so it has to be given up again the moment the person
   * asks for the same thing a second time - which is why pressing the primary button clears it below
   * rather than each form being trusted to clear its own error first. Left to the forms, this
   * refused in silence: Create Project reported "Complete required fields: Signed Quotation", the
   * notice was dismissed (by hand, or by its own five-second timer), and every later press set that
   * identical string - so the message never changed, the dismissal still matched it, and the button
   * did nothing at all with nothing on screen to say why. A form that will not save is bad; one that
   * will not say so reads as a broken button.
   *
   * A string is a failure, which is what every caller passed when this only ever reported one.
   * `{ message, tone }` says which it is: a panel whose sections save themselves has successes to
   * report too, and "1 number removed." led with the red error mark because a string was the only
   * thing this could be handed.
   */
  /*
   * ── The required fields nobody filled in, and where to look for them ──────────────────────
   *
   * Worked out here rather than in each form, from the schema the panel is already drawing. Every
   * form in the app declares which of its fields are required; before this, only a handful acted on
   * it. The rest drew the asterisk, refused the save with a sentence at the top naming the field,
   * and left the field itself looking exactly like one that had been answered - on a form long
   * enough to have a section rail, often on a part of it that was scrolled off screen.
   *
   * `attempted` is what keeps it quiet until it is wanted. Nothing is red on a form somebody has
   * only opened; the marks appear on the first refused submit and then follow the answers, so a
   * field clears its own mark as it is filled rather than waiting for the next press.
   */
  const [attempted, setAttempted] = useState(false);
  const problems = useMemo(
    () => requiredProblems(validateRequired ? shownSections : [], validateRequired ? leadFields : [], values, context),
    [context, leadFields, shownSections, validateRequired, values],
  );
  /*
   * The caller's own errors win.
   *
   * "Required" is the most this can know; a form that has looked at the same field and found
   * something more specific - a date before the joining date, a number out of range - is saying
   * something worth more than the generic mark, and it must not be overwritten by it.
   */
  const shownErrors = useMemo(
    () => (attempted && problems.hasProblems ? { ...problems.marks, ...(errors || {}) } : errors),
    [attempted, errors, problems],
  );

  const notice = typeof error === "string"
    ? (error ? { message: error, tone: "error" } : null)
    : (error?.message ? { message: error.message, tone: error.tone || "error" } : null);
  const [dismissedError, setDismissedError] = useState("");
  if (!notice && dismissedError) setDismissedError("");
  // Said by the panel only while the caller is not already saying something. A form that reports its
  // own problem keeps its own words; two notices about the same press would be one too many.
  const shownNotice = attempted && problems.hasProblems && !notice
    ? { message: describeMissing(problems.labels), tone: "error" }
    : notice;

  /**
   * Refuses the submit, marks what is missing, and puts the first of them on screen.
   *
   * The scroll is the half that cannot be left to the notice: naming a field is no help on a form
   * whose sections do not all fit, and "Complete required fields: Date of Birth" above a screen
   * showing Bank Details reads as a fault in the form rather than as something to go and fix.
   */
  function handleSubmit(event) {
    if (loading) { event.preventDefault(); return; }
    if (validateRequired && problems.hasProblems) {
      event.preventDefault();
      setAttempted(true);
      setDismissedError("");
      // A lead field belongs to no section, so there is nowhere to scroll but the top of the form.
      if (problems.firstSectionId) goToSection(problems.firstSectionId);
      else contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setAttempted(true);
    setDismissedError("");
    onSubmit(event);
  }

  /*
   * Escape closes the panel, and the page behind it stops scrolling.
   *
   * This kept a stack of its own - a panel can open another over itself, recording a cash entry
   * from a project's Payments tab, and both listened on `window`, so one press closed both. The
   * stack was right and its scope was not: it held *panels*, so a dialog opened from a panel was
   * still a second listener that heard the same press. There is one stack for everything that
   * opens now, and this takes its place in it. See `useEscapeKey`.
   *
   * Not while saving: a form being written is not cancellable by looking away, and a panel that
   * vanished mid-write would leave somebody unsure whether it happened.
   */
  useEscapeKey(() => onClose?.(), !saving);

  /*
   * Focus goes into the panel, stays in it, and goes back to whatever opened it - the same answer
   * `Dialog` gives, from the same hook, because it is the same question. The panel covers the whole
   * screen, so focus left outside it was tabbing through a page nobody could see.
   *
   * A Dialog opened from a panel is a DOM descendant of it and carries its own trap; the innermost
   * one answers, so the two do not argue over a Tab. See `useFocusTrap`.
   */
  const panelRef = useFocusTrap();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const standardFooter = submitLabel ? <>
    <Button className="max-sm:flex-1" type="button" onClick={onClose} disabled={saving}>{cancelLabel}</Button>
    <Button className="ml-auto max-sm:flex-1" variant={submitVariant} disabled={saving || submitDisabled}>{saving && savingLabel ? savingLabel : submitLabel}</Button>
  </> : footer;

  // Rendered into `body` rather than where it was written.
  //
  // The panel is a `<form>` covering the screen, and a panel can open another over itself —
  // recording a cash entry from a project's Payments tab. Left where it sits in the tree that put
  // one form inside another, which is invalid HTML: React warns, and the browser is entitled to do
  // what it likes with the inner one's submit. Sending it to `body` makes the two siblings in the
  // DOM while React still treats it as a child, so its events, its context and its state are
  // unchanged. Nothing moves on screen either — the overlay is `fixed`, so it was never positioned
  // by its parent to begin with.
  //
  // Only after mount, because there is no `document` on the server and the panel is opened by an
  // interaction in any case.
  const panel = <div className={`fixed inset-0 bg-black/50 sm:pt-12 ${zIndexClassName}`}>
    <FloatingNotice notice={shownNotice && shownNotice.message !== dismissedError ? shownNotice : null} onClose={() => setDismissedError(shownNotice?.message || "")} />
    <form ref={panelRef} role="dialog" aria-modal="true" aria-label={title} onSubmit={handleSubmit} className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white shadow-2xl sm:h-[calc(100dvh-3rem)] sm:rounded-t-md">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:gap-4 sm:px-5 sm:pb-4 sm:pt-5">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {onBack && <IconButton onClick={onBack} disabled={saving} label={backAriaLabel || "Back"} size="sm" className="text-slate-500 hover:bg-slate-50 hover:text-slate-700">←</IconButton>}
          <div className="min-w-0"><h1 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h1><p className="mt-1 text-xs text-slate-500 sm:mt-1.5 sm:text-sm">{description}</p></div>
        </div>
        <IconButton onClick={onClose} label={closeAriaLabel} title="Close" size="sm" className="self-center text-slate-500 hover:bg-slate-50 hover:text-slate-700"><CloseIcon aria-hidden="true" sx={{ fontSize: 24 }} /></IconButton>
      </header>
      {tabs && <div className="shrink-0 border-b border-slate-200 bg-white px-4 sm:px-5">{tabs}</div>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {showSidebar && <SchemaFormSidebar sections={links} activeId={activeSection} onSelect={goToSection} ariaLabel={sidebarAriaLabel} />}
        <main ref={contentRef} onScroll={navigate || sectionsControlled ? undefined : onContentScroll} className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {/* Nothing in the body means anything until the record it describes has arrived, so the
              wait replaces it rather than sitting above a form of empty fields. */}
          {loading ? <Loader label={loadingLabel} size="lg" className="h-full" /> : <ReadOnlyFieldset canWrite={!readOnly} reason={readOnlyReason} className="contents">
            {typeof children === "function" ? children(activeSection) : children}
            {/* Fields belonging to the whole form rather than to one of its sections — the choice
                that decides what every section below asks for. Above the first heading, so it reads
                as the question the rest of the form answers rather than as one of its own fields. */}
            {leadFields?.length ? <div className="w-full max-w-[1040px] border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5">
              <div className="grid gap-4 md:grid-cols-2">
                {visibleFields(leadFields, values, context).map((field) => <SchemaFormField key={field.name} field={field} values={values} onChange={onChange} errors={shownErrors} notes={notes} context={context} />)}
              </div>
            </div> : null}
            {shownSections.filter((section) => !Array.isArray(section)).filter((section) => !navigate || section.id === activeSection).map((section) => <SchemaFormSection key={section.id} id={section.id} title={section.title}>
              {section.summary && <SchemaFormSummary items={section.summary(values, context)} className="mb-4" />}
              {section.render?.({ values, onChange, context, errors: shownErrors })}
              {section.fields && <div className={`grid gap-4 ${section.columns === 1 ? "" : "md:grid-cols-2"}`}>
                {visibleFields(section.fields, values, context).map((field) => <SchemaFormField key={field.name} field={field} values={values} onChange={onChange} errors={shownErrors} notes={notes} context={context} />)}
              </div>}
            </SchemaFormSection>)}
            {/* Room under the last section so it can still scroll up to the reading line and become
                the active one. A panel showing a single section has no reading line to reach, and
                the spacer would only pad a short pane into a needless scroll. */}
            {!navigate && !sectionsControlled && <SchemaFormEndSpacer />}
          </ReadOnlyFieldset>}
        </main>
      </div>
      {/* Only when there is something to put in it. A panel that neither submits nor offers an
          action - Settings, which saves each section as it goes - was drawing an empty bordered
          strip along the bottom of the screen for a button that is not there. */}
      {standardFooter && <footer className="relative z-10 flex shrink-0 bg-white">
        {showSidebar && <div className="hidden w-60 shrink-0 border-r border-slate-200 bg-slate-50 lg:block" />}
        <div className="flex min-w-0 flex-1 items-center gap-3 border-t border-slate-200 px-3 py-2.5 sm:flex-wrap sm:px-5 sm:py-3">{standardFooter}</div>
      </footer>}
    </form>
  </div>;

  return mounted ? createPortal(panel, document.body) : null;
}
