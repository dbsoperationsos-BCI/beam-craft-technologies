const registry = require("./registry");
const sales = require("./sales");
const imageSelection = require("./imageSelection");
const hrm = require("./hrm");
const accounts = require("./accounts");
const assetTools = require("./assets");
const project = require("./project");

/**
 * Everything Nebula can do, registered once at boot.
 *
 * Two modules, and that is not an oversight - it is what the repository actually supports today.
 *
 * SALES and IMAGE_SELECTION have callable service layers (`crmLeadService`, `activityService`,
 * `callLogService`, the transcript repository, the image-selection projects repository), so a tool
 * can reuse the same code the screens use and cannot drift from it.
 *
 * HRM, ASSET and ACCOUNTS do not. Their read logic lives inside Express handlers - `listEmployees`,
 * `listEntries` - which take `req` and `res` and cannot be called from anywhere else. Giving them
 * tools would mean writing fresh queries in the AI layer, and those queries would be a second,
 * unreviewed copy of each module's access rules. That is the failure mode this whole design exists
 * to avoid, so those modules stay registered as scopes with no tools until their controllers are
 * refactored - a change to working production code that deserves its own review, not a line item in
 * an AI phase.
 *
 * A scope with no tools is not broken. The assistant opens, says it cannot look anything up in this
 * session, and answers from experience.
 */
let registered = false;

/*
 * Safe to call more than once.
 *
 * `registerTool` throws on a duplicate name, by design, so the guard belongs here rather than
 * there: a second call is a legitimate "make sure these exist", while a genuinely duplicated tool
 * name is still a boot failure.
 */
function registerAllTools() {
  if (registered) return registry.allTools();
  registered = true;
  for (const tool of [...sales.TOOLS, ...imageSelection.TOOLS, ...hrm.TOOLS, ...accounts.TOOLS, ...assetTools.TOOLS, ...project.TOOLS]) {
    registry.registerTool(tool);
  }
  return registry.allTools();
}

/** Tests only, alongside `registry.resetRegistry()`. */
function resetRegistration() {
  registered = false;
}

module.exports = { registerAllTools, resetRegistration };
