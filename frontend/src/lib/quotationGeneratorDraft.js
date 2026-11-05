/**
 * A quotation drafted somewhere else, waiting for the Quotation Generator to open on it.
 *
 * The CRM's Quotation Calculator builds one and sends the person to Sales → Quotations, where the
 * generator opens already filled in; the calculator is a way of starting a quotation, and the
 * generator stays the one place a quotation is raised. Handed over through session storage, the
 * way My Profile remembers where to go back to (`profileReturn.js`): it is the two screens on two
 * routes, so React state cannot carry it, a query string is no place for a quotation, and nothing
 * is written to the server until Generate Quotation is pressed. Session storage lasts the tab and
 * no longer, and the draft is taken - read and removed - the moment the generator picks it up, so
 * a later visit to Quotations does not reopen a form somebody already dealt with.
 */
const KEY = "dbs.quotation.generatorDraft";

const storage = () => (typeof window === "undefined" ? null : window.sessionStorage);

export function stashQuotationGeneratorDraft(draft) {
  const store = storage();
  if (!store || !draft) return;
  store.setItem(KEY, JSON.stringify(draft));
}

/** The waiting draft, removed as it is read, or null when nothing is waiting. */
export function takeQuotationGeneratorDraft() {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(KEY);
  if (!raw) return null;
  store.removeItem(KEY);
  try {
    const draft = JSON.parse(raw);
    return draft && typeof draft === "object" ? draft : null;
  } catch {
    return null;
  }
}
