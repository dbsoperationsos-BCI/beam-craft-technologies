#!/usr/bin/env node
/**
 * Builds Nebula's own Ollama model.
 *
 *     node scripts/build-nebula-model.js
 *     OLLAMA_MODEL=nebula   # then point the CRM at it
 *
 * Takes the base model, bakes in Nebula's instructions and the Tanglish examples from
 * `src/services/ai/tanglishExamples.js`, and registers the result with Ollama under its own name.
 * Everything happens on this machine - no account, no upload, no API key.
 *
 * Why this rather than putting the examples in every prompt. Sending twenty examples with each
 * question would cost that much context on every request and re-explain the register endlessly to
 * a model that has a small window to begin with. Baked into the model they are part of what Nebula
 * is, and Ollama keeps the prefix cached, so a question costs what it did before.
 *
 * Rebuild after editing the examples. The model is a snapshot: changing the file changes nothing
 * until this runs again.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { TANGLISH_EXAMPLES } = require("../src/services/ai/tanglishExamples");
const { SYSTEM } = require("../src/services/ai/crmAssistant");

// The model Nebula is built on, and the name it is built as. Both overridable: a stronger box
// deserves a bigger base, and the CRM finds the result through OLLAMA_MODEL either way.
const BASE = process.env.NEBULA_BASE_MODEL || "qwen3:1.7b";
const NAME = process.env.NEBULA_MODEL_NAME || "nebula";

// Tamil script in the examples would teach Nebula to answer in it, which is the one thing the team
// asked it not to do. Caught here rather than discovered in a reply to a client.
const TAMIL_SCRIPT = /[஀-௿]/;

/** A Modelfile value: triple-quoted, so newlines and quotes inside it survive. */
function quote(text) {
  return `"""${String(text).replace(/"""/g, '\\"\\"\\"')}"""`;
}

function buildModelfile() {
  const bad = TANGLISH_EXAMPLES.filter(
    (pair) => TAMIL_SCRIPT.test(pair.user) || TAMIL_SCRIPT.test(pair.assistant),
  );
  if (bad.length) {
    throw new Error(
      `${bad.length} example(s) contain Tamil script. Nebula must answer in Roman letters.\n` +
      bad.map((pair) => `  - ${pair.user}`).join("\n"),
    );
  }

  const lines = [
    `FROM ${BASE}`,
    "",
    `SYSTEM ${quote(SYSTEM)}`,
    "",
    /*
     * qwen3 reasons before answering and does not stream that reasoning as content, so the panel
     * sat blank for thirty seconds before the first word. Off by default here for the same reason
     * it is off in the client.
     */
    "PARAMETER temperature 0.3",
    "PARAMETER top_p 0.9",
    "",
    "# How the team writes, and how Nebula writes back. See src/services/ai/tanglishExamples.js.",
  ];

  for (const pair of TANGLISH_EXAMPLES) {
    lines.push(`MESSAGE user ${quote(pair.user)}`);
    lines.push(`MESSAGE assistant ${quote(pair.assistant)}`);
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const modelfile = buildModelfile();
  // Written next to the build so a failed `ollama create` can be read rather than guessed at.
  const target = path.join(__dirname, "..", ".nebula.Modelfile");
  fs.writeFileSync(target, modelfile);

  console.log(`Base model:  ${BASE}`);
  console.log(`Examples:    ${TANGLISH_EXAMPLES.length} Tanglish pairs`);
  console.log(`Modelfile:   ${target}`);
  console.log(`Building     ${NAME} ...`);

  try {
    execFileSync("ollama", ["create", NAME, "-f", target], { stdio: "inherit" });
  } catch (error) {
    console.error(
      "\nCould not build the model. Is Ollama running, and is the base model pulled?\n" +
      `  ollama serve\n  ollama pull ${BASE}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nBuilt '${NAME}'. Point the CRM at it and restart the backend:`);
  console.log(`  OLLAMA_MODEL=${NAME}`);
}

if (require.main === module) main();

module.exports = { buildModelfile, BASE, NAME };
