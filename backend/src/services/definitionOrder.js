/*
 * The order project services and deliverables are listed in, everywhere: the one Settings →
 * Project → Services and Deliverables drags them into (`sortOrder`), the name only breaking a tie.
 * The quotation generator, the calculator, Create Project, the pickers and Extra Quotation all read
 * it, so no two screens list the same services differently.
 */
const DEFINITION_ORDER = [{ sortOrder: "asc" }, { name: "asc" }];

module.exports = { DEFINITION_ORDER };
