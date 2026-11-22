/**
 * Database types for the Supabase client.
 * Hand-maintained until the project is linked; then regenerate with
 *   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamps = { created_at: string };

export type Brand = { primary: string; accent?: string | null; source?: "logo" | "manual" | "default" };

export type OrganizationRow = Timestamps & {
  id: string;
  name: string;
  legal_name: string | null;
  cr_number: string | null;
  vat_number: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  logo_path: string | null;
  brand: Brand;
  default_locale: "ar" | "en";
  timezone: string;
  currency: string;
  created_by: string | null;
  updated_at: string;
};

export type ProfileRow = Timestamps & {
  id: string;
  full_name: string | null;
  phone: string | null;
  locale: "ar" | "en";
  numerals: "latn" | "arab";
  theme: "system" | "light" | "dark";
  default_organization_id: string | null;
  updated_at: string;
};

export type MembershipRow = Timestamps & {
  id: string;
  organization_id: string;
  user_id: string;
  role: "owner" | "supervisor" | "finance" | "viewer";
  status: "active" | "suspended";
  permission_overrides: { grant?: string[]; deny?: string[] };
  project_scope: "all" | "assigned";
  approval_limit: number | null;
  created_by: string | null;
  updated_at: string;
};

export type InvitationRow = Timestamps & {
  id: string;
  organization_id: string;
  phone: string;
  full_name: string | null;
  role: "supervisor" | "finance" | "viewer";
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_by: string | null;
};

export type AuditRow = Timestamps & {
  id: number;
  organization_id: string | null;
  actor_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  before: Json | null;
  after: Json | null;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      organizations: Table<OrganizationRow>;
      profiles: Table<ProfileRow>;
      memberships: Table<MembershipRow, Pick<MembershipRow, "organization_id" | "user_id" | "role"> & Partial<MembershipRow>>;
      member_invitations: Table<
        InvitationRow,
        Pick<InvitationRow, "organization_id" | "phone" | "role"> & Partial<InvitationRow>
      >;
      audit_log: Table<AuditRow>;
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: { Args: { p_name: string }; Returns: string };
      can_create_organization: { Args: Record<string, never>; Returns: boolean };
      accept_pending_invitations: { Args: Record<string, never>; Returns: number };
      my_permissions: { Args: { p_org: string }; Returns: string[] };
      auth_phone_allowed: { Args: { p_phone: string }; Returns: boolean };
      check_rate_limit: { Args: { p_key: string; p_max: number; p_window_seconds: number }; Returns: boolean };
      log_event: {
        Args: { p_org: string; p_action: string; p_entity: string; p_entity_id: string; p_details?: Json };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
