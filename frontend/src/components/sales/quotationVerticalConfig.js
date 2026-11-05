/**
 * The Client Details a quotation asks for, per vertical.
 *
 * The three verticals sell different things, so they ask about different people: Dum Dum quotes a
 * wedding and needs the groom and the bride, Qua Qua quotes a baby shoot and needs the baby and a
 * due date, Corp quotes an organisation and needs a company and who decides inside it. The rows
 * below mirror SALES -> CRM -> Add Lead so a field a salesperson knows from the CRM sits in the
 * same place, with the same label, when they raise the quotation.
 *
 * Held as data rather than JSX because three near-identical blocks of markup drift apart the
 * moment one of them is edited, and because the same list answers three separate questions:
 * what to render, what to clear when the vertical changes, and which keys belong to the payload.
 *
 * Field keys match the CRM's own lead columns, with one deliberate exception noted on
 * `babyContactNumber` below.
 */

/*
 * The branch a lead is assigned to is not written down here any more.
 *
 * It was `["Erode", "Tiruppur", "Coimbatore", "Bangalore", "Hyderabad", "Vizag"]`, mirroring the
 * CRM's own array - and neither list named a branch the studio has, which are `Erode TN`,
 * `Tiruppur TN`, `Coimbatore TN`, `Bangalore KA`, `Hyderabad TL` and `Visakhapatnam AP`. Owning
 * every list it renders was the wrong instinct for this one: the branches belong to the studio, are
 * maintained in Settings → Organization → Branches, and a copy here could only ever go stale.
 *
 * `QuotationVerticalFields` reads them through `useBranchOptions()`, which is what every branch
 * picker in Sales and the CRM now answers from.
 */

/*
 * The fallback only. Relationship and Referred From are lists the studio maintains in Settings ->
 * Field Settings -> Quotation, read by `useLeadSuggestionLists` for this screen and for CRM -> Add
 * Lead alike; these arrays are what the two fields always suggested, and stand in while the lists
 * load or for a table nobody has seeded. Both fields stay typed-with-suggestions - the list is
 * offered, and anything not on it can still be typed.
 */
/*
 * Category, on every vertical's quotation. The key is still `religion`, its original name, because
 * that is what every saved quotation's payload holds it under.
 *
 * Empty on purpose, unlike the two arrays below it. Those are fallbacks — the words the field always
 * suggested, standing in while the studio's list loads. There is no such list for a category: it
 * ships with none, and each brand's list is the studio's own, written under that brand's tab in
 * Settings → Field Settings → Sales & CRM → Quotations → Categories.
 *
 * So the dropdown is empty until that tab has entries, and the required check below tolerates
 * that — see `requiredFieldsFor`.
 */
export const religionOptions = [];

export const relationshipOptions = [
  "Self", "Bride", "Groom", "Father", "Mother", "Brother", "Sister", "Son", "Daughter",
  "Husband", "Wife", "Uncle", "Aunt", "Cousin", "Friend", "Relative", "Colleague",
  "Wedding Planner", "Event Manager", "Other",
];

export const referredFromOptions = [
  "Instagram", "WhatsApp", "Facebook", "Google", "Google Ads", "YouTube", "Website",
  "Walk-in", "Phone Enquiry", "Referral", "Friend", "Family", "Existing Client",
  "Wedding Planner", "Exhibition", "Hoarding", "Other",
];

export const offerTypeOptions = [
  "Haldi", "Bride Haldi", "Groom Haldi", "New Born", "Baby Shoot IH", "Baby Shoot OH",
  "Birthday Shoot", "Engagement", "Pre Wedding", "Mehandi", "Wedding", "Post Wedding",
  "Baby Shower", "Maternity IH", "Maternity OH", "Reception", "Couple Shoot IH",
  "Naming ceremony", "Family", "Corporate", "Wedding + Reception",
];

export const VERTICALS = ["Dum Dum", "Qua Qua", "Corp"];
export const DEFAULT_VERTICAL = "Dum Dum";

/*
 * The three fields every vertical opens with, in the order Add Lead puts them.
 *
 * `contactNumber` rather than the CRM's `phone`: a quotation has always stored the client's main
 * number under that key, so reusing it means a quotation raised before this screen existed still
 * opens with its number in the box instead of an empty field.
 */
/**
 * The Category every vertical asks for, from its own brand's list - see `religionOptions`.
 *
 * `searchable` because this list is the studio's own and has no ceiling: it ships empty, and each
 * brand's tab is filled in under Settings → Field Settings → Sales & CRM → Quotations →
 * Categories, so a studio that records twenty of them was scrolling a menu to reach one. Typing
 * filters it, the way Assigned Branch beside it already works.
 *
 * It stays a *closed* list. The box filters what the studio has written and takes nothing else, so
 * the answer is still one of that brand's own categories and never free text - which is the whole
 * reason this is a `select` and Relationship beside it is a `combo`.
 *
 * Opt-in per field rather than on every `select`: Offer Type is the only other one, its list is
 * written into this file and short, and a search box on it would be a control with nothing to do.
 */
const categoryField = { key: "religion", label: "Category", type: "select", required: true, searchable: true, options: religionOptions, helperText: "The client category, from this brand's list in Field Settings." };

const commonRow = [
  { key: "name", label: "Enquire Name", type: "text", required: true, helperText: "The name of the person who enquired, as on the lead." },
  { key: "contactNumber", label: "Contact", type: "phone", required: true, helperText: "The client's main number, printed on the quotation." },
  { key: "assignedBranch", label: "Assigned Branch", type: "branch", required: true, helperText: "The studio branch handling this client." },
];

/*
 * Rows, not a flat list: each inner array is one line of the form, so the grouping that makes a
 * wedding form readable - groom together, bride together - survives being written as data.
 */
export const verticalFieldRows = {
  "Dum Dum": [
    commonRow,
    [
      { key: "relationship", label: "Relationship", type: "combo", options: relationshipOptions, helperText: "How the person enquiring is related to the client; pick or type." },
      { key: "referredFrom", label: "Referred From", type: "combo", options: referredFromOptions, helperText: "Where the client heard of the studio; pick or type." },
      /*
       * Closed rather than typed, and mandatory - on every vertical, each from its own list.
       *
       * `select` where Relationship beside it is `combo`: a relationship the list's author never
       * thought of is still a real answer, while a category is picked from what the studio has
       * decided to record. Free text here would collect one question's answer three ways.
       * `requiredFieldsFor` waives it only while the brand's list is still empty.
       */
      categoryField,
    ],
    [
      { key: "groomName", label: "Groom Name", type: "text", helperText: "The groom's name for this wedding quotation." },
      { key: "groomContact", label: "Groom Contact", type: "phone", helperText: "A number to reach the groom on." },
      { key: "groomLocation", label: "Groom Location", type: "text", helperText: "The town or city the groom lives in." },
    ],
    [
      { key: "brideName", label: "Bride Name", type: "text", helperText: "The bride's name for this wedding quotation." },
      { key: "brideContact", label: "Bride Contact", type: "phone", helperText: "A number to reach the bride on." },
      { key: "brideLocation", label: "Bride Location", type: "text", helperText: "The town or city the bride lives in." },
    ],
    [
      { key: "referenceName", label: "Referenced Person Name", type: "text", helperText: "Who referred this client to the studio, if anyone." },
      { key: "referenceContact", label: "Reference Contact", type: "phone", helperText: "A number for the person who referred the client." },
    ],
  ],
  "Qua Qua": [
    commonRow,
    [
      { key: "relationship", label: "Relationship", type: "combo", options: relationshipOptions, helperText: "How the person enquiring is related to the client; pick or type." },
      { key: "referredFrom", label: "Referred From", type: "combo", options: referredFromOptions, helperText: "Where the client heard of the studio; pick or type." },
      { key: "offerType", label: "Offer Type", type: "select", options: offerTypeOptions, helperText: "The kind of shoot this quotation is for." },
    ],
    [
      { key: "babyOrMotherName", label: "Baby (or) Mother Name", type: "text", helperText: "The baby's name, or the mother's for a maternity shoot." },
      { key: "dateOfBirthOrEdod", label: "Date of Birth (or) EDOD", type: "date", required: true, helperText: "The baby's date of birth, or the expected delivery date." },
      /*
       * The CRM calls this one `contactNumber`, which the quotation payload already spends on the
       * client's main number. Renamed here so a Qua Qua quotation cannot overwrite the number the
       * whole record is reached on with the number beside the baby's name.
       */
      { key: "babyContactNumber", label: "Contact", type: "phone", helperText: "A number for the baby's family, kept apart from the main contact." },
    ],
    [
      { key: "location", label: "Location", type: "text", helperText: "The town or city the family lives in." },
      { key: "lastConvertedDate", label: "Last Converted Date", type: "date", helperText: "The date this client last converted to a booking, if ever." },
      categoryField,
    ],
  ],
  Corp: [
    commonRow,
    [
      { key: "companyName", label: "Company Name (or) Client organisation", type: "text", helperText: "The organisation the quotation is raised for." },
      { key: "primaryDecisionMaker", label: "Primary decision maker - Contact", type: "phone", helperText: "The number of the person who approves the booking." },
      { key: "designation", label: "Designation", type: "text", helperText: "The decision maker's job title in the organisation." },
    ],
    [
      { key: "companyWebsite", label: "Company Website", type: "text", helperText: "The organisation's website address, if it has one." },
      { key: "companyType", label: "Company Type", type: "text", helperText: "What kind of business the organisation is." },
      { key: "location", label: "Location", type: "text", placeholder: "Office / Factory / Hotel...etc", helperText: "Where the shoot will happen - office, factory, hotel or similar." },
    ],
    [
      { key: "officialEmailId", label: "Official Email ID", type: "text", helperText: "The organisation's work email for this enquiry." },
      { key: "referredFrom", label: "Referred From", type: "combo", options: referredFromOptions, helperText: "Where the client heard of the studio; pick or type." },
      { key: "expectedBudget", label: "Budget Expected", type: "text", helperText: "The budget the client mentioned for this work." },
    ],
    [categoryField],
  ],
};

/** Every field key any vertical can ask for, so switching vertical knows what to clear. */
export const allVerticalFieldKeys = Array.from(new Set(
  Object.values(verticalFieldRows).flat(2).map((field) => field.key),
));

/** Blank values for every vertical field, used to seed the form and to reset it. */
export function emptyVerticalValues() {
  return Object.fromEntries(allVerticalFieldKeys.map((key) => [key, ""]));
}

/**
 * The fields one vertical will not accept a quotation without, as `{ key, label }`.
 *
 * The shared field components draw the red asterisk from their `required` prop but do not set the
 * attribute on the input underneath, so the browser never blocks a submit on its own. The form
 * checks this list itself and names what is missing, which is also kinder than a native tooltip
 * on a field that may be scrolled out of view.
 */
/**
 * `available` is the options each field actually has to offer, keyed the way the rows are — what
 * `useLeadSuggestionLists` returns. A closed dropdown with an empty list is asked of nobody.
 *
 * Category is the case this exists for. It ships with no entries, so until the studio fills in
 * that brand's tab under Settings → Field Settings → Categories there is nothing a person could
 * pick — and a required field with an empty dropdown would make every quotation of that brand
 * impossible to generate. Omitted from the check while the brand's list is empty, and required the
 * moment it is not.
 *
 * Only closed lists are treated this way. A typed field with no suggestions can still be answered,
 * so `required` on one of those means exactly what it says.
 */
/**
 * The number fields this vertical asks - required or not - as `{ key, label }`. A number is never
 * required just because it is listed here; it only has to be whole once something is typed in it.
 */
export function phoneFieldsFor(vertical) {
  return (verticalFieldRows[vertical] || []).flat().filter((field) => field.type === "phone").map(({ key, label }) => ({ key, label }));
}

export function requiredFieldsFor(vertical, available = {}) {
  return (verticalFieldRows[vertical] || [])
    .flat()
    .filter((field) => field.required)
    .filter((field) => {
      if (field.type !== "select") return true;
      const options = available[field.key] ?? field.options ?? [];
      return options.length > 0;
    })
    .map(({ key, label }) => ({ key, label }));
}
