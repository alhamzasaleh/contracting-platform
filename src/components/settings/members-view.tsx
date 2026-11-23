"use client";
import { Clock, MoreHorizontal, ShieldCheck, UserPlus, UserRoundCheck, UserRoundX, X } from "lucide-react";
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
};

export type ProjectOption = { id: string; number: string; client: string };

export type InvitationItem = {
  id: string;
  phone: string;
  name: string | null;
  role: Exclude<Role, "owner">;
  expiresAt: string;
};

type Actions = {
  invite: (i: { phone: string; full_name?: string; role: "supervisor" | "finance" | "viewer" }) => Promise<ActionResult>;
  update: (i: { membershipId: string; role?: Role; status?: "active" | "suspended"; permissions?: Permission[]; project_scope?: "all" | "assigned"; contract_ids?: string[] }) => Promise<ActionResult>;
  revoke: (i: { invitationId: string }) => Promise<ActionResult>;
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
}: {
  projects?: ProjectOption[];
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

  const errorText = (e: string) =>
    e === "noAccess" ? t("common.noAccess") : e === "lastOwner" ? t("settings.lastOwner") : e === "duplicate" ? t("settings.duplicateInvite") : t("common.error");

  const run = (fn?: () => Promise<ActionResult>, success?: string) => {
    if (!fn) return toast(t("preview.banner"));
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(success ?? t("common.saved"));
      else toast.error(errorText(r.error));
    });
  };

  const phone = (p: string | null) => (p ? fmt.digits(`+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8)}`) : "—");

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

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} isOwner={isOwner} onInvite={actions?.invite} />
      {editing && (
        <PermissionsDialog
          member={editing}
          projects={projects}
          onClose={() => setEditing(null)}
          onSave={actions ? (permissions, access) => actions.update({ membershipId: editing.id, permissions, ...access }) : undefined}
        />
      )}
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  isOwner,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isOwner: boolean;
  onInvite?: Actions["invite"];
}) {
  const t = useTranslations();
  const [role, setRole] = React.useState<"supervisor" | "finance" | "viewer">("supervisor");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  const roles = (["supervisor", "finance", "viewer"] as const).filter((r) => isOwner || r !== "finance");
  const hint: Record<string, string> = {
    supervisor: t("settings.roleSupervisorHint"),
    finance: t("settings.roleFinanceHint"),
    viewer: t("settings.roleViewerHint"),
  };

  const submit = (fd: FormData) => {
    if (!onInvite) {
      onOpenChange(false);
      toast(t("preview.banner"));
      return;
    }
    startTransition(async () => {
      const r = await onInvite({ phone: String(fd.get("phone") ?? ""), full_name: String(fd.get("full_name") ?? ""), role });
      if (r.ok) {
        toast.success(t("settings.inviteSent"));
        setErrors({});
        onOpenChange(false);
      } else {
        setErrors(r.fieldErrors ?? {});
        if (!r.fieldErrors) toast.error(r.error === "duplicate" ? t("settings.duplicateInvite") : r.error === "noAccess" ? t("common.noAccess") : t("common.error"));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")}>
        <form action={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t("settings.inviteTitle")}</DialogTitle>
            <DialogDescription>{t("settings.inviteHint")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <Field id="invite-phone" label={t("auth.phone")} error={errors.phone ? t("auth.phoneInvalid") : undefined}>
              <Input name="phone" inputMode="tel" dir="ltr" placeholder="05X XXX XXXX" className="font-latin rtl:text-right" autoComplete="off" />
            </Field>
            <Field id="invite-name" label={t("settings.fullName")} optional={t("common.optional")}>
              <Input name="full_name" autoComplete="off" />
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
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              <UserPlus /> {t("settings.invite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsDialog({
  member,
  onClose,
  onSave,
  projects,
}: {
  member: MemberItem;
  projects: ProjectOption[];
  onClose: () => void;
  onSave?: (p: Permission[], access?: { project_scope: "all" | "assigned"; contract_ids: string[] }) => Promise<ActionResult>;
}) {
  const t = useTranslations();
  const [selected, setSelected] = React.useState(new Set(member.permissions));
  const [scope, setScope] = React.useState<"all" | "assigned">(member.projectScope ?? "all");
  const [assigned, setAssigned] = React.useState(new Set(member.projectIds ?? []));
  const scoped = member.role !== "owner";
  const [pending, startTransition] = React.useTransition();
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
      const r = await onSave([...selected], scoped ? { project_scope: scope, contract_ids: scope === "assigned" ? [...assigned] : [] } : undefined);
      if (r.ok) {
        toast.success(t("common.saved"));
        onClose();
      } else toast.error(r.error === "noAccess" ? t("common.noAccess") : t("common.error"));
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent side="end" closeLabel={t("common.close")} className="flex flex-col">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle>{t("settings.editPermissions")}</DialogTitle>
          <DialogDescription>
            {member.name} · {t(`roles.${member.role}`)}
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
