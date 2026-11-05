/**
 * The client's name for a set of sales projects, as every staff screen shows it.
 *
 * It is the project's **WhatsApp group name**, in every vertical. The group name is what the studio
 * reads and types into WhatsApp, and it is the one name every project has, however it was made.
 *
 * It used to prefer the generator's own Client Name field, which only Qua Qua and Corp ask for -
 * Dum Dum asks for the groom and the bride instead - so the same column read "Kavya" on one row and
 * "WED 3t3 ERD Kavin & Thangamani | SM | Namakkal | …" on the next, and a project typed or imported
 * without the generator read the group name whatever its vertical. One rule now, for all three.
 *
 * Pages a *client* reads (their gallery, the CRD form) greet them by their own names instead and do
 * not come through here.
 *
 * `projectClientNames` is kept so its callers - which ask for a page of names in one go - need not
 * change; there is nothing left to look up.
 */
async function projectClientNames() {
  return new Map();
}

/** The one name to show for a project: its WhatsApp group name. */
const clientNameOf = (project) => project?.whatsappGroupName || null;

module.exports = { projectClientNames, clientNameOf };
