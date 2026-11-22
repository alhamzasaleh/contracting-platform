-- =============================================================================
-- Products saved without a pricing line ("role") were invisible to the
-- calculation (e.g. a Jotun exterior profile added by the owner). Link each
-- one to its category's default line. Non-destructive: only fills empty links.
-- =============================================================================

update public.products p
set equivalence_group_id = g.id
from public.equivalence_groups g
where p.equivalence_group_id is null
  and g.organization_id = p.organization_id
  and g.role = case p.category
    when 'putty' then 'putty' when 'primer' then 'primer' when 'sealer' then 'sealer'
    when 'finish_paint' then 'wall_finish' when 'ceiling_paint' then 'ceiling_paint'
    when 'moisture_paint' then 'moisture' when 'decorative' then 'decorative'
    when 'exterior_primer' then 'ext_primer' when 'exterior_putty' then 'ext_putty'
    when 'exterior_paint' then 'acrylic' when 'profile_texture' then 'profile' when 'spray_paint' then 'spray_acrylic'
    when 'crack_material' then 'crack_material'
    when 'c_channel' then 'c_channel' when 'omega' then 'omega' when 'stud' then 'stud' when 'track' then 'track'
    when 'hanger_rod' then 'rod' when 'vertical_hanger' then 'vertical_hanger' when 'angle' then 'edge_angle'
    when 'trough_angle' then 'trough_angle' when 'shadow_profile' then 'shadow'
    when 'washers' then 'washers' when 'anchors' then 'anchors' when 'clips' then 'clips'
    when 'tape' then 'joint_tape' when 'joint_compound' then 'joint_compound' when 'insulation' then 'insulation'
  end;
