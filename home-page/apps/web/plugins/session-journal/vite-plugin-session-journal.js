import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIRTUAL_ID = 'virtual:session-journal-client';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = path.resolve(PLUGIN_DIR, 'session-journal-client.js');

export default function sessionJournalPlugin() {
  return {
    name: 'session-journal',
    apply: 'serve',

    resolveId(id, importer) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_ID;
      }
      if (importer === RESOLVED_ID && id.startsWith('.')) {
        return path.resolve(PLUGIN_DIR, id);
      }
    },

    load(id) {
      if (id === RESOLVED_ID) {
        return fs.readFile(CLIENT_PATH, 'utf-8');
      }
    },

    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `  <script type="module" src="/@id/${VIRTUAL_ID}"></script>\n</head>`,
      );
    },
  };
}
