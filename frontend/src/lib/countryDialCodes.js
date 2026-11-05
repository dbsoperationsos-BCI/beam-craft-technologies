/**
 * Country dialling codes, for the picker beside every phone field in the CRM.
 *
 * The studio's clients are overwhelmingly Indian, so `+91` is the default everywhere and the one
 * a field starts on. The rest are here because a destination wedding, an NRI enquiry or a
 * corporate client abroad is a normal Tuesday, and typing a code by hand is how "+1" becomes
 * "1" and a number stops matching the lead it belongs to.
 *
 * The flag is derived from the country's own two-letter code rather than shipped as an image:
 * the regional-indicator letters are what an emoji font turns into a flag, so this needs no
 * sprite sheet, no icon package and no network request. On a platform whose font has no flags -
 * Windows, mainly - it renders as the two letters instead, which still says which country it is.
 */

// One entry per country: ISO 3166-1 alpha-2, the dialling code, and the name it is listed under.
// Sorted by name where it is shown; India leads the list on its own because it is the default.
const COUNTRIES = [
  ["IN", "+91", "India"],
  ["AF", "+93", "Afghanistan"], ["AL", "+355", "Albania"], ["DZ", "+213", "Algeria"],
  ["AD", "+376", "Andorra"], ["AO", "+244", "Angola"], ["AI", "+1264", "Anguilla"],
  ["AG", "+1268", "Antigua and Barbuda"], ["AR", "+54", "Argentina"], ["AM", "+374", "Armenia"],
  ["AW", "+297", "Aruba"], ["AU", "+61", "Australia"], ["AT", "+43", "Austria"],
  ["AZ", "+994", "Azerbaijan"], ["BS", "+1242", "Bahamas"], ["BH", "+973", "Bahrain"],
  ["BD", "+880", "Bangladesh"], ["BB", "+1246", "Barbados"], ["BY", "+375", "Belarus"],
  ["BE", "+32", "Belgium"], ["BZ", "+501", "Belize"], ["BJ", "+229", "Benin"],
  ["BM", "+1441", "Bermuda"], ["BT", "+975", "Bhutan"], ["BO", "+591", "Bolivia"],
  ["BA", "+387", "Bosnia and Herzegovina"], ["BW", "+267", "Botswana"], ["BR", "+55", "Brazil"],
  ["BN", "+673", "Brunei"], ["BG", "+359", "Bulgaria"], ["BF", "+226", "Burkina Faso"],
  ["BI", "+257", "Burundi"], ["KH", "+855", "Cambodia"], ["CM", "+237", "Cameroon"],
  ["CA", "+1", "Canada"], ["CV", "+238", "Cape Verde"], ["KY", "+1345", "Cayman Islands"],
  ["CF", "+236", "Central African Republic"], ["TD", "+235", "Chad"], ["CL", "+56", "Chile"],
  ["CN", "+86", "China"], ["CO", "+57", "Colombia"], ["KM", "+269", "Comoros"],
  ["CG", "+242", "Congo"], ["CD", "+243", "Congo (DRC)"], ["CR", "+506", "Costa Rica"],
  ["CI", "+225", "Côte d'Ivoire"], ["HR", "+385", "Croatia"], ["CU", "+53", "Cuba"],
  ["CY", "+357", "Cyprus"], ["CZ", "+420", "Czechia"], ["DK", "+45", "Denmark"],
  ["DJ", "+253", "Djibouti"], ["DM", "+1767", "Dominica"], ["DO", "+1809", "Dominican Republic"],
  ["EC", "+593", "Ecuador"], ["EG", "+20", "Egypt"], ["SV", "+503", "El Salvador"],
  ["GQ", "+240", "Equatorial Guinea"], ["ER", "+291", "Eritrea"], ["EE", "+372", "Estonia"],
  ["ET", "+251", "Ethiopia"], ["FJ", "+679", "Fiji"], ["FI", "+358", "Finland"],
  ["FR", "+33", "France"], ["GA", "+241", "Gabon"], ["GM", "+220", "Gambia"],
  ["GE", "+995", "Georgia"], ["DE", "+49", "Germany"], ["GH", "+233", "Ghana"],
  ["GI", "+350", "Gibraltar"], ["GR", "+30", "Greece"], ["GD", "+1473", "Grenada"],
  ["GT", "+502", "Guatemala"], ["GN", "+224", "Guinea"], ["GY", "+592", "Guyana"],
  ["HT", "+509", "Haiti"], ["HN", "+504", "Honduras"], ["HK", "+852", "Hong Kong"],
  ["HU", "+36", "Hungary"], ["IS", "+354", "Iceland"], ["ID", "+62", "Indonesia"],
  ["IR", "+98", "Iran"], ["IQ", "+964", "Iraq"], ["IE", "+353", "Ireland"],
  ["IL", "+972", "Israel"], ["IT", "+39", "Italy"], ["JM", "+1876", "Jamaica"],
  ["JP", "+81", "Japan"], ["JO", "+962", "Jordan"], ["KZ", "+7", "Kazakhstan"],
  ["KE", "+254", "Kenya"], ["KW", "+965", "Kuwait"], ["KG", "+996", "Kyrgyzstan"],
  ["LA", "+856", "Laos"], ["LV", "+371", "Latvia"], ["LB", "+961", "Lebanon"],
  ["LS", "+266", "Lesotho"], ["LR", "+231", "Liberia"], ["LY", "+218", "Libya"],
  ["LI", "+423", "Liechtenstein"], ["LT", "+370", "Lithuania"], ["LU", "+352", "Luxembourg"],
  ["MO", "+853", "Macau"], ["MG", "+261", "Madagascar"], ["MW", "+265", "Malawi"],
  ["MY", "+60", "Malaysia"], ["MV", "+960", "Maldives"], ["ML", "+223", "Mali"],
  ["MT", "+356", "Malta"], ["MU", "+230", "Mauritius"], ["MX", "+52", "Mexico"],
  ["MD", "+373", "Moldova"], ["MC", "+377", "Monaco"], ["MN", "+976", "Mongolia"],
  ["ME", "+382", "Montenegro"], ["MA", "+212", "Morocco"], ["MZ", "+258", "Mozambique"],
  ["MM", "+95", "Myanmar"], ["NA", "+264", "Namibia"], ["NP", "+977", "Nepal"],
  ["NL", "+31", "Netherlands"], ["NZ", "+64", "New Zealand"], ["NI", "+505", "Nicaragua"],
  ["NE", "+227", "Niger"], ["NG", "+234", "Nigeria"], ["KP", "+850", "North Korea"],
  ["MK", "+389", "North Macedonia"], ["NO", "+47", "Norway"], ["OM", "+968", "Oman"],
  ["PK", "+92", "Pakistan"], ["PS", "+970", "Palestine"], ["PA", "+507", "Panama"],
  ["PG", "+675", "Papua New Guinea"], ["PY", "+595", "Paraguay"], ["PE", "+51", "Peru"],
  ["PH", "+63", "Philippines"], ["PL", "+48", "Poland"], ["PT", "+351", "Portugal"],
  ["PR", "+1787", "Puerto Rico"], ["QA", "+974", "Qatar"], ["RO", "+40", "Romania"],
  ["RU", "+7", "Russia"], ["RW", "+250", "Rwanda"], ["WS", "+685", "Samoa"],
  ["SA", "+966", "Saudi Arabia"], ["SN", "+221", "Senegal"], ["RS", "+381", "Serbia"],
  ["SC", "+248", "Seychelles"], ["SL", "+232", "Sierra Leone"], ["SG", "+65", "Singapore"],
  ["SK", "+421", "Slovakia"], ["SI", "+386", "Slovenia"], ["SO", "+252", "Somalia"],
  ["ZA", "+27", "South Africa"], ["KR", "+82", "South Korea"], ["SS", "+211", "South Sudan"],
  ["ES", "+34", "Spain"], ["LK", "+94", "Sri Lanka"], ["SD", "+249", "Sudan"],
  ["SR", "+597", "Suriname"], ["SE", "+46", "Sweden"], ["CH", "+41", "Switzerland"],
  ["SY", "+963", "Syria"], ["TW", "+886", "Taiwan"], ["TJ", "+992", "Tajikistan"],
  ["TZ", "+255", "Tanzania"], ["TH", "+66", "Thailand"], ["TG", "+228", "Togo"],
  ["TT", "+1868", "Trinidad and Tobago"], ["TN", "+216", "Tunisia"], ["TR", "+90", "Türkiye"],
  ["TM", "+993", "Turkmenistan"], ["UG", "+256", "Uganda"], ["UA", "+380", "Ukraine"],
  ["AE", "+971", "United Arab Emirates"], ["GB", "+44", "United Kingdom"],
  ["US", "+1", "United States"], ["UY", "+598", "Uruguay"], ["UZ", "+998", "Uzbekistan"],
  ["VE", "+58", "Venezuela"], ["VN", "+84", "Vietnam"], ["YE", "+967", "Yemen"],
  ["ZM", "+260", "Zambia"], ["ZW", "+263", "Zimbabwe"],
];

export const DEFAULT_DIAL_CODE = "+91";

/**
 * The flag for a country, from its own two-letter code.
 *
 * Each letter maps to its regional-indicator twin, and a font with flags draws the pair as one.
 * Nothing is downloaded and nothing is bundled.
 */
export function flagFor(isoCode) {
  const letters = String(isoCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(letters)) return "";
  return String.fromCodePoint(...[...letters].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/*
 * The options the picker lists.
 *
 * `value` is the country, not the dialling code: several countries share a code - +1 is the
 * United States, Canada and Puerto Rico - and keying on the code alone means picking one and
 * being shown another. The code travels on the option for whoever needs it.
 */
export const DIAL_CODE_OPTIONS = COUNTRIES.map(([iso, dial, name]) => ({
  value: iso,
  dial,
  name,
  flag: flagFor(iso),
  // What the menu row reads, and what a search matches against - so "united", "ae" and "971"
  // all find the United Arab Emirates.
  label: `${flagFor(iso)} ${name} ${dial}`,
}));

const BY_ISO = new Map(DIAL_CODE_OPTIONS.map((option) => [option.value, option]));

export function countryByIso(iso) {
  return BY_ISO.get(String(iso || "").toUpperCase()) || null;
}

/**
 * The country a stored dialling code belongs to.
 *
 * Longest code first, so "+1264" is Anguilla rather than the United States with an odd number
 * after it. Where a code is genuinely shared, the first country listed under it wins - which is
 * why the list is ordered with the larger country first for those.
 */
export function countryByDial(dial) {
  const code = String(dial || "").trim();
  if (!code) return null;
  const matches = DIAL_CODE_OPTIONS.filter((option) => option.dial === code);
  return matches[0] || null;
}

export default DIAL_CODE_OPTIONS;
