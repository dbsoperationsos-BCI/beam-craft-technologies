const assets = require("../../../modules/assets/assets.read.service");
const dataScope = require("../../dataScope.service");

/**
 * Read-only tools for ASSET / Asset Management.
 *
 * What the studio owns, where it is and who has it. Photographs, inspection images, invoices,
 * insurance details and purchase prices are not selected - none of them answers "which cameras are
 * out on assignment", and the image columns are large enough to be a problem by themselves.
 *
 * Narrowed by the same resolver, on the same columns, as the Asset Management screen: the session's
 * grant decides whose assets are read, so the assistant can never answer with more than the screen
 * shows the same person. The session's reachable branches are not used directly any more - they are
 * one of the four answers the resolver gives, not the answer.
 */
const scopeFor = (session) => dataScope.resolve({
  userId: session?.userId,
  module: "ASSET",
  feature: "Asset Management",
  columns: assets.ASSET_SCOPE_COLUMNS,
});

const TOOLS = [
  {
    name: "asset.getAssetSummary",
    module: "ASSET",
    risk: "READ",
    summary: true,
    description: "How many assets there are, by status and by the categories actually in use.",
    schema: { type: "object", properties: {} },
    execute: async (_args, session) => assets.getAssetSummary({ scope: await scopeFor(session) }),
    renderSummary: (result) => [
      `Assets: ${result.total}`,
      ...result.byStatus.map((row) => `${row.value}: ${row.count}`),
    ].join("\n"),
  },

  {
    name: "asset.searchAssets",
    module: "ASSET",
    risk: "READ",
    description:
      "Find assets by code, name or make, optionally filtered by status. Returns what each one is, "
      + "its status, who holds it and when it is next due for inspection.",
    schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of an asset code, name or make." },
        status: { type: "string" },
        limit: { type: "integer", description: "Up to 50; defaults to 20." },
      },
    },
    execute: async (args, session) => assets.searchAssets({ ...args, scope: await scopeFor(session) }),
  },
];

module.exports = { TOOLS };
