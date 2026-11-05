/**
 * Every row of a page-numbered list, read a page at a time.
 *
 * The Assets, Vendors and Client Storage registers draw their whole list in the table and the
 * board, but their endpoints answer one page (`?page=&limit=`, capped at 100) and used to be asked
 * once, so a studio with more than the default 50 saw the first 50 under a footer counting them all.
 *
 * `fetchPage(page, limit)` answers `{ data, pagination: { total, totalPages } }`. The pages are read
 * in turn until `totalPages`; the answer is the first page's (its counts, branches, `canImport`)
 * with `data` holding every row, de-duplicated by `id` so a row that shifts between two reads is
 * never drawn twice, and `pagination.total` the count of the rows actually returned - the footer
 * then always counts what is drawn.
 */
export const EVERY_PAGE_LIMIT = 100;

/** Stops a misbehaving endpoint from being read forever: 500 pages of 100 is 50,000 rows. */
const MAX_PAGES = 500;

export async function readEveryPage(fetchPage, limit = EVERY_PAGE_LIMIT) {
  const first = await fetchPage(1, limit);
  const seen = new Set();
  const rows = [];
  const add = (data) => (data || []).forEach((row) => {
    const key = row?.id;
    if (key !== undefined && key !== null) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    rows.push(row);
  });
  add(first?.data);
  const totalPages = Math.min(Number(first?.pagination?.totalPages) || 1, MAX_PAGES);
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchPage(page, limit);
    add(next?.data);
    // A page that came back empty means the list shrank while it was being read: nothing follows.
    if (!next?.data?.length) break;
  }
  return { ...first, data: rows, pagination: { ...(first?.pagination || {}), page: 1, total: rows.length, totalPages: 1 } };
}
