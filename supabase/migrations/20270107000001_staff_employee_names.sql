-- Staff names (owner, Nov 2026): the maintenance assignee (/maintenance, projects.view), the
-- petty-cash holder (/purchases/petty-cash, purchases.view), the site-visit supervisor on the project
-- page (projects.view) and the audit log's actors (/settings/audit, audit.view) show the linked
-- employee's «name · job».
-- public.member_employee_links() needs members.manage, so these pages read this narrower source:
-- only (user_id, full_name, job_title) of employees linked to an account that is a member of the
-- organization — no phone, id number, salaries or documents (PDPL: minimal, purpose-bound).
-- Additive only.

create or replace function public.staff_employee_names(p_org uuid)
returns table (user_id uuid, full_name text, job_title text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.user_id, e.full_name, e.job_title
  from public.employees e
  where e.organization_id = p_org
    and e.user_id is not null
    and exists (select 1 from public.memberships m where m.organization_id = p_org and m.user_id = e.user_id)
    and (private.has_permission(p_org, 'projects.view') or private.has_permission(p_org, 'purchases.view')
         or private.has_permission(p_org, 'audit.view'))
  order by e.full_name;
$$;
revoke all on function public.staff_employee_names(uuid) from public, anon;
grant execute on function public.staff_employee_names(uuid) to authenticated, service_role;
