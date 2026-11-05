const { crmLeadTabCounts, crmLeadStatusCounts } = require("../crm-leads/leadQueryService");
const { VERTICALS } = require("./filters");
const { summary, employeeAnalysis } = require("./service");

/**
 * The Sales dashboard: the CRM in one screen.
 *
 * Every figure here is produced by the code that already produces it somewhere else. The lead
 * counts come from `crmLeadTabCounts`, which is what draws the numbers on the CRM's own tabs; the
 * status breakdown comes from `crmLeadStatusCounts`, which reads the same `statusDisplaySql` the
 * board reads; the calls come from the Summary report. Nothing is counted a second way.
 *
 * That is the whole design. A dashboard that computes its own totals is a dashboard that will one
 * day disagree with the screen it summarises, and the disagreement is never noticed until somebody
 * is asked which number is right. Reusing the queries means the two cannot drift: a change to what
 * "Converted" means changes both at once.
 *
 * The lead figures are a position - how the board stands right now - and the call figures are a
 * period, the range chosen in the filter bar. They are labelled as such on the page, because
 * "142 leads" and "37 calls" side by side otherwise read as two measures of the same window.
 */

/** The studio's day, which is what every date in the CRM means. */
function studioToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/*
 * A vertical's figures, from the CRM's own tab counts.
 *
 * `crmLeadTabCounts` answers for one vertical at a time, so the three are asked in parallel rather
 * than in turn - they are independent reads and the page waits for the slowest either way.
 */
async function verticalRow(vertical, today, scope) {
  const counts = await crmLeadTabCounts({ board: vertical, filters: {}, today, scope });
  return {
    vertical,
    leads: counts.all,
    // "New" is the CRM's own definition: created today. Not "created in the filtered range" - that
    // would be a different question wearing the same word as the tab.
    newToday: counts.new,
    converted: counts.converted,
    followUpsToday: counts.today,
    followUpsOutstanding: counts.overallPending,
    cna: counts.cna,
  };
}

/**
 * Everything the dashboard shows, in one request.
 *
 * One call rather than six, because six would paint the screen in pieces and let a viewer read a
 * lead total from one moment beside a call total from another.
 *
 * A failure in any one part is that part empty, not the page. The lead counts and the call reports
 * read different tables, and a studio that has never received a Callyzer delivery should still see
 * its leads.
 */
async function dashboard(filters = {}, scope = null) {
  const today = studioToday();
  const chosen = VERTICALS.includes(String(filters.vertical || "").trim()) ? [String(filters.vertical).trim()] : VERTICALS;

  const [verticals, statuses, calls, performers] = await Promise.all([
    Promise.all(chosen.map((vertical) => verticalRow(vertical, today, scope).catch((error) => {
      console.warn(`Unable to count ${vertical} leads for the dashboard:`, error?.message || error);
      return { vertical, leads: 0, newToday: 0, converted: 0, followUpsToday: 0, followUpsOutstanding: 0, cna: 0 };
    }))),
    Promise.all(chosen.map((vertical) => crmLeadStatusCounts({ board: vertical, today, scope }).catch(() => [])))
      .then((lists) => {
        // Merged across the verticals in view, so the breakdown answers the same question the cards
        // above it do rather than only ever describing Dum Dum.
        const totals = new Map();
        for (const list of lists) for (const row of list) totals.set(row.status, (totals.get(row.status) || 0) + row.leads);
        return [...totals].map(([status, leads]) => ({ status, leads })).sort((a, b) => b.leads - a.leads);
      }),
    summary(filters, scope).catch((error) => {
      console.warn("Unable to summarise calls for the dashboard:", error?.message || error);
      return { totals: {}, rows: [] };
    }),
    employeeAnalysis(filters, scope).catch(() => ({ rows: [] })),
  ]);

  const leadTotals = verticals.reduce((sum, row) => ({
    leads: sum.leads + row.leads,
    newToday: sum.newToday + row.newToday,
    converted: sum.converted + row.converted,
    followUpsToday: sum.followUpsToday + row.followUpsToday,
    followUpsOutstanding: sum.followUpsOutstanding + row.followUpsOutstanding,
  }), { leads: 0, newToday: 0, converted: 0, followUpsToday: 0, followUpsOutstanding: 0 });

  const callTotals = calls.totals || {};
  const connected = Number(callTotals.connected) || 0;
  const totalCalls = Number(callTotals.calls) || 0;

  return {
    filters: calls.filters || {},
    today,
    leads: {
      ...leadTotals,
      // Of the leads on the board, not of the leads created in the range - the same population the
      // count beside it is drawn from, or the percentage would be of two different things.
      conversionRate: leadTotals.leads ? Math.round((leadTotals.converted / leadTotals.leads) * 100) : 0,
    },
    calls: {
      calls: totalCalls,
      connected,
      notConnected: Number(callTotals.notConnected) || 0,
      clients: Number(callTotals.clients) || 0,
      totalDuration: callTotals.totalDuration || "0s",
      averageDuration: callTotals.averageDuration || "0s",
      // What share of the calls actually reached somebody, which is the number worth watching.
      connectRate: totalCalls ? Math.round((connected / totalCalls) * 100) : 0,
    },
    verticals,
    statuses,
    // The busiest few, not everyone: a dashboard names who is carrying the calling, and the whole
    // list is one tab away on Employee Analysis.
    performers: (performers.rows || []).slice(0, 5),
    byDay: calls.rows || [],
  };
}

module.exports = { dashboard, studioToday };
