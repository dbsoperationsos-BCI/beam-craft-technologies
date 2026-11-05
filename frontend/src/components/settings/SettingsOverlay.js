"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import TableSettingsSection from "@/components/shared/TableSettingsSection";
import ExcludedNumbersPanel from "@/components/sales/ExcludedNumbersPanel";
import ProjectSettingsPanel from "@/components/project-management/ProjectSettingsPanel";
import { useUnloadWarning } from "@/components/shared/useUnsavedGuard";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import { layers } from "@/constants/layers";
import WhatsAppUsersTable from "@/components/settings/WhatsAppUsersTable";
import MessageTemplatePanel from "@/components/settings/MessageTemplatePanel";
import ReferralAmountPanel from "@/components/settings/ReferralAmountPanel";
import SidebarLayoutPanel from "@/components/settings/SidebarLayoutPanel";
import BranchesPanel from "@/components/settings/BranchesPanel";
import HolidaysPanel from "@/components/settings/HolidaysPanel";
import StudioBrandingPanel from "@/components/settings/StudioBrandingPanel";
import ApplicationMonitoringPanel from "@/components/settings/ApplicationMonitoringPanel";
import FieldSettingsPanel from "@/components/settings/FieldSettingsPanel";
import LoginSlidePanel from "@/components/settings/LoginSlidePanel";
import QuotationBrandSettingsPanel, { QuotationGeneralSettingsPanel } from "@/components/settings/QuotationSettingsPanel";
import { QUOTATION_BRANDS } from "@/lib/quotationBrand.mjs";
import GoogleSheetsIntegrationSection from "@/components/settings/GoogleSheetsIntegrationSection";
import { CRM_VERTICAL_OPTIONS, INTERVIEW_SHEET_INTEGRATION, SALES_SHEET_INTEGRATION, SHEET_INTEGRATION_SECTION_IDS } from "@/components/settings/sheetIntegrationConfigs";

/*
 * The anchors Project Settings contributes to the rail.
 *
 * They are one screen, not several: the panel draws its sections stacked and a click on any of
 * them scrolls to that one. Named here because both the rail's scrolling and the "leaving loses
 * your staged edits" guard have to agree on which ids belong to the group.
 */
const PROJECT_SECTION_IDS = ["project-services", "project-deliverables"];
const isProjectSection = (id) => PROJECT_SECTION_IDS.includes(id);

/*
 * "Overall" - the three screens that configure the application itself rather than one part of it.
 *
 * Table builds the fields a module's forms carry, Fields sets the answers those fields offer, and
 * Project sets the services and deliverables every project is drawn from. All three cut
 * across the whole application, which is what they have in common and what the rail never said:
 * they sat in the list between User Preference and Exclude Phone Numbers, three neighbours with no
 * stated relation, each ending in the word "Settings" like everything else around them.
 *
 * The names shorten inside the group. "Overall -> Table Settings" says settings twice; the group
 * carries that word now, so the entries carry only what they are.
 */
const OVERALL_SECTIONS = { "table-settings": "Table", "field-settings": "Fields", "project-settings": "Project" };

/**
 * The rail with those three gathered under one entry, in the place the first of them stood.
 *
 * Gathering rather than moving: each entry is still written where it was, behind its own permission
 * - Table on `SALES / CRM Leads`, Fields on `HRM / Employee Management`, Project on
 * `PROJECT / Projects`. So this takes whichever of the three the role can actually see: a studio
 * that may build tables but not touch projects gets an Overall holding two entries, and one that
 * reaches none of them gets no Overall at all rather than an empty group that opens onto nothing.
 *
 * Left where the first one stood so the rest of the rail does not shift under somebody who already
 * knows where to look.
 */
function withOverallGroup(sections) {
  const children = sections.filter((section) => OVERALL_SECTIONS[section.id])
    .map((section) => ({ ...section, title: OVERALL_SECTIONS[section.id] }));
  if (!children.length) return sections;
  const group = { id: "overall", title: "Overall", children };
  return sections.flatMap((section) => {
    if (!OVERALL_SECTIONS[section.id]) return [section];
    return section.id === children[0].id ? [group] : [];
  });
}

/** Every screen an entry holds, however deep - what the rail selects is always a screen. */
function screensWithin(section) {
  return section.children ? section.children.flatMap(screensWithin) : [section];
}

/** One rail entry: `[id, title]`, or `[id, title, children]` for a group. Two levels deep here. */
function railEntryFor(section) {
  return section.children
    ? [section.id, section.title, section.children.map(railEntryFor)]
    : [section.id, section.title];
}

/*
 * How far into the scroller a section's top has to be before it counts as the one being read.
 *
 * A few pixels rather than a reading line partway down the pane: these sections carry a sticky
 * heading, so the moment a section's top reaches the top of the scroller its heading takes over -
 * and the rail should say the same thing the heading does.
 */
const PROJECT_SPY_LINE_PX = 4;

/*
 * How long the highlight ignores the scroll after a rail click.
 *
 * Long enough for a smooth scroll the length of the page to land. Shorter and the sections it
 * travels through would each claim the highlight on the way past.
 */
const PROJECT_SPY_PAUSE_MS = 800;


export default function SettingsOverlay({
  open,
  onClose,
  initialSection = "whatsapp",
  initialIntegration = null,
  initialNotice = null,
  onCustomFieldsSaved,
}) {
  // Settings opens with the user's own settings first. A module shortcut can still take
  // the reader directly to the same section it opened before the panel moved into the app shell.
  /*
   * Which integration section an OAuth return names, and the panel to open inside it.
   *
   * There are two integration entries now - Sales and Interview - and the top bar says which one
   * the consent flow left from. A return that names neither is the CRM's, as every return was
   * before Interview existed.
   */
  const integrationSectionId = SHEET_INTEGRATION_SECTION_IDS.includes(initialSection) ? initialSection : SALES_SHEET_INTEGRATION.sectionId;
  const initialIntegrationFor = (sectionId) => (initialIntegration && integrationSectionId === sectionId ? initialIntegration : null);
  const [activeSection, setActiveSection] = useState(initialIntegration ? integrationSectionId : initialSection || "whatsapp");
  // Sales configuration keeps the permission that governed it on the Lead page. User settings
  // remain available globally, while roles without Sales write access are not offered controls
  // that the same backend routes would refuse.
  // An employee sees only their own preferences here; everything else in this overlay is the
  // studio's. The same test the top bar has always used to decide whose menu carries Settings.
  const { canWrite } = useModuleAccess("SALES", "CRM Leads");
  /*
   * Project Settings answers to its own module, not to the CRM's.
   *
   * It is the project service and deliverable master data, which PROJECT / Projects owns and its
   * own routes enforce - so it is offered on that permission rather than riding in on the Sales
   * write the sections around it are gated by. A studio's project manager configures services
   * without being given the CRM's table builder, and vice versa.
   */
  const { canWrite: canWriteProjectSettings } = useModuleAccess("PROJECT", "Projects");
  /*
   * Studio Branding answers to ADMIN / System Settings, which is what its routes are guarded by -
   * the same permission Image Selection asks for before offering its own settings. Offered on write
   * alone: the section is two fields and a Save, so a read-only copy of it would be a form nobody
   * can submit.
   */
  /*
   * One permission per rail entry, under a `SETTINGS` module of their own.
   *
   * `ADMIN / System Settings` used to be the whole of this overlay behind one tick - branding,
   * branches, templates, quotation brands, the login slide, the holidays and the monitoring - so a
   * studio wanting somebody to keep the message templates had to give them all of it. These are
   * different jobs, so the catalogue now matches this rail: one row per title, granted in Role
   * Management under a Settings heading of its own.
   *
   * Read and write are both asked for where a section has something worth only looking at; the rest
   * are offered on write alone, because a two-field form nobody may submit is not a section.
   */
  const { canRead: canReadUserSettings } = useModuleAccess("SETTINGS", "User Settings");
  const { canWrite: canWriteTableSettings } = useModuleAccess("SETTINGS", "Table Settings");
  const { canWrite: canWriteFieldSettings } = useModuleAccess("SETTINGS", "Field Settings");
  const { canWrite: canWriteProjectSettingsSection } = useModuleAccess("SETTINGS", "Project Settings");
  const { canWrite: canWriteExcludedNumbers } = useModuleAccess("SETTINGS", "Exclude Phone Numbers");
  const { canWrite: canWriteIntegrations } = useModuleAccess("SETTINGS", "Integrations");
  const { canWrite: canWriteQuotationSettings } = useModuleAccess("SETTINGS", "Quotation Settings");
  const { canRead: canReadReferralSetting } = useModuleAccess("SETTINGS", "Employee Referral");
  const { canRead: canReadMessageTemplates, canWrite: canWriteMessageTemplates } = useModuleAccess("SETTINGS", "Message Template");
  const { canWrite: canWriteOrganization } = useModuleAccess("SETTINGS", "Organization");
  const { canRead: canReadHolidays, canWrite: canWriteHolidays } = useModuleAccess("SETTINGS", "Holidays");
  const { canWrite: canWriteLoginSlide } = useModuleAccess("SETTINGS", "Login Slide");
  const { canWrite: canWriteMonitoring } = useModuleAccess("SETTINGS", "Application Monitoring");
  /*
   * The referral amount answers to `HRM / Employee Referral`, which is what its own routes enforce.
   *
   * Deliberately not the administrator's System Settings, even though it sits in this overlay: a
   * section offered on a permission the server does not check is a form whose Save is refused, and
   * whoever runs referrals is not necessarily an administrator. Offered on read as well as write,
   * because the figure is worth being able to look up — the panel drops its Save without write.
   */
  const { canRead: canReadReferrals, canWrite: canWriteReferrals } = useModuleAccess("HRM", "Employee Referral");
  /*
   * Field Settings edits the HRM master-data lists - the designations, departments, verticals
   * and skills the employee form offers - and `/api/hrm/<resource>` gates every write on
   * `HRM / Employee Management` READ_WRITE. It sat inside the `canWrite` block above, which is
   * `SALES / CRM Leads`, so the screen and the endpoint disagreed in both directions: somebody
   * with the CRM and not HR was shown a list editor whose every Add came back 403, and the HR
   * manager who actually maintains these lists could not reach the section at all.
   */
  const { canWrite: canWriteEmployeeLists } = useModuleAccess("HRM", "Employee Management");
  /*
   * The Interview integration answers to the module its sheets feed, exactly as the Sales one
   * answers to the CRM's: `HRM / Interview` is what `/api/hrm/interview/google-sheet-links`
   * enforces, so the section is offered on that write and absent without it.
   */
  const { canWrite: canWriteInterview } = useModuleAccess("HRM", "Interview");
  /*
   * Project Settings' Save, and whether there is anything for it to write.
   *
   * The panel stages every edit and writes them together, which is the workflow it had as a screen
   * of its own and the one it keeps here - so Settings has to carry its footer. The handle is how
   * that footer's Save reaches it, and `projectSettingsState` is what the panel reports back so the
   * button can be held shut until something is staged.
   */
  const projectSettingsRef = useRef(null);
  const [projectSettingsState, setProjectSettingsState] = useState({ dirty: false, busy: false, loading: true });
  /*
   * Whether Table Settings has edits that have not been saved, and the section somebody tried
   * to leave for while it did.
   *
   * Read at the moment of leaving rather than subscribed to: the rail only needs the answer
   * when it is clicked, and a state update on every keystroke in the form builder would
   * re-render this whole shell for nothing. Moving to another section unmounts the builder and
   * its canvas goes with it, so leaving without asking is how the work was lost.
   */
  const tableSettingsUnsavedRef = useRef(false);
  // Field Settings holds its edits until Save the same way now, so it loses the same work on the
  // same click and is asked about through a ref of its own.
  const fieldSettingsUnsavedRef = useRef(false);
  // The Sidebar Layout draft, which is the third thing in this panel that can lose work on a click.
  const sidebarLayoutUnsavedRef = useRef(false);
  /*
   * The rest of the sections that hold an edit until a Save is pressed. Each panel writes its own
   * ref and clears it on the way out, so what is asked here is always about the section on screen:
   * a panel that has been unmounted is holding nothing.
   *
   * Sections not listed save as they go - a WhatsApp number is saved as it is added, a linked sheet
   * by its own dialog, an option list entry as it is typed - so there is nothing of theirs to lose.
   */
  const studioBrandingUnsavedRef = useRef(false);
  const loginSlideUnsavedRef = useRef(false);
  const applicationMonitoringUnsavedRef = useRef(false);
  // One ref for the whole Message Template group: its children are the same panel with a different
  // key, and only one is ever on screen.
  const messageTemplateUnsavedRef = useRef(false);
  const referralAmountUnsavedRef = useRef(false);
  /*
   * Quotation Settings. The shared content is its own screen, and the brands share one ref for the
   * same reason the message templates do: three rail entries, one panel, and only ever one of them
   * mounted. A brand's ref covers only its PDF Content tab - a term is saved by its own dialog as
   * it is written, so the Terms tab stages nothing.
   */
  const quotationGeneralUnsavedRef = useRef(false);
  const quotationBrandUnsavedRef = useRef(false);
  const [pendingSection, setPendingSection] = useState(null);
  const [linkError, setLinkError] = useState(
    initialNotice?.tone === "error" ? initialNotice.message || "Unable to connect the Google account." : "",
  );
  /*
   * What Project Settings reports back, taken as it comes.
   *
   * Its failures go to this panel's own notice line rather than being drawn inside the section -
   * embedded, it has no notice line of its own. Stable, because the panel lists it as an effect
   * dependency: a handler rebuilt each render would put that effect into a loop.
   */
  const handleProjectSettingsState = useCallback((state) => {
    setProjectSettingsState({
      dirty: Boolean(state?.dirty),
      busy: Boolean(state?.busy),
      // The sections are not in the page until the rows arrive, so a rail click that lands while
      // the panel is still loading has nothing to scroll to; the effect below waits for this.
      loading: Boolean(state?.loading),
    });
    setLinkError(state?.error || "");
  }, []);
  /*
   * What a section reports having done, as opposed to a failure.
   *
   * Separate from `linkError` because that one is a string the Google Sheet dialog also prints
   * inline in red, and a success is not that. Both are handed to the panel's one notice line, which
   * takes a tone.
   */
  const [sectionNotice, setSectionNotice] = useState(
    initialNotice && initialNotice.tone !== "error"
      ? initialNotice.message || "Google account connected successfully."
      : "",
  );
  /*
   * Closing puts both away.
   *
   * The overlay is not unmounted when it closes - the CRM keeps it and toggles `open` - so a
   * message set on the way out was still in state the next time Settings was opened, and the panel
   * inside it, which *is* remounted, had no record of anyone having dismissed it. "1 number
   * removed." greeted whoever opened Settings next, however long afterwards.
   */
  const closeSettings = useCallback(() => {
    setLinkError("");
    setSectionNotice("");
    onClose();
  }, [onClose]);

  /*
   * Whether the section on screen is holding something the server has not been told about.
   *
   * The rail and the X ask the same question, so they cannot answer it differently: leaving a
   * section and closing the overlay lose the same edit, and until now only the first of them said
   * so - the X threw the work away without a word.
   */
  const unsavedRefFor = (id) => ({
    "table-settings": tableSettingsUnsavedRef,
    "field-settings": fieldSettingsUnsavedRef,
    "sidebar-layout": sidebarLayoutUnsavedRef,
    "studio-branding": studioBrandingUnsavedRef,
    "login-slide": loginSlideUnsavedRef,
    "application-monitoring": applicationMonitoringUnsavedRef,
    // All three message templates answer from the one ref the mounted panel writes - only ever one
    // of them is on screen, the same way the quotation brand entries share theirs below.
    "message-cash-received": messageTemplateUnsavedRef,
    "message-employee-invite": messageTemplateUnsavedRef,
    "message-login-credentials": messageTemplateUnsavedRef,
    "employee-referral": referralAmountUnsavedRef,
    "quotation-general": quotationGeneralUnsavedRef,
    // Every brand entry answers from the one ref the mounted brand panel writes.
    ...Object.fromEntries(QUOTATION_BRANDS.map((brand) => [`quotation-brand-${brand.code}`, quotationBrandUnsavedRef])),
  })[id];
  const sectionHoldsUnsavedEdits = (id) => Boolean(unsavedRefFor(id)?.current)
    || (isProjectSection(id) && projectSettingsState.dirty);
  // The edit is gone with the panel, so nothing is left behind still claiming to be unsaved.
  const forgetUnsavedEdits = (id) => { const ref = unsavedRefFor(id); if (ref) ref.current = false; };

  /*
   * The way out this overlay cannot put a dialog in front of: a refresh, a closed tab, the back
   * button. The rail and the X were taught to ask, and F5 still threw a half-built table away
   * without a word - the same work, lost to the one exit nobody had covered. The browser asks its
   * own question there, in its own words, and only because this says there is something to lose.
   * Only while Settings is open: nothing else in the application stages work this way.
   */
  useUnloadWarning(open, () => sectionHoldsUnsavedEdits(activeSection));

  // Closing is a way out of the section too, so it goes through the same question the rail asks.
  const requestCloseSettings = () => {
    if (sectionHoldsUnsavedEdits(activeSection)) { setPendingSection({ kind: "close" }); return; }
    closeSettings();
  };

  // Escape, and the page behind stopping scrolling, now belong to `SchemaFormPanel` along with the
  // rest of the form-panel behaviour. It also draws the backdrop over the whole window, header
  // included, so the `data-settings-open` dimming this used to switch on is gone too - the header
  // was only left at full strength because the old overlay started below it.

  /**
   * A saved vertical, passed on to the CRM board.
   *
   * The reading and the writing are `TableSettingsSection`'s now; what stays here is the one thing
   * only this overlay can do - tell the page underneath that a vertical's fields changed, so the
   * lead table and Add Lead pick the new field up without a reload.
   */
  const handleTableSettingsSaved = useCallback((savedBranch, saved) => {
    onCustomFieldsSaved?.(savedBranch, saved);
  }, [onCustomFieldsSaved]);

  /*
   * Project Settings is one scrolling page, so its rail entries navigate within it: a click
   * scrolls to a section, and scrolling moves the highlight. Both halves are here.
   */

  // A section chosen before the rows arrived. The sections do not exist in the page while the panel
  // is loading, so the move is remembered and made the moment they do.
  const pendingProjectScrollRef = useRef("");
  /*
   * Until when the highlight must ignore the scroll position.
   *
   * A click scrolls smoothly, which travels through every section between here and there - and the
   * spy below would call each one in turn the current section, so the entry the reader pressed
   * would light up last and only briefly. It stands down until the move has landed.
   */
  const spyPausedUntilRef = useRef(0);

  const scrollToProjectSection = useCallback((id) => {
    if (!isProjectSection(id)) return;
    spyPausedUntilRef.current = Date.now() + PROJECT_SPY_PAUSE_MS;
    // Deferred a tick so the section is in the page before it is scrolled to.
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  // The move somebody asked for while the panel was still loading, made once it is not.
  useEffect(() => {
    if (!open || projectSettingsState.loading) return undefined;
    const pending = pendingProjectScrollRef.current;
    if (!pending) return undefined;
    pendingProjectScrollRef.current = "";
    scrollToProjectSection(pending);
    return undefined;
  }, [open, projectSettingsState.loading, scrollToProjectSection]);

  /*
   * The highlight follows the scroll.
   *
   * Without it the rail answered "where am I" with "wherever you last clicked": scrolling from
   * Services down to Deliverables left Services lit, which is the rail describing a page the reader
   * has already moved past.
   *
   * The current section is the last one whose top has passed the top of the scroller, which is also
   * the one whose sticky heading is on screen - so the rail and the heading always name the same
   * thing. Listening to the panel's own scroller rather than the window, because that is what
   * actually moves; it is found through a section rather than by reaching into the panel, so this
   * knows nothing about how the panel is built beyond the ids it was given.
   *
   * `onProjectSections` is a boolean rather than the section id on purpose: with the id in the
   * dependencies, every move of the highlight would tear this listener down and build it again.
   */
  const onProjectSections = isProjectSection(activeSection);
  useEffect(() => {
    if (!open || !onProjectSections || projectSettingsState.loading) return undefined;
    const scroller = document.getElementById(PROJECT_SECTION_IDS[0])?.closest("main");
    if (!scroller) return undefined;

    const readPosition = () => {
      if (Date.now() < spyPausedUntilRef.current) return;
      const top = scroller.getBoundingClientRect().top;
      let current = PROJECT_SECTION_IDS[0];
      for (const id of PROJECT_SECTION_IDS) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top - top <= PROJECT_SPY_LINE_PX) current = id;
      }
      /*
       * The foot of the page is the last section, whatever the measurement says.
       *
       * The last section may be short enough that scrolled all the way down its top still sits
       * below the top of the pane - and without this the rail would stop at the one before it
       * however far the reader scrolled, which is the same complaint this spy exists to answer.
       */
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - PROJECT_SPY_LINE_PX) {
        current = PROJECT_SECTION_IDS[PROJECT_SECTION_IDS.length - 1];
      }
      // Only ever moves the highlight within the group: a rail click that leaves the group
      // entirely must not be overwritten by a last scroll event on the way out.
      setActiveSection((now) => (isProjectSection(now) && now !== current ? current : now));
    };

    scroller.addEventListener("scroll", readPosition, { passive: true });
    return () => scroller.removeEventListener("scroll", readPosition);
  }, [onProjectSections, open, projectSettingsState.loading]);

  if (!open || typeof document === "undefined") return null;

  /**
   * Settings as the app's own full-screen form: the same panel Image Selection settings and every
   * other module form is built from, so the header, the section rail, the error notice, Escape and
   * the locked page behind all behave the way they do everywhere else.
   *
   * One section is on screen at a time, the way Settings has always worked — the rail moves between
   * them rather than scrolling one long document. That is what `activeSectionId`/`onSectionSelect`
   * on the panel are for, and why the sections go in as rail entries with the section on screen
   * passed as the body.
   *
   * Written flat, and grouped afterwards. Table Settings and Integration used to sit under "General
   * Settings" and "CRM" — parents with no content of their own — and are entries in their own right
   * here rather than the only reason to open a group. The one group built out of entries written
   * here is "Overall", which gathers Table, Fields and Project; `withOverallGroup` above does it, so
   * each of the three stays written in its own place behind its own permission.
   *
   * A section with nothing to configure yet says so. They are listed because the rail is the map of
   * what Settings will cover, and a rail that grew an entry per release would keep moving the ones
   * already in use.
   */
  const settingsSections = [
    ...(canReadUserSettings ? [{
      id: "user-settings",
      title: "User Settings",
      children: [
        {
          id: "whatsapp",
          title: "WhatsApp",
          render: () => <WhatsAppUsersTable />,
        },
        // Referrals used to sit here, as a studio figure among the other studio figures. Both the
        // register of who is owed one and the amount it pays are HRM's own Employee Referral
        // screen now — the register is the page, the amount is the Settings panel on its header —
        // because a figure is set by whoever is looking at what it produced, not three screens
        // away under User Settings. Both answer to `HRM / Employee Referral`.
      ],
    }] : []),
    /*
     * What this login has decided for itself, and nobody else.
     *
     * Deliberately outside the `canWrite` gate below, which is what decides who may change the
     * *studio's* settings. Nothing in here is the studio's: it is one person's own sidebar order
     * and their own appearance, stored against their account and read by nothing else. Gating it
     * behind a module permission would mean a role could be refused the right to arrange its own
     * screen — the same reasoning that keeps `/api/user/preferences` behind `protect` alone with
     * no permission of its own.
     */
    {
      id: "user-preference",
      title: "User Preference",
      children: [
        {
          id: "sidebar-layout",
          title: "Sidebar Layout",
          render: () => <SidebarLayoutPanel unsavedRef={sidebarLayoutUnsavedRef} />,
        },
        // The appearance is not here. It is one choice, already offered where somebody reaches for
        // it — the account menu on the top bar — and a second way in would be the same setting in
        // two places. It is still kept against the account rather than the browser; see
        // `useThemePreference`.
      ],
    },
    ...(canWrite && canWriteTableSettings ? [
    {
      id: "table-settings",
      title: "Table Settings",
      /*
       * The builder is the shared section, which is what Employee Settings puts on its own rail.
       *
       * This overlay used to fetch and save the fields itself, with its own copy of the response
       * grouping - a second implementation of one endpoint, and the reason the two ways in could
       * drift. `TableSettingsSection` owns both now, so whichever entry a studio uses, it is the
       * same screen doing the same thing: pick a module, then what varies inside it. Leads offers
       * its three verticals; Human Resource Management offers the four lists an employee form draws
       * its answers from - Designations, Departments, Verticals and Skills - and edits them in
       * place, exactly as it does from Employee Settings.
       */
      wide: true,
      render: () => (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 sm:text-sm">
            Choose a module and vertical, then build the fields its table and forms carry.
          </p>
          <TableSettingsSection
            verticalOptions={CRM_VERTICAL_OPTIONS}
            onSaved={handleTableSettingsSaved}
            // So the rail can ask before a click on another section throws this canvas away.
            unsavedRef={tableSettingsUnsavedRef}
          />
        </div>
      ),
    },
    ] : []),
    /*
     * Field Settings, immediately after Table Settings.
     *
     * The two used to be one entry: Table Settings' Module dropdown offered Human Resource
     * Management, and picking it swapped the field builder for a list editor while hiding the
     * Preview, Cancel and Save buttons that had nothing to do with it. Two different jobs behind
     * one name, one of them borrowing the other's frame.
     *
     * Table Settings builds new fields onto a form. This edits the answers an existing field
     * offers - the designations an employee can hold, the departments there are. It holds those
     * edits until its own Save, as Table Settings holds its canvas, which is why it reports to
     * `fieldSettingsUnsavedRef` and is asked about on the way out like the rest of them.
     *
     * And it answers to its own permission rather than to Table Settings': see
     * `canWriteEmployeeLists` above. The two sections sit next to each other and are written by two
     * different people.
     */
    ...(canWriteEmployeeLists && canWriteFieldSettings ? [{
      id: "field-settings",
      title: "Field Settings",
      wide: true,
      render: () => <FieldSettingsPanel onError={setLinkError} unsavedRef={fieldSettingsUnsavedRef} />,
    }] : []),
    ...(canWrite && canWriteExcludedNumbers ? [
    {
      id: "exclude-numbers",
      title: "Exclude Phone Numbers",
      // Draws the module's own table and saves each number as it is added, so it is handed the
      // section rather than described as a field list - the same arrangement as Table Settings
      // above it. What it did goes to the panel's notice line as a success, what failed as an error.
      render: () => <ExcludedNumbersPanel canWrite={canWrite} onNotice={setSectionNotice} onError={setLinkError} />,
    },
    ] : []),
    /*
     * Integrations: a group, not a screen. Pressing it opens the modules under it, and each module
     * is one page - the same page, `GoogleSheetsIntegrationSection`, drawn for that module's own
     * linked sheets. Integrations are per module, so the module is the entry that carries them, and
     * each entry answers to the Settings row *and* to the module its sheets feed: Sales to
     * `SALES / CRM Leads`, Interview to `HRM / Interview`, which is what linking a sheet answers
     * for on the server. A reader holding the Settings row and neither module sees no group at all.
     *
     * `key` on the section, because the two entries render the same component at the same place in
     * the tree: without it React would carry one module's linked sheets into the other's panel.
     */
    ...(canWriteIntegrations && (canWrite || canWriteInterview) ? [
    {
      id: "sales-integrations",
      title: "Integrations",
      children: [
        ...(canWrite ? [{
          id: SALES_SHEET_INTEGRATION.sectionId,
          // "Sales" under "Integrations": the group names what these are, the leaf names the part of
          // the application they feed. Both saying "Leads" read as the same word twice over.
          title: "Sales",
          render: () => <GoogleSheetsIntegrationSection
            key={SALES_SHEET_INTEGRATION.id}
            config={SALES_SHEET_INTEGRATION}
            initialIntegration={initialIntegrationFor(SALES_SHEET_INTEGRATION.sectionId)}
            onError={setLinkError}
            onNotice={setSectionNotice}
          />,
        }] : []),
        ...(canWriteInterview ? [{
          id: INTERVIEW_SHEET_INTEGRATION.sectionId,
          title: "Interview",
          render: () => <GoogleSheetsIntegrationSection
            key={INTERVIEW_SHEET_INTEGRATION.id}
            config={INTERVIEW_SHEET_INTEGRATION}
            initialIntegration={initialIntegrationFor(INTERVIEW_SHEET_INTEGRATION.sectionId)}
            onError={setLinkError}
            onNotice={setSectionNotice}
          />,
        }] : []),
      ],
    },
    ] : []),
    ...(canWriteProjectSettings && canWriteProjectSettingsSection ? [{
      /*
       * Project Settings, as a group with its own three screens rather than a panel of its own.
       *
       * It used to open from the Projects board's ⋮ as a second full-screen form over the app -
       * settings that lived outside Settings. The three screens are unchanged and so is everything
       * they do: the same rows, the same configure-in-a-dialog step, the same staging, and the same
       * Save that writes all three sections together. What changed is where the rail for them is -
       * this one - so the studio has one place it configures the application from.
       *
       * One panel across all three entries, deliberately: the rail switches `activeSection` on the
       * same mounted component rather than mounting a new one per screen, so a service staged on
       * Services is still staged when the reader looks at Deliverables and one Save writes both.
       * That is why the three renders below are the same element with a different section named.
       */
      id: "project-settings",
      title: "Project Settings",
      children: [
        ["project-services", "Services"],
        ["project-deliverables", "Deliverables"],
      ].map(([id, title]) => ({
        id,
        title,
        /*
         * Every entry draws the same thing: all three sections, stacked, as one scrolling document.
         *
         * They are anchors rather than screens. One Save writes Services, Deliverables and Size
         * Options together, and a Save at the foot of a page showing only Services reads as
         * Services' own however many sections it actually covers - so the page shows all three and
         * the rail moves within it, which is what this panel has always done. Selecting one scrolls
         * to it; see `scrollToProjectSection`.
         *
         * `raw` because the panel brings its own three sections with their own headings: wrapping
         * it in a fourth would put "Services" above all of them.
         */
        raw: true,
        render: () => <ProjectSettingsPanel
          ref={projectSettingsRef}
          embedded
          // The rail's own ids, so the anchors it scrolls to are the entries it lists.
          idPrefix="project-"
          onEmbeddedStateChange={handleProjectSettingsState}
          onClose={requestCloseSettings}
        />,
      })),
    }] : []),
    /*
     * Quotation Settings: what each brand's quotations offer.
     *
     * General first - the content every brand's quotation shares: the notes and trademark cards,
     * Journey & Legacy and Our Infrastructure - then one screen per brand (Dum Dum, Qua Qua, Corp)
     * carrying two tabs: the brand's terms, and its own pictures and words on the client-facing
     * PDF. The brand entries come from the one list the generator and the register read, so the
     * rail cannot name a brand they do not know.
     *
     * On `ADMIN / System Settings`, the permission the brand admin routes enforce - the same gate
     * Organization and Branding Logo answer to. Every panel here saves the moment it is pressed,
     * so none of them borrows the footer. Changing anything here reaches only quotations raised
     * afterwards; a version already sent keeps its own snapshot.
     */
    ...(canWriteQuotationSettings ? [{
      id: "quotation-settings",
      title: "Quotation Settings",
      children: [
        { id: "quotation-general", title: "General", wide: true, render: () => <QuotationGeneralSettingsPanel canWrite unsavedRef={quotationGeneralUnsavedRef} onNotice={setSectionNotice} onError={setLinkError} /> },
        ...QUOTATION_BRANDS.map((brand) => ({
          id: `quotation-brand-${brand.code}`,
          title: brand.label,
          wide: true,
          render: () => <QuotationBrandSettingsPanel key={brand.code} code={brand.code} canWrite unsavedRef={quotationBrandUnsavedRef} onNotice={setSectionNotice} onError={setLinkError} />,
        })),
      ],
    }] : []),
    /*
     * What the studio pays for a referral.
     *
     * A plain screen rather than a group: one figure and a Save, so there is nothing under it to
     * list. It moved here out of the Employee Referral register's own ⋮ — the studio would rather
     * find its settings in one place than have each screen carry its own.
     *
     * On `HRM / Employee Referral`, the permission its routes enforce, rather than on the System
     * Settings write the sections around it use. See `canReadReferrals` above.
     */
    ...(canReadReferrals && canReadReferralSetting ? [{
      id: "employee-referral",
      title: "Employee Referral",
      render: () => <ReferralAmountPanel
        canWrite={canWriteReferrals}
        unsavedRef={referralAmountUnsavedRef}
        onNotice={setSectionNotice}
        onError={setLinkError}
      />,
    }] : []),
    /*
     * The wording of the messages the studio sends, under one **Templates** entry.
     *
     * These were three entries on the rail for a while, split out of a group because the group cost
     * a click to reach the one everybody edits and hid the others behind a title that named a
     * category rather than a message. Gathered again on the studio's own reading: three rail entries
     * whose titles all end in "Template" read as three unrelated screens, and what somebody looks
     * for is "the templates" before they look for which one. The click back is the trade, and a
     * fourth message the CRM learns to send now joins them here rather than lengthening the rail.
     *
     * All three are the **copy-and-send** wording - what somebody pastes into WhatsApp - and not the
     * emails the application sends itself. The invite and the credentials both still send their own
     * email with its own wording; these are the versions handed over by a person, which is the copy
     * that has to work when the mail quota is spent or the mail never arrives.
     *
     * The children keep their own ids, so the unsaved-changes map above and any link into one of
     * them still names the same screen. Their titles drop the word the parent now carries.
     *
     * Offered on `SETTINGS / Message Template` **Read**, and editable on Read / Write.
     *
     * It was offered on write alone, which quietly made Read a level nobody could hold to any
     * effect: the endpoint behind these panels serves a reader - `routes.js` guards the GET with
     * `checkAnyPermission` at READ, deliberately, so the accounts screen can show the receipt
     * wording it did not write - and the rail then hid the section from the one person the level
     * was granted to. A permission that opens nothing is the shape Rule 4 calls an unfinished
     * change, and the panel already had the read-only rendering: `MessageTemplatePanel` takes
     * `canWrite`, greys the field and drops the Save.
     *
     * So visibility answers to Read and editability to Read / Write, which is what the two levels
     * mean everywhere else.
     */
    ...(canReadMessageTemplates ? [{
      id: "templates",
      title: "Templates",
      children: [
        {
          id: "message-cash-received",
          title: "Cash Received",
          render: () => <MessageTemplatePanel
            templateKey="CASH_RECEIVED"
            canWrite={canWriteMessageTemplates}
            unsavedRef={messageTemplateUnsavedRef}
            onNotice={setSectionNotice}
            onError={setLinkError}
          />,
        },
        {
          id: "message-employee-invite",
          title: "Employee Invite",
          render: () => <MessageTemplatePanel
            templateKey="EMPLOYEE_ONBOARDING_INVITE"
            canWrite={canWriteMessageTemplates}
            unsavedRef={messageTemplateUnsavedRef}
            onNotice={setSectionNotice}
            onError={setLinkError}
          />,
        },
        {
          id: "message-login-credentials",
          title: "Login Credentials",
          render: () => <MessageTemplatePanel
            templateKey="LOGIN_CREDENTIALS"
            canWrite={canWriteMessageTemplates}
            unsavedRef={messageTemplateUnsavedRef}
            onNotice={setSectionNotice}
            onError={setLinkError}
          />,
        },
      ],
    }] : []),
    /*
     * Studio Branding, last, after Project Settings.
     *
     * It was an entry under User Settings, which was the wrong place twice over: it is one record
     * for the whole studio rather than anything belonging to the person signed in, and its routes
     * answer for ADMIN / System Settings - so a role without that write was shown a form whose Save
     * the server would refuse. Here it sits with the rest of what an administrator configures, and
     * is offered on the permission that actually governs it.
     *
     * A group rather than the single screen it used to be, and named for what all of it is: the
     * studio as an organisation — what it is called, what it looks like, and the branches it works
     * out of. "Branding" named only the first of those and read oddly above a list of branches. The
     * logo screen keeps the id it had, so an unsaved edit is still recognised, a deep link still
     * lands, and the section somebody was last on is still remembered.
     *
     * The logo panel keeps its own Save rather than borrowing the footer, because it writes the
     * moment it is pressed - it stages nothing, which is what Project Settings above needs a
     * footer for.
     */
    ...(canWriteOrganization ? [{
      id: "organization",
      title: "Organization",
      children: [
        { id: "studio-branding", title: "Branding Logo", render: () => <StudioBrandingPanel unsavedRef={studioBrandingUnsavedRef} onNotice={setSectionNotice} onError={setLinkError} /> },
        { id: "branches", title: "Branches", render: () => <BranchesPanel /> },
      ],
    }] : []),
    /*
     * Holidays: the days the studio declares itself closed.
     *
     * With Organization rather than under HRM, and that is the whole point of the move. It used to
     * be a date-and-name list on the HRM attendance rules screen, behind HRM / Attendance
     * Approval — which made a company-declared holiday look like an attendance decision about one
     * person. It is neither: it is a fact about the studio, like its branches and its branding, so
     * it is written here and answers for ADMIN / System Settings, exactly as its routes do.
     *
     * Offered on read as well as write, unlike the sections around it: the list is worth being
     * able to look up without being able to change it, and the panel drops its Add, its Edit and
     * its Remove without the write rather than offering controls the server would refuse.
     */
    ...(canReadHolidays ? [{
      id: "holidays",
      title: "Holidays",
      render: () => <HolidaysPanel
        canWrite={canWriteHolidays}
        onNotice={setSectionNotice}
        onError={setLinkError}
      />,
    }] : []),
    /*
     * Login Slide, beside Organization: the pictures the sign-in page turns through. The same
     * studio-wide record and the same permission, so the same gate.
     */
    ...(canWriteLoginSlide ? [{
      id: "login-slide",
      title: "Login Slide",
      render: () => <LoginSlidePanel unsavedRef={loginSlideUnsavedRef} />,
    }] : []),
    /*
     * Application Monitoring, last: the two above are what the studio looks like, this is how it
     * is measured.
     *
     * Gated on the same ADMIN / System Settings write those are: the one number it holds is a
     * studio-wide switch, and it decides what every usage figure on Reports & Analytics means. The
     * panel reads `canEdit` from the server as well and shows the value read-only without it, so it
     * stays honest wherever else it is reached from.
     */
    ...(canWriteMonitoring ? [{
      id: "application-monitoring",
      title: "Application Monitoring",
      render: () => <ApplicationMonitoringPanel unsavedRef={applicationMonitoringUnsavedRef} />,
    }] : []),
  ];

  // A group contributes its children as screens, not itself: pressing "Integrations" opens
  // the list under it, and it is CRM inside that list which has a page.
  /*
   * What this reader is actually offered here.
   *
   * Everything in this overlay except User Preference is the *studio's* settings, and an employee's
   * menu has never carried a way into it. The overlay is now reachable by everybody, because their
   * own sidebar order and appearance live in it — so the rule that used to be enforced by hiding
   * the way in is enforced here instead. Opening a door beside a room does not unlock the room.
   *
   * One rule in one place rather than a condition repeated on each studio section: a section added
   * later is covered the moment it is written, which is the failure this shape is chosen to avoid.
   */
  /*
   * The rail is whatever the sections above built, and nothing filters it afterwards.
   *
   * It used to be narrowed to User Preference alone for `role === "EMPLOYEE"` - the legacy role
   * column, not a permission. Every account the studio issues carries that value, so the filter
   * quietly overruled every grant above it: a role given Settings → Holidays still arrived here
   * with one entry, and no screen said why. That is the check CLAUDE.md Rule 4 forbids, and it
   * cannot be granted to anybody.
   *
   * Each section already carries its own `SETTINGS` permission, so a reader holding none of them
   * still lands on User Preference - which is theirs whatever their role - and a reader holding
   * one lands on it and that one.
   */
  const visibleSections = settingsSections;

  const railSections = withOverallGroup(visibleSections);
  const settingsScreens = railSections.flatMap(screensWithin);
  const openSection = settingsScreens.find((section) => section.id === activeSection) || settingsScreens[0];

  /*
   * Whether Project Settings is the screen on show, and whether leaving it would lose work.
   *
   * The group's three entries are one page, so moving between them only scrolls and keeps what is
   * staged; moving *out* of the group unmounts the panel, and the staged edits exist nowhere else.
   * That is the one move here that has to ask first, the same as the form builder above.
   */
  const onProjectSettings = isProjectSection(openSection.id);
  const leavingLosesProjectEdits = (id) => onProjectSettings && !isProjectSection(id) && projectSettingsState.dirty;



  // The move itself, once there is nothing left to ask about.
  function openSettingsSection(id) {
    setActiveSection(id);
    if (!isProjectSection(id)) return;
    /*
     * Inside Project Settings the rail scrolls rather than replacing the page. Done on the press
     * rather than from an effect on the chosen section, for two reasons: pressing the entry you are
     * already on still takes you back to it, and the highlight now moves with the scroll, so an
     * effect watching it would scroll again on every one of those moves.
     */
    if (projectSettingsState.loading) pendingProjectScrollRef.current = id;
    else scrollToProjectSection(id);
  }

  return createPortal(
    <>
      <SchemaFormPanel
        title="Settings"
        description="Application-wide settings and configuration tools."
        // Rail entries only — the screen itself is passed as the body below, so the rail lists every
        // section without stacking every section. A third element makes an entry a group.
        sections={railSections.map(railEntryFor)}
        activeSectionId={openSection.id}
        onSectionSelect={(id) => {
          // Any section holding an unsaved edit asks before it is left; the rest go straight
          // through, because a rail that questions every click stops being read. A section is only
          // asked about when the move actually leaves it.
          if (id !== activeSection && (sectionHoldsUnsavedEdits(activeSection) || leavingLosesProjectEdits(id))) {
            setPendingSection({ id });
            return;
          }
          openSettingsSection(id);
        }}
        values={{}}
        onChange={() => {}}
        errors={{}}
        sidebarAriaLabel="Settings sections"
        closeAriaLabel="Close settings"
        onClose={requestCloseSettings}
        /*
         * Nothing here saves as one form: Table Settings saves a vertical at a time, each linked
         * sheet is saved by its own dialog, and an excluded number is saved as it is added. So a
         * stray Enter in a field must not act as a submit - and most sections pass no footer at
         * all, since a bar across the bottom holding one Close button only repeated the X the
         * header already carries.
         */
        onSubmit={(event) => event.preventDefault()}
        /*
         * Project Settings is the exception, and keeps the footer it had as a screen of its own.
         *
         * Its three sections stage their edits and write them together, so there has to be a Save
         * to press - Close and Save, in that order, disabled until something is staged and while a
         * save is in flight, exactly as before. It is passed only while one of those sections is
         * on screen, so every other section still has no bar at the bottom.
         */
        footer={onProjectSettings ? <>
          <Button type="button" onClick={requestCloseSettings} disabled={projectSettingsState.busy}>Close</Button>
          <Button
            type="button"
            variant="primary"
            className="ml-auto"
            onClick={() => void projectSettingsRef.current?.save()}
            disabled={!projectSettingsState.dirty || projectSettingsState.busy}
          >
            {projectSettingsState.busy ? "Saving..." : "Save"}
          </Button>
        </> : undefined}
        // A failure leads with the red mark; something a section just did leads with the green tick.
        error={linkError ? { message: linkError, tone: "error" } : sectionNotice ? { message: sectionNotice, tone: "success" } : null}
        /*
         * The shared form-panel layer, the same as every other full-screen form in the app.
         *
         * It sat at z-140, one above the layer scale's `popover`, on the reasoning that the sheet
         * dialogs below it are at 150-165 and had to stay on top. They do - and 110 is under those
         * just as 140 was. What 140 also put it above was everything opened from *inside* it: a ⋮
         * menu is `menuOverPanel` (120) and a dialog is `dialogOverPanel` (130), both portalled to
         * `body`, so both were painted behind the panel that owns them. Pressing ⋮ on a service, a
         * deliverable, a size option or an HRM list appeared to do nothing; so did Add, whose
         * dialog was opening underneath as well. On the shared layer the whole ladder above it
         * works as it does everywhere else, and a date picker's calendar (`popover`, 140) no longer
         * ties with the panel it is opened in.
         */
        zIndexClassName={layers.formPanel}
      >
        {/* Only the section the rail is on. Wrapped in the shared section so its heading and
            padding match every other form in the app. */}
        {/* A section that brings its own headings is drawn as it is; everything else is wrapped in
            the shared one, so its heading and padding match every other form in the app. */}
        {openSection.raw ? openSection.render() : <SchemaFormSection id={openSection.id} title={openSection.title} wide={Boolean(openSection.wide)}>
          {openSection.render()}
        </SchemaFormSection>}

        {/* The question and the two answers, the way every other confirmation in the CRM asks.
            Cancel stays on Table Settings with the canvas untouched, so the work is still there
            to save; Discard lets the move through, and the builder unmounting is what throws the
            edits away. Closing the dialog is Cancel, so the answer that keeps the work is the
            one that needs no decision.

            Rendered inside the panel rather than beside it. A dialog is z-100 and this panel is
            z-140, so as a sibling it was painted behind the settings it was asking about - the
            rail click was refused and nothing appeared to say why. Inside, it stacks within the
            panel and lands over it, which is how the WhatsApp confirmations here already work. */}
        <ConfirmDialog
          open={Boolean(pendingSection)}
          title="Unsaved changes will be discarded"
          message="Go back if you want to save your settings."
          cancelLabel="Go Back"
          confirmLabel="Discard & Continue"
          onCancel={() => setPendingSection(null)}
          onConfirm={() => {
            const next = pendingSection;
            setPendingSection(null);
            // The edit goes with the panel - the builder's canvas, the sidebar draft, the branding
            // fields - so the section being left is told to stop claiming it holds one.
            forgetUnsavedEdits(activeSection);
            if (next?.kind === "close") { closeSettings(); return; }
            openSettingsSection(next?.id);
          }}
        />
      </SchemaFormPanel>

    </>,
    document.body,
  );
}
