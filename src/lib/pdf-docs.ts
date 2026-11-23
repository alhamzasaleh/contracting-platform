/** Only these print pages may be rendered as PDF for staff (signed in). */
export const STAFF_DOCS = /^(quotations|contracts|invoices|receipts|handover)\/[A-Z]{1,3}-\d{4}-\d{3,6}$|^payroll\/\d{4}-(0[1-9]|1[0-2])$/;
