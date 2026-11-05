import { saveProjectFile } from "./projectStorage.mjs";

function csvValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r?\n|\r/g, "\n");
}

function escapeCsv(value) {
  const normalized = csvValue(value);
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

export function createExportFileName(moduleName, extension = "csv") {
  const date = new Date().toISOString().slice(0, 10);
  const normalizedName = String(moduleName || "table").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "table";
  return `${normalizedName}-export-${date}.${extension}`;
}

export function createCsvContent({ columns, rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return false;

  const exportColumns = (columns || []).filter((column) => column?.key !== "actions" && column?.exportable !== false);
  if (exportColumns.length === 0) return false;

  return [
    exportColumns.map((column) => escapeCsv(column.label || column.key)).join(","),
    // The index travels with the row, so a column whose value *is* the position - a serial number -
    // can answer without searching the list for the row it was handed. That search was `indexOf`
    // per row per export, which is quadratic: 5,880 rows is 34 million comparisons.
    ...rows.map((row, index) => exportColumns.map((column) => {
      const value = typeof column.value === "function" ? column.value(row, index) : row?.[column.key];
      return escapeCsv(value);
    }).join(",")),
  ].join("\n");
}

/**
 * Saves the table as a CSV under the Target Download Path from Project Settings, in the project's
 * folder when the table belongs to one and under that folder's own Downloads folder when it does
 * not. Resolving the location is `projectStorage`'s job, not this file's \u2014 with no folder chosen,
 * or in a browser that cannot write to one, it falls back to the browser's Downloads folder.
 */
export async function exportToCsv({ fileName, columns, rows, projectName, folder }) {
  const content = createCsvContent({ columns, rows });
  if (!content) return false;

  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  await saveProjectFile({ blob, fileName: fileName || createExportFileName("table"), projectName, folder });
  return true;
}
