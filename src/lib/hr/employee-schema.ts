import { z } from "zod";
import { num, optionalDate, optionalText } from "@/lib/validation/numbers";
import { normalizeSaudiMobile } from "@/lib/validation/phone";

/** The employee form (saveEmployee): validated the same on the server. */
const digits = (v: unknown) =>
  typeof v === "string" ? v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s+/g, "").toUpperCase() : v;

export const employeeSchema = z
  .object({
    id: z.uuid().optional(),
    full_name: z.string().trim().min(2, "required").max(120),
    is_saudi: z.boolean(),
    nationality: optionalText(60),
    job_title: optionalText(80),
    // required (owner, Nov 2026): it is his sign-in number when he gets access to the system
    phone: z.preprocess(
      (v) => (typeof v === "string" && v.trim() ? normalizeSaudiMobile(v) ?? "invalid" : ""),
      z.string().min(1, "required").regex(/^\d{8,15}$/, "phoneInvalid"),
    ),
    id_number: z.preprocess((v) => (v === "" ? null : digits(v)), z.string().regex(/^\d{10}$/, "idInvalid").nullable()),
    id_expiry: optionalDate,
    passport_expiry: optionalDate,
    insurance_expiry: optionalDate,
    start_date: optionalDate,
    basic_salary: num({ min: 0, max: 1_000_000 }),
    housing_allowance: num({ min: 0, max: 1_000_000 }),
    transport_allowance: num({ min: 0, max: 1_000_000 }),
    other_allowances: num({ min: 0, max: 1_000_000 }),
    iban: z.preprocess((v) => (v === "" ? null : digits(v)), z.string().regex(/^SA\d{22}$/, "ibanInvalid").nullable()),
    status: z.enum(["active", "on_leave", "final_exit"]),
    notes: optionalText(1000),
  })
  .strict();

