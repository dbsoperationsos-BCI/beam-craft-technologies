/*
 * The payslip's pure parts the screens share. The payslip itself - the sample in Settings → Payroll
 * rules and every employee's - is laid out and printed by the server (`payslipPdfService`), and the
 * preview shows that very document.
 */

/** "30,500.00" - the payslip's money, without the rupee sign its column headings already carry. */
export const payslipAmount = (value) => (Number(value) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What can be typed into a detail added to the payslip (Settings → Payroll rules → Edit Payslip):
 * `input` is the field Edit Employee draws for it. Text takes no digits; Text and number takes both.
 */
export const PAYSLIP_INPUT_TYPES = [
  { value: "TEXT", label: "Text", input: "text" },
  { value: "NUMBER", label: "Number", input: "number" },
  { value: "ALNUM", label: "Text and number", input: "text" },
  // Letters, numbers and symbols together - "TN/MAS-01", "A+ (ve)".
  { value: "ANY", label: "Any character", input: "text" },
  { value: "DATE", label: "Date", input: "date" },
  // Chosen from the options typed when it was added.
  { value: "DROPDOWN", label: "Dropdown", input: "select" },
];

/**
 * When a month's payslip is generated and reaches the employee's Payslip: once its pay cycle ends
 * (nothing set), or so many days after the month's payable (payback due) date - on it, for 0.
 */
export const PAYSLIP_GENERATE_DAY_OPTIONS = [
  { value: "", label: "As soon as the pay cycle ends" },
  { value: "0", label: "On the payable date" },
  ...Array.from({ length: 30 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} ${index === 0 ? "day" : "days"} after the payable date` })),
];
