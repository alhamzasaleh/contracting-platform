"use client";
import { BriefcaseBusiness, Clock, Link2, MoreHorizontal, ShieldCheck, Unlink, UserPlus, UserRoundCheck, UserRoundX, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useFormatter } from "@/components/formatter-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions";
import { PERMISSION_GROUPS, ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/auth/permissions";
import { settle } from "@/lib/client/action";
import { useFailureText } from "@/lib/client/failure-text";
import { matchEmployee, type InviteRole, type LinkableEmployee } from "@/lib/hr/access";
import { cn } from "@/lib/utils";

export type MemberItem = {
  id: string;
  userId: string;
  name: string | null;
  phone: string | null;
  role: Role;
  status: "active" | "suspended";
  permissions: Permission[];
  isYou: boolean;
  /** "assigned" = only the projects in projectIds */
  projectScope?: "all" | "assigned";
  projectIds?: string[];
  /** the employee record linked to this account (employees.user_id) */
  employee?: LinkedEmployee | null;
  /** an employee without access whose number is this account's — offered for linking */
  suggestEmployee?: LinkedEmployee | null;
};

/** An employee as the members page shows him: name + job, never hr data. */
export type LinkedEmployee = {
  id: string;
  name: string;
  job: string | null;
  /** final exit while his account is still active → «أوقف الحساب» */
  exited?: boolean;
  /** the invitation goes to the number on his record (not editable here) */
  phoneLocked?: boolean;
};

export type ProjectOption = { id: string; number: string; client: string };

export type InvitationItem = {
  id: string;
  phone: string;
  name: string | null;
  role: Exclude<Role, "owner">;
  expiresAt: string;
  /** the invitation was made for this employee */
  employee?: LinkedEmployee | null;
};

export type InviteInput = { phone: string; full_name?: string; role: InviteRole; employee_id?: string };

type Actions = {
  invite: (i: InviteInput) => Promise<ActionResult>;
  update: (i: { membershipId: string; role?: Role; status?: "active" | "suspended"; permissions?: Permission[]; project_scope?: "all" | "assigned"; contract_ids?: string[] }) => Promise<ActionResult>;
  revoke: (i: { invitationId: string }) => Promise<ActionResult>;
  link?: (i: { employee_id: string; user_id: string }) => Promise<ActionResult>;
  unlink?: (i: { employee_id: string }) => Promise<ActionResult>;
};

const ROLE_TONE: Record<Role, "primary" | "info" | "success" | "neutral"> = {
  owner: "primary",
  supervisor: "info",
  finance: "success",
  viewer: "neutral",
};

export function MembersView({
  members,
  invitations,
  canManage,
  isOwner,
  actions,
  projects = [],
  employees = [],
  canViewHr = false,
  base = "",
}: {
  /** links go under this base (the design preview) */
  base?: string;
  projects?: ProjectOption[];
  /** employees (name, job, phone, account) to suggest linking a new invitation — members.manage only */
  employees?: LinkableEmployee[];
  /** hr.view: the employee's name links to his record */
  canViewHr?: boolean;
  members: MemberItem[];
  invitations: InvitationItem[];
  canManage: boolean;
  isOwner: boolean;
  actions?: Actions;
}) {
  const t = useTranslations();
  const { fmt } = useFormatter();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MemberItem | null>(null);
  const [, startTransition] = React.useTransition();

  const failure = useFailureText();
  const errorText = (e: string) => failure(e) ?? memberErrorText(t, e);

  const run = (fn?: () => Promise<ActionResult>, success?: string) => {
    if (!fn) return toast(t("preview.banner"));
    startTransition(async () => {
      const r = await settle(fn);
      if (r.ok) toast.success(success ?? t("common.saved"));
      else toast.error(errorText(r.error));
    });
  };

  const phone = (p: string | null) => phoneText(fmt, p);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              {t("settings.membersTitle")}
              <Badge className="num">{fmt.number(members.length)}</Badge>
            </CardTitle>
            <CardDescription>{t("settings.membersHint")}</CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => setInviteOpen(true)} className="shrink-0" aria-label={t("settings.invite")}>
              <UserPlus /> <span className="hidden sm:inline">{t("settings.invite")}</span>
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <Avatar name={m.name} className={cn(m.status === "suspended" && "opacity-40 grayscale")} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[14px] font-medium">
                    {m.name ?? "—"}
                    {m.isYou && <span className="text-xs font-normal text-subtle-foreground">({t("common.you")})</span>}
                  </p>
                  <p className="ltr-inline text-[13px] text-muted-foreground">{phone(m.phone)}</p>
                  {m.employee && <EmployeeTag employee={m.employee} canViewHr={canViewHr} base={base} />}
                  {canManage && (m.employee || m.suggestEmployee) && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {m.employee?.exited && m.status === "active" && <Badge tone="danger">{t("settings.exitActive")}</Badge>}
                      {m.employee ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => run(actions?.unlink && (() => actions.unlink!({ employee_id: m.employee!.id })), t("settings.unlinked"))}
                        >
                          <Unlink /> {t("settings.unlinkEmployee")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => run(actions?.link && (() => actions.link!({ employee_id: m.suggestEmployee!.id, user_id: m.userId })), t("settings.linkedDone"))}
                        >
                          <Link2 /> {t("settings.linkToEmployee", { name: m.suggestEmployee!.name })}
                        </Button>
                      )}
                    </div>
                  )}
                  <div className="mt-1 flex gap-1.5 sm:hidden">
                    <Badge tone={ROLE_TONE[m.role]}>{t(`roles.${m.role}`)}</Badge>
                    {m.status === "suspended" && <Badge tone="danger" dot>{t("settings.suspended")}</Badge>}
                  </div>
                </div>
                <div className="hidden items-center gap-2 sm:flex">
                  {m.status === "suspended" && <Badge tone="danger" dot>{t("settings.suspended")}</Badge>}
                  <Badge tone={ROLE_TONE[m.role]}>{t(`roles.${m.role}`)}</Badge>
                </div>
                {canManage && !m.isYou && (m.role !== "owner" || isOwner) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={t("common.actions")}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>{t("settings.changeRole")}</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={m.role}
                        onValueChange={(role) => run(actions && (() => actions.update({ membershipId: m.id, role: role as Role })))}
                      >
                        {(["owner", "supervisor", "finance", "viewer"] as Role[])
                          .filter((r) => isOwner || (r !== "owner" && r !== "finance"))
                          .map((r) => (
                            <DropdownMenuRadioItem key={r} value={r}>
                              {t(`roles.${r}`)}
                            </DropdownMenuRadioItem>
                          ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      {m.role !== "owner" && (
                        <DropdownMenuItem onSelect={() => setEditing(m)}>
                          <ShieldCheck /> {t("settings.editPermissions")}
                        </DropdownMenuItem>
                      )}
                      {m.status === "active" ? (
                        <DropdownMenuItem destructive onSelect={() => run(actions && (() => actions.update({ membershipId: m.id, status: "suspended" })))}>
                          <UserRoundX /> {t("settings.suspend")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => run(actions && (() => actions.update({ membershipId: m.id, status: "active" })))}>
                          <UserRoundCheck /> {t("settings.reactivate")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {t("settings.pending")}
              <Badge tone="warning" className="num">{fmt.number(invitations.length)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <ul className="divide-y divide-border">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                  <span className="flex size-9 items-center justify-center rounded-full border border-dashed border-border-strong text-subtle-foreground">
                    <Clock className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{i.name ?? phone(i.phone)}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {t("settings.expires", { date: fmt.date(i.expiresAt) })}
                    </p>
                    {i.employee && <EmployeeTag employee={i.employee} canViewHr={canViewHr} base={base} />}
                  </div>
                  <Badge tone={ROLE_TONE[i.role]}>{t(`roles.${i.role}`)}</Badge>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("settings.revokeInvite")}
                      onClick={() => run(actions && (() => actions.revoke({ invitationId: i.id })))}
                    >
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} isOwner={isOwner} onInvite={actions?.invite} employees={employees} base={base} />
      {editing && (
        <PermissionsDialog
          member={editing}
          projects={projects}
          canViewHr={canViewHr}
          base={base}
          onClose={() => setEditing(null)}
          onSave={actions ? (permissions, access) => actions.update({ membershipId: editing.id, permissions, ...access }) : undefined}
        />
      )}
    </div>
  );
}

/** The employee behind an account or invitation: name · job, a link to his record with hr.view, else text. */
function EmployeeTag({ employee, canViewHr, base }: { employee: LinkedEmployee; canViewHr: boolean; base: string }) {
  const t = useTranslations("settings");
  const text = employee.job ? `${employee.name} · ${employee.job}` : employee.name;
  return (
    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      <BriefcaseBusiness className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">{t("linkedEmployee")}</span>
      {canViewHr ? (
        <Link href={`${base}/team?employee=${employee.id}`} className="truncate underline-offset-2 hover:underline">
          {text}
        </Link>
      ) : (
        <span className="truncate">{text}</span>
      )}
    </p>
  );
}

/** A refused or failed call in the reader's language (a failed connection keeps what was typed). */
export function memberErrorText(t: ReturnType<typeof useTranslations>, e: string) {
  if (e === "noAccess") return t("common.noAccess");
  if (e === "lastOwner") return t("settings.lastOwner");
  if (e === "duplicate") return t("settings.duplicateInvite");
  if (e === "employeeLinked") return t("settings.employeeLinked");
  if (e === "alreadyMember" || e === "memberLinkedElsewhere" || e === "notEmployeePhone") return t(`settings.${e}`);
  return t.has(`errors.${e}`) ? t(`errors.${e}`) : t("common.error");
}

/**
 * Invite a phone number to sign in. Used on the members page and from an employee's record
 * (`employee` fixed, phone / name / role pre-filled). On the members page a typed number that
 * belongs to an employee without access offers to link the invitation to him — never silently.
 */
export function InviteDialog({
  open,
  onOpenChange,
  isOwner,
  onInvite,
  employees = [],
  employee,
  initial,
  base = "",
}: {
  base?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isOwner: boolean;
  onInvite?: Actions["invite"];
  employees?: LinkableEmployee[];
  /** the invitation is for this employee (from his record) */
  employee?: LinkedEmployee;
  initial?: { phone?: string; name?: string; role?: InviteRole };
}) {
  const t = useTranslations();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")}>
        {/* mounted only while open, so every opening starts from the record's values */}
        <InviteForm onClose={() => onOpenChange(false)} isOwner={isOwner} onInvite={onInvite} employees={employees} employee={employee} initial={initial} base={base} />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  onClose,
  isOwner,
  onInvite,
  employees,
  employee,
  initial,
  base,
}: {
  base: string;
  onClose: () => void;
  isOwner: boolean;
  onInvite?: Actions["invite"];
  employees: LinkableEmployee[];
  employee?: LinkedEmployee;
  initial?: { phone?: string; name?: string; role?: InviteRole };
}) {
  const t = useTranslations();
  const [role, setRole] = React.useState<InviteRole>(initial?.role ?? "supervisor");
  const [phoneText, setPhoneText] = React.useState(initial?.phone ?? "");
  const [linkMatch, setLinkMatch] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();
  const failure = useFailureText();

  const match = employee ? null : matchEmployee(phoneText, employees);
  const roles = (["supervisor", "finance", "viewer"] as const).filter((r) => isOwner || r !== "finance");
  const hint: Record<string, string> = {
    supervisor: t("settings.roleSupervisorHint"),
    finance: t("settings.roleFinanceHint"),
    viewer: t("settings.roleViewerHint"),
  };

  const submit = (fd: FormData) => {
    if (!onInvite) {
      onClose();
      toast(t("preview.banner"));
      return;
    }
    const employeeId = employee?.id ?? (match && linkMatch ? match.employee_id : undefined);
    startTransition(async () => {
      const r = await settle(() =>
        onInvite({ phone: String(fd.get("phone") ?? ""), full_name: String(fd.get("full_name") ?? ""), role, ...(employeeId ? { employee_id: employeeId } : {}) }),
      );
      if (r.ok) {
        toast.success(t("settings.inviteSent"));
        setErrors({});
        onClose();
      } else {
        setErrors(r.fieldErrors ?? {});
        if (!r.fieldErrors) toast.error(failure(r.error) ?? memberErrorText(t, r.error));
      }
    });
  };

  return (
    // onSubmit, not a form action: React resets a form after its action, which would wipe the number on an error
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      noValidate
    >
      <DialogHeader>
        <DialogTitle>{employee ? t("settings.giveAccessTitle", { name: employee.name }) : t("settings.inviteTitle")}</DialogTitle>
        <DialogDescription>{employee ? t("settings.giveAccessHint") : t("settings.inviteHint")}</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-5">
        <Field
          id="invite-phone"
          label={t("auth.phone")}
          error={errors.phone ? t("auth.phoneInvalid") : undefined}
          hint={employee?.phoneLocked ? t("settings.phoneFromRecord") : undefined}
        >
          <Input
            readOnly={employee?.phoneLocked}
            name="phone"
            inputMode="tel"
            dir="ltr"
            placeholder="05X XXX XXXX"
            className="font-latin rtl:text-right"
            autoComplete="off"
            value={phoneText}
            onChange={(e) => setPhoneText(e.target.value)}
          />
        </Field>
        {match && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-primary/40 bg-primary-softer p-3.5 text-[14px]">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" checked={linkMatch} onChange={(e) => setLinkMatch(e.target.checked)} />
            <span className="min-w-0">
              <span className="block font-medium">{t("settings.linkEmployee", { name: match.full_name })}</span>
              <span className="block text-[13px] text-muted-foreground">{match.job_title ?? t("settings.linkEmployeeHint")}</span>
            </span>
          </label>
        )}
        <Field id="invite-name" label={t("settings.fullName")} optional={t("common.optional")}>
          <Input name="full_name" autoComplete="off" defaultValue={initial?.name ?? ""} />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-[13px] font-medium">{t("settings.role")}</legend>
          {roles.map((r) => (
            <label
              key={r}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all",
                role === r ? "border-primary bg-primary-softer ring-4 ring-primary/10" : "border-border hover:border-border-strong",
              )}
            >
              <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
              <span className={cn("flex size-5 items-center justify-center rounded-full border-2", role === r ? "border-primary" : "border-border-strong")}>
                {role === r && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
              <span className="flex-1">
                <span className="block text-[14px] font-medium">{t(`roles.${r}`)}</span>
                <span className="block text-[13px] text-muted-foreground">{hint[r]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {employee && (
          <p className="text-[13px] text-muted-foreground">
            {t("settings.customiseLater")}{" "}
            <Link href={`${base}/settings/members`} className="font-medium text-foreground underline underline-offset-2">
              {t("settings.editPermissions")}
            </Link>
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={pending}>
          <UserPlus /> {employee ? t("settings.giveAccess") : t("settings.invite")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A Saudi number as the members page shows it (+966 5x xxx xxxx). */
function phoneText(fmt: ReturnType<typeof useFormatter>["fmt"], p: string | null) {
  return p ? fmt.digits(`+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8)}`) : "—";
}

/** The permissions dialog's heading: the account's name (else its phone) · role, and the employee linked to it. */
export function MemberSummary({ member, canViewHr, base }: { member: MemberItem; canViewHr: boolean; base: string }) {
  const t = useTranslations();
  const { fmt } = useFormatter();
  return (
    <div className="grid min-w-0 gap-0.5">
      <p>
        {member.name || <bdi dir="ltr">{phoneText(fmt, member.phone)}</bdi>} · {t(`roles.${member.role}`)}
      </p>
      {member.employee && <EmployeeTag employee={member.employee} canViewHr={canViewHr} base={base} />}
    </div>
  );
}

function PermissionsDialog({
  member,
  onClose,
  onSave,
  projects,
  canViewHr,
  base,
}: {
  member: MemberItem;
  projects: ProjectOption[];
  canViewHr: boolean;
  base: string;
  onClose: () => void;
  onSave?: (p: Permission[], access?: { project_scope: "all" | "assigned"; contract_ids: string[] }) => Promise<ActionResult>;
}) {
  const t = useTranslations();
  const [selected, setSelected] = React.useState(new Set(member.permissions));
  const [scope, setScope] = React.useState<"all" | "assigned">(member.projectScope ?? "all");
  const [assigned, setAssigned] = React.useState(new Set(member.projectIds ?? []));
  const scoped = member.role !== "owner";
  const [pending, startTransition] = React.useTransition();
  const failure = useFailureText();
  const defaults = new Set(ROLE_PERMISSIONS[member.role]);

  const toggle = (p: Permission, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(p);
      else n.delete(p);
      return n;
    });

  const save = () => {
    if (!onSave) {
      onClose();
      return toast(t("preview.banner"));
    }
    startTransition(async () => {
      const r = await settle(() => onSave([...selected], scoped ? { project_scope: scope, contract_ids: scope === "assigned" ? [...assigned] : [] } : undefined));
      if (r.ok) {
        toast.success(t("common.saved"));
        onClose();
      } else toast.error(failure(r.error) ?? memberErrorText(t, r.error));
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent side="end" closeLabel={t("common.close")} className="flex flex-col">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle>{t("settings.editPermissions")}</DialogTitle>
          <DialogDescription asChild>
            <div>
              <MemberSummary member={member} canViewHr={canViewHr} base={base} />
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {scoped && (
            <section className="mb-6 grid gap-3">
              <h4 className="text-[12px] font-semibold text-subtle-foreground">{t("settings.projectAccess")}</h4>
              <Segmented
                name="project-scope"
                value={scope}
                onChange={(v) => setScope(v as "all" | "assigned")}
                options={[
                  { value: "all", label: t("settings.projectsAll") },
                  { value: "assigned", label: t("settings.projectsAssigned") },
                ]}
              />
              {scope === "assigned" && (
                <div className="grid gap-1 rounded-xl border border-border p-2">
                  {projects.length === 0 && <p className="px-2 py-1 text-[13px] text-muted-foreground">{t("settings.noProjects")}</p>}
                  {projects.map((p) => (
                    <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-surface-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={assigned.has(p.id)}
                        onChange={(e) =>
                          setAssigned((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(p.id);
                            else n.delete(p.id);
                            return n;
                          })
                        }
                      />
                      <bdi dir="ltr" className="font-latin text-[13px]">{p.number}</bdi>
                      <span className="truncate text-[13px] text-muted-foreground">{p.client}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[12px] text-muted-foreground">{t("settings.projectAccessHint")}</p>
            </section>
          )}
          <p className="mb-4 text-[13px] text-muted-foreground">{t("settings.permissionsHint")}</p>
          <div className="grid gap-6">
            {PERMISSION_GROUPS.map((g) => (
              <section key={g.key}>
                <h4 className="mb-2 text-[12px] font-semibold text-subtle-foreground">{t(`permissions.groups.${g.key}`)}</h4>
                <div className="divide-y divide-border rounded-xl border border-border">
                  {g.permissions.map((p) => {
                    const on = selected.has(p);
                    const changed = on !== defaults.has(p);
                    return (
                      <label key={p} className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5">
                        <span className="text-[14px]">
                          {t(`permissions.${p.replace(".", "_")}`)}
                          {changed && <span className="ms-2 inline-block size-1.5 rounded-full bg-accent align-middle" aria-hidden />}
                        </span>
                        <Switch checked={on} onCheckedChange={(v) => toggle(p, v)} />
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} loading={pending}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
