"use client";

import { useEffect, useState } from "react";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import HelpTip from "@/components/shared/HelpTip";
import RadioGroupField from "@/components/shared/RadioGroupField";
import Dialog from "@/components/ui/Dialog";
import SharedDateField from "@/components/shared/DateField";
import SharedDropdown from "@/components/shared/Dropdown";
import SharedTextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import CloseIcon from "@/components/ui/CloseIcon";
import { copyToClipboard } from "@/lib/clipboard";
import { getMasterData } from "@/services/hrm/master-data.service";
import useBranchRegistry from "@/components/shared/useBranchRegistry";
import useFormErrors from "@/components/shared/useFormErrors";
import { searchSalesEnquiries } from "@/services/sales/projects.service";
import EnquiryCombobox from "@/components/sales/EnquiryCombobox";
import { buildGroupName, groupNameRequirements, hasValue, quaQuaEvents } from "./whatsappGroupNameUtils";

/*
 * What the tiers were before the studio could name them: an array read in one place, the Tier a Dum
 * Dum group name is minted with. It is edited in Settings -> Field Settings -> Sales Manager -> Tier
 * now, and this stands in when that list cannot be read - a blank Tier is a required field with
 * nothing in it, and no name could be generated at all.
 */
const FALLBACK_TIERS = ["1t1", "2t2", "3t3", "4t4", "5t5"];

// What each required field says under its box when Save finds it empty.
const MISSING_MESSAGES = {
  enquiryId: "Choose the enquiry.",
  tier: "Choose a tier.",
  branch: "Choose a branch.",
  groomName: "Enter the groom's name.",
  brideName: "Enter the bride's name.",
  socialMediaPosting: "Choose NSM or SM.",
  place: "Enter the place.",
  clientName: "Enter the client's name.",
  eventName: "Choose the event.",
  houseType: "Choose the house type.",
  gou: "Choose Yes or No.",
  mainEventDate: "Choose the main event date.",
};

function initialForm() {
  /*
   * Social Media Posting starts on NSM rather than on nothing.
   *
   * It is required, so a blank was one more field to answer before the name would build, on a form
   * where every other choice with an obvious starting point already has one. NSM is the cautious
   * half of the pair: a group is marked SM only when somebody says so, so a client is never
   * labelled as agreeing to be posted about by a form that was left alone.
   */
  return { groupType: "Dum Dum", enquiryId: "", tier: "", branch: "", offerName: "", clientName: "", groomName: "", brideName: "", eventName: "", socialMediaPosting: "NSM", houseType: "", gou: "", place: "", mainEventDateKnown: false, mainEventDate: "" };
}

export default function WhatsappGroupNameDialog({ onClose, onSave }) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const fields = useFormErrors();
  // Only for a copy that failed: a success is drawn on the button itself, as a tick.
  const { notice, showError, clearNotice } = useNotice();
  const [isSaving, setIsSaving] = useState(false);
  /*
   * The branches this CRM may name a group after: the `locations` master data, which the server
   * already narrows to the branches the caller's roles reach - the same list every branch picker
   * in the app offers. Full names from the database rather than a hardcoded code list, so a new
   * branch appears here the day Admin adds it and nobody generates a name for a branch they
   * cannot see.
   */
  const [branches, setBranches] = useState([]);
  const [branchesError, setBranchesError] = useState("");
  // The register changing is what this dialog is waiting on: a branch added in Settings should be
  // one a name can be generated for without the page being reloaded.
  const branchRegistryRevision = useBranchRegistry();

  useEffect(() => {
    let cancelled = false;
    getMasterData("branches", { active: true })
      .then((response) => {
        if (cancelled) return;
        const names = (Array.isArray(response?.data) ? response.data : []).map((location) => location.name).filter(Boolean);
        setBranches(names);
      })
      .catch((requestError) => { if (!cancelled) setBranchesError(requestError.message || "Unable to load branches."); });
    return () => { cancelled = true; };
  }, [branchRegistryRevision]);

  /*
   * The tiers a Dum Dum group may be booked at. Read the same way as the branches above and for the
   * same reason: it is a list the studio maintains, so a tier added in Settings is one a name can be
   * generated for. An empty or failed read is left as no read at all, so the fallback stands.
   */
  const [tiers, setTiers] = useState(FALLBACK_TIERS);
  useEffect(() => {
    let cancelled = false;
    getMasterData("tiers", { active: true })
      .then((response) => {
        if (cancelled) return;
        const names = (Array.isArray(response?.data) ? response.data : []).map((tier) => tier.name).filter(Boolean);
        if (names.length) setTiers(names);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /*
   * The CRM lead this name is being prepared for, searched as it is typed - the same picker and
   * the same lead-backed search Create Project uses, debounced so a fast typist is one request,
   * not one per keystroke.
   */
  const [enquiries, setEnquiries] = useState([]);
  const [isLoadingEnquiries, setIsLoadingEnquiries] = useState(false);
  // How many enquiries there are behind the page the answer returned, so a list that stops at its
  // page can say so rather than reading as one that has lost entries.
  const [enquiryPage, setEnquiryPage] = useState({ total: 0, capped: false });
  // What is being looked for, which is not the lead that has been chosen — see `EnquiryCombobox`.
  // A name is generated *for* a lead, so the id it carries has to be one the CRM actually holds.
  const [enquirySearch, setEnquirySearch] = useState(() => form.enquiryId || "");

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoadingEnquiries(true);
      try {
        const response = await searchSalesEnquiries(enquirySearch.trim());
        if (!cancelled) {
          setEnquiries(Array.isArray(response?.data) ? response.data : []);
          setEnquiryPage({ total: Number(response?.total) || 0, capped: Boolean(response?.capped) });
        }
      } catch {
        if (!cancelled) { setEnquiries([]); setEnquiryPage({ total: 0, capped: false }); }
      } finally {
        if (!cancelled) setIsLoadingEnquiries(false);
      }
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enquirySearch]);
  const generatedName = buildGroupName(form);
  /*
   * What is still missing, asked of the same list Save checks: the copy button turns on when this
   * empties, and Save marks each of these under its box when it does not. Two separate lists would
   * eventually disagree, and the way that shows up is a name that copies but will not save.
   */
  const missingFields = groupNameRequirements(form).filter(([field]) => !hasValue(form[field])).map(([, label]) => label);
  /*
   * The button waits for every required field, which is the same bar Save clears.
   *
   * `buildGroupName` already returns "" until they are all in - the box shows its placeholder until
   * then - so this is mostly about what the button says rather than what it would copy: one that
   * looked ready while the box was empty would put nothing on the clipboard and report success. The
   * name is checked as well as the field list so an empty one can never be handed over, whichever
   * of the two reasons it is empty for.
   */
  const canCopy = missingFields.length === 0 && Boolean(generatedName);
  /*
   * The tick the button turns into once the name is on the clipboard, and back to the copy mark a
   * couple of seconds later. A tick that stayed would read as a state the row is in rather than as
   * something that just happened, and there would be no way to tell a second copy had worked.
   */
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // Editing anything makes the name a different one, so the tick stops describing what is on the
  // clipboard and goes back to being an offer to copy.
  function update(field, value) {
    setCopied(false);
    fields.clear(field);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function copyGeneratedName() {
    const done = await copyToClipboard(generatedName);
    setCopied(done);
    /*
     * Only a failure is spoken. The tick says the copy worked, which is all a success has to say,
     * and a snackbar on top of it would report one action twice. A failure cannot be drawn - there
     * is no icon for "the browser would not let me" - so it keeps its words, and says what to do
     * instead: the box beside the button selects its whole contents when focused.
     */
    if (!done) showError("Unable to copy. Select the group name manually.");
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    const problems = Object.fromEntries(groupNameRequirements(form).map(([field, label]) => [field, hasValue(form[field]) ? "" : (MISSING_MESSAGES[field] || `Enter ${label}.`)]));
    if (!fields.check(problems)) return;
    setIsSaving(true);
    try {
      await onSave(form);
    } catch (saveError) {
      setError(saveError.message || "Unable to save W/A group name.");
    } finally {
      setIsSaving(false);
    }
  }

  return <Dialog
    title="W/A Group-Name Generator"
    description="Create and save an available WhatsApp group name for a future project."
    size="xl"
    layer="dialogOverPanel"
    busy={isSaving}
    onClose={onClose}
    onSubmit={submit}
    footer={<>
      <Button className="max-sm:flex-1" type="button" disabled={isSaving} onClick={onClose}>Cancel</Button>
      <Button className="max-sm:flex-1" variant="primary" disabled={isSaving}>{isSaving ? "Saving..." : "Save Group Name"}</Button>
    </>}
  >
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {(error || branchesError || fields.summary) && <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error || branchesError || fields.summary}</p>}
    <div className="grid gap-4 md:grid-cols-2"><RadioField label="Group Type" helperText="The brand this group is for; it decides the fields below." value={form.groupType} onChange={(value) => { fields.clearAll(); update("groupType", value); }} options={["Dum Dum", "Qua Qua", "Corp"]} required /><EnquiryCombobox label="Enquiry ID" helperText="Pick the client's enquiry; its branch fills in for you." required value={form.enquiryId} error={fields.errors.enquiryId} enquiries={enquiries} loading={isLoadingEnquiries} capped={enquiryPage.capped} total={enquiryPage.total} onSearch={setEnquirySearch} onSelect={(item) => { fields.clear("enquiryId"); if (item.sourceBranch && branches.includes(item.sourceBranch)) fields.clear("branch"); setForm((current) => ({ ...current, enquiryId: item.enquiryId || current.enquiryId, branch: item.sourceBranch && branches.includes(item.sourceBranch) ? item.sourceBranch : current.branch })); }} />{form.groupType === "Dum Dum" && <DumDumFields form={form} errors={fields.errors} onChange={update} branches={branches} tiers={tiers} />}{form.groupType === "Qua Qua" && <QuaQuaFields form={form} errors={fields.errors} onChange={update} branches={branches} />}{form.groupType === "Corp" && <CorpFields form={form} errors={fields.errors} onChange={update} branches={branches} />}<div className="md:col-span-2">
      <label className="block text-[11px] font-semibold text-slate-600 sm:text-xs">Generated WhatsApp Group Name<HelpTip text="Built from the fields above; copy it to name the client's WhatsApp group." />
        {/* The name and its Copy button on one row, and stacked below `sm` - side by side on a
            phone the button would squeeze the name it is there to hand over. */}
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input readOnly value={generatedName} onFocus={(event) => event.target.select()} placeholder="Complete the generator fields to preview the group name" className="block min-h-11 w-full min-w-0 flex-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-900 outline-none placeholder:font-normal placeholder:text-emerald-700/60" />
          {/* The mark alone, no word beside it: the copy symbol is the one icon every reader
              already knows from every other box like this, and the tick that replaces it says the
              copy landed without a label having to change under the cursor.

              Disabled rather than absent: it is the reason this row exists, and a button that only
              appeared once the form was finished would give no clue that finishing it is what is
              wanted. `title` and `aria-label` both carry what the icon cannot - what it does, and
              why it is off when it is - since an icon with no words explains nothing on its own. */}
          <button
            type="button"
            onClick={copyGeneratedName}
            disabled={!canCopy}
            aria-label={canCopy ? "Copy the group name" : "Copy the group name - complete the required fields first"}
            title={canCopy ? "Copy the group name" : `Complete required fields: ${missingFields.join(", ")}.`}
            className={`flex min-h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 ${copied ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"} max-sm:w-full`}
          >
            {copied
              ? <CheckRoundedIcon sx={{ fontSize: 20 }} />
              : <ContentCopyRoundedIcon sx={{ fontSize: 18 }} />}
          </button>
        </div>
      </label>
      {/* An icon swapping for another is silent to a screen reader, so the one thing the button no
          longer says in words is said here instead. */}
      <p aria-live="polite" className="sr-only">{copied ? "Group name copied to the clipboard." : ""}</p>
    </div></div>
  </Dialog>;
}

function DumDumFields({ form, errors, onChange, branches, tiers }) {
  return <><SelectField label="Tier" helperText="The tier the wedding is booked at; it goes into the name." value={form.tier} error={errors.tier} onChange={(value) => onChange("tier", value)} options={tiers} required /><SelectField label="Branch" helperText="The branch handling this booking; its code goes into the name." value={form.branch} error={errors.branch} onChange={(value) => onChange("branch", value)} options={branches} required /><TextField label="Groom Name" helperText="The groom's name as it should read in the group name." value={form.groomName} error={errors.groomName} onChange={(value) => onChange("groomName", value)} required /><TextField label="Bride Name" helperText="The bride's name as it should read in the group name." value={form.brideName} error={errors.brideName} onChange={(value) => onChange("brideName", value)} required /><TextField label="Offer Name" helperText="The offer the client booked under, if any; added to the name." value={form.offerName} onChange={(value) => onChange("offerName", value)} /><RadioField label="Social Media Posting" helperText="SM if the client allows social media posting, NSM if not." value={form.socialMediaPosting} error={errors.socialMediaPosting} onChange={(value) => onChange("socialMediaPosting", value)} options={["NSM", "SM"]} required /><TextField label="Place" helperText="The town or venue of the event; added to the group name." value={form.place} error={errors.place} onChange={(value) => onChange("place", value)} required /><DateField form={form} error={errors.mainEventDate} onChange={onChange} /></>;
}

function QuaQuaFields({ form, errors, onChange, branches }) {
  return <><SelectField label="Branch" helperText="The branch handling this booking; its code goes into the name." value={form.branch} error={errors.branch} onChange={(value) => onChange("branch", value)} options={branches} required /><TextField label="Offer Name" helperText="The offer the client booked under, if any; added to the name." value={form.offerName} onChange={(value) => onChange("offerName", value)} /><TextField label="Client Name" helperText="The client's name as it should read in the group name." value={form.clientName} error={errors.clientName} onChange={(value) => onChange("clientName", value)} required /><SelectField label="Event" helperText="The event being shot; added to the group name." value={form.eventName} error={errors.eventName} onChange={(value) => onChange("eventName", value)} options={quaQuaEvents} required /><RadioField label="Social Media Posting" helperText="SM if the client allows social media posting, NSM if not." value={form.socialMediaPosting} error={errors.socialMediaPosting} onChange={(value) => onChange("socialMediaPosting", value)} options={["NSM", "SM"]} required /><RadioField label="House Type" helperText="IH or OH, as booked; added to the group name." value={form.houseType} error={errors.houseType} onChange={(value) => onChange("houseType", value)} options={["IH", "OH"]} required /><RadioField label="GOU" helperText="Yes adds GOU to the group name; No leaves it out." value={form.gou} error={errors.gou} onChange={(value) => onChange("gou", value)} options={["Yes", "No"]} required /><TextField label="Place" helperText="The town or venue of the event; added to the group name." value={form.place} error={errors.place} onChange={(value) => onChange("place", value)} required /><DateField form={form} error={errors.mainEventDate} onChange={onChange} /></>;
}

function CorpFields({ form, errors, onChange, branches }) {
  return <><SelectField label="Branch" helperText="The branch handling this booking; its code goes into the name." value={form.branch} error={errors.branch} onChange={(value) => onChange("branch", value)} options={branches} required /><TextField label="Offer Name" helperText="The offer the client booked under, if any; added to the name." value={form.offerName} onChange={(value) => onChange("offerName", value)} /><TextField label="Client Name" helperText="The client's name as it should read in the group name." value={form.clientName} error={errors.clientName} onChange={(value) => onChange("clientName", value)} required /><TextField label="Place" helperText="The town or venue of the event; added to the group name." value={form.place} error={errors.place} onChange={(value) => onChange("place", value)} required /><DateField form={form} error={errors.mainEventDate} onChange={onChange} /></>;
}

function TextField({ label, value, onChange, required, error, helperText }) { return <SharedTextField label={label} required={required} helperText={helperText} value={value} error={error} onChange={(event) => onChange(event.target.value)} />; }
/*
 * The generator's closed lists: Branch, Tier and Event.
 *
 * `searchable`, which they were not. Typing filters the list rather than becoming the answer - the
 * value is only ever one that was chosen - so this adds a way to find an option and no way to
 * invent one, which is the same shape the Assigned Branch picker on the CRM board uses.
 *
 * On the helper rather than on Branch alone, because all three lists have the same want and one of
 * them has it badly: Event offers forty options, which is a scroll to find "Naming Ceremony" in.
 * Branch is the one that was asked for; Event is the one that needed it most.
 *
 * `aria-label` falls back to `label` inside `Dropdown`, so the combobox each of these becomes is
 * still named by the same word it was named by before.
 */
function SelectField({ label, value, onChange, options, required, error, helperText }) { return <SharedDropdown mode="input" searchable label={label} required={required} helperText={helperText} placeholder="Select" value={value} error={error} onChange={onChange} options={options.map((option) => ({ label: option, value: option }))} />; }
/*
 * The shared radio group wears a bigger label and a taller box than the text fields beside it,
 * which left every row with a radio on one side sitting lower than its neighbour. Dressed here in
 * the exact label and control metrics TextField, Dropdown and DateField share - 11px semibold
 * label, mt-1.5, min-h-9 rounded-lg box - so the two columns line up whatever mix a row holds.
 */
function RadioField(props) {
  return <RadioGroupField {...props} className="text-[11px] font-semibold text-slate-600 sm:text-xs" controlClassName="!mt-1.5 !min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-0" />;
}
/*
 * The main event date, and whether the studio knows it yet.
 *
 * A group is often opened before the couple have fixed the day. The field used to insist on a date
 * and tell people to enter an approximate one, which put a guessed day into a group name that then
 * travelled to WhatsApp as fact. Off - which is where it starts - the date is not asked for and the
 * generated name simply carries none; turning it on asks for the real one and requires it.
 *
 * Switching back off clears what was typed, so a date nobody is claiming to know cannot be saved
 * from a field that is no longer on screen.
 *
 * The pair spans both columns and wraps rather than stacking: the toggle is a narrow control, so on
 * anything wider than a phone the date sits in the space to its right instead of leaving half the
 * dialog blank beside it and dropping to a line of its own. Where that space runs out the date
 * takes the full width and falls underneath, which is the same rule the rest of the form follows.
 */
function DateField({ form, error, onChange }) {
  return <div className="md:col-span-2">
    <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
      <div>
        <span className="block text-[11px] font-semibold text-slate-600 sm:text-xs">Main Event Date Known</span>
        <div className="mt-1.5 flex min-h-9 items-center">
          <ToggleSwitch
            checked={Boolean(form.mainEventDateKnown)}
            ariaLabel="Main event date known"
            helperText="Turn on once the day is fixed, to add the date to the name."
            size="sm"
            label={form.mainEventDateKnown ? "Yes" : "No"}
            onCheckedChange={(checked) => {
              onChange("mainEventDateKnown", checked);
              if (!checked) onChange("mainEventDate", "");
            }}
          />
        </div>
      </div>
      {/* Full width on a phone, which is what makes it wrap onto its own line there; a fixed
          column beside the toggle everywhere else. */}
      {form.mainEventDateKnown && <div className="w-full sm:w-72">
        <SharedDateField label="Main Event Date" required helperText="The fixed day of the main event; added to the group name." value={form.mainEventDate} error={error} onChange={(value) => onChange("mainEventDate", value)} />
      </div>}
    </div>
  </div>;
}
