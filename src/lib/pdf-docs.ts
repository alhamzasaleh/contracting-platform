/** Only these print pages may be rendered as PDF for staff (signed in). */
export const STAFF_DOCS =
  /^(quotations|contracts|invoices|receipts|handover)\/[A-Z]{1,3}-\d{4}-\d{3,6}$|^payroll\/\d{4}-(0[1-9]|1[0-2])$|^(quotations|contracts)\/[A-Z]{1,3}-\d{4}-\d{3,6}\/materials(\/priced)?$/;

/** The download's name from the document path: Q-2026-001, Q-2026-001-materials-priced, 2026-11. */
export const pdfDocName = (path: string) => path.split("/").slice(1).join("-");
