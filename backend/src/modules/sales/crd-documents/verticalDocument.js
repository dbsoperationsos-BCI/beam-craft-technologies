const wed = require("./document");
const qq = require("./documentQQ");

/**
 * Which document shape a CRD document uses.
 *
 * Only Qua Qua has its own shape so far. Dum Dum keeps its existing one, and anything else
 * (Corp, or a document whose vertical is unknown) falls back to it too — the same behaviour every
 * CRD document had before Qua Qua got a shape of its own, so nothing already live changes.
 */
function moduleFor(vertical) {
  return vertical === "QQ" ? qq : wed;
}

module.exports = {
  emptyDocumentFor: (vertical) => moduleFor(vertical).emptyDocument(),
  documentSchemaFor: (vertical) => moduleFor(vertical).documentSchema,
  missingRequiredFor: (vertical, document) => moduleFor(vertical).missingRequired(document),
  completionPercentFor: (vertical, document) => moduleFor(vertical).completionPercent(document),
};
