/**
 * Evaluates a LightGBM model from its own JSON dump (`booster.dump_model()`), in plain JS: no
 * native runtime on the server, the same file the trainer wrote, and a parity test against
 * LightGBM's own predictions (test/image-selection-ai-culling-learning-parity.test.js).
 *
 * Numerical splits only (the feature set has no categorical inputs); missing values follow
 * LightGBM's rules: NaN goes to the default side of a split whose missing type is NaN, and is
 * read as 0 otherwise; a zero goes to the default side of a split whose missing type is Zero.
 *
 * `contributions` splits a prediction across features by the path each tree took (Saabas):
 * bias + sum(contributions) equals the raw score exactly, which is what lets the product explain
 * a learned score in terms of the signals the photo actually has.
 */

const isZero = (value) => Math.abs(value) <= 1e-35;

function goesLeft(node, value) {
  if (node.decision_type && node.decision_type !== "<=") throw new Error(`Unsupported split type ${node.decision_type}.`);
  let v = value;
  if (v === null || v === undefined || Number.isNaN(v)) {
    if (node.missing_type === "NaN") return Boolean(node.default_left);
    v = 0;
  }
  if (node.missing_type === "Zero" && isZero(v)) return Boolean(node.default_left);
  return v <= node.threshold;
}

const isLeaf = (node) => node.leaf_value !== undefined && node.left_child === undefined;
const nodeValue = (node) => (isLeaf(node) ? node.leaf_value : node.internal_value);

function treeOutput(root, features) {
  let node = root;
  while (!isLeaf(node)) node = goesLeft(node, features[node.split_feature]) ? node.left_child : node.right_child;
  return node.leaf_value;
}

const MAX_DEPTH = 64;
const MAX_NODES = 2_000_000;
const finite = (value) => typeof value === "number" && Number.isFinite(value);

// Every tree is walked once here, so a file that would run deep, read a feature it does not have
// or end on a non-number is refused when it loads - scoring then never meets one.
function checkTrees(trees, featureCount) {
  let nodes = 0;
  for (const root of trees) {
    const stack = [[root, 0]];
    while (stack.length) {
      const [node, depth] = stack.pop();
      nodes += 1;
      if (nodes > MAX_NODES) throw new Error(`The model has more than ${MAX_NODES} nodes.`);
      if (depth > MAX_DEPTH) throw new Error(`A tree runs deeper than ${MAX_DEPTH} levels.`);
      if (!node || typeof node !== "object") throw new Error("A tree node is not an object.");
      if (node.left_child === undefined && node.right_child === undefined) {
        if (!finite(node.leaf_value)) throw new Error("A leaf has no numeric leaf_value.");
        continue;
      }
      if (!node.left_child || !node.right_child || typeof node.left_child !== "object" || typeof node.right_child !== "object") throw new Error("A split needs both children.");
      if (!Number.isInteger(node.split_feature) || node.split_feature < 0 || node.split_feature >= featureCount) throw new Error(`A split reads feature ${node.split_feature}, which the model does not have.`);
      if (!finite(node.threshold)) throw new Error("A split has no numeric threshold.");
      if (node.decision_type && node.decision_type !== "<=") throw new Error(`Unsupported split type ${node.decision_type}.`);
      if (node.internal_value !== undefined && !finite(node.internal_value)) throw new Error("A split has a non-numeric internal_value.");
      stack.push([node.left_child, depth + 1], [node.right_child, depth + 1]);
    }
  }
}

/** Wraps a dump: { raw(features), predict(features), contributions(features), featureNames, objective }. */
function loadTreeModel(dump) {
  if (!dump || !Array.isArray(dump.tree_info)) throw new Error("Not a LightGBM model dump.");
  if ((dump.num_class || 1) !== 1) throw new Error("Only single-output models are supported.");
  if (!Array.isArray(dump.feature_names)) throw new Error("The model dump names no features.");
  const objective = String(dump.objective || "");
  const sigmoid = /^binary/.test(objective) ? Number((objective.match(/sigmoid:([0-9.]+)/) || [])[1] || 1) : null;
  const trees = dump.tree_info.map((tree) => tree?.tree_structure);
  checkTrees(trees, dump.feature_names.length);
  const average = Boolean(dump.average_output);
  const raw = (features) => {
    let sum = 0;
    for (const tree of trees) sum += treeOutput(tree, features);
    return average ? sum / trees.length : sum;
  };
  const predict = (features) => (sigmoid === null ? raw(features) : 1 / (1 + Math.exp(-sigmoid * raw(features))));
  const contributions = (features) => {
    const out = new Array(dump.feature_names.length).fill(0);
    let bias = 0;
    for (const tree of trees) {
      let node = tree;
      bias += nodeValue(node);
      while (!isLeaf(node)) {
        const next = goesLeft(node, features[node.split_feature]) ? node.left_child : node.right_child;
        out[node.split_feature] += nodeValue(next) - nodeValue(node);
        node = next;
      }
    }
    const scale = average ? 1 / trees.length : 1;
    return { bias: bias * scale, values: out.map((value) => value * scale) };
  };
  return { raw, predict, contributions, featureNames: dump.feature_names, objective, trees: trees.length };
}

module.exports = { loadTreeModel };
