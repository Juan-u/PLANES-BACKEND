export async function getActivityAccess(authorization, tx, actorId, permissionCode) {
  const context = { actorId, permissionCode };
  // null represents an effective global grant. Empty scope sets deny access.
  if (await authorization.canAccess(context, tx)) return null;
  const scopes = await authorization.listActivityScopes(context, tx);
  return {
    planIds: new Set(scopes.filter(row => row.id_actividad == null).map(row => Number(row.id_plan))),
    activityIds: new Set(scopes.filter(row => row.id_actividad != null).map(row => Number(row.id_actividad)))
  };
}

export function hasActivityAccess(access) {
  return !access || access.planIds.size > 0 || access.activityIds.size > 0;
}

export function includesActivity(access, { id_plan, id_actividad }) {
  return !access || access.planIds.has(Number(id_plan)) || access.activityIds.has(Number(id_actividad));
}

// Column names come only from the calling query. Scope IDs are always parameters.
export function activityScopeFilter(access, params, prefix = 'a.') {
  if (!access) return '';
  const predicates = [];
  for (const [column, ids] of [['id_plan', access.planIds], ['id_actividad', access.activityIds]]) {
    if (!ids.size) continue;
    predicates.push(`${prefix}${column} IN (${Array(ids.size).fill('?').join(',')})`);
    params.push(...ids);
  }
  return ` AND (${predicates.join(' OR ') || '1 = 0'})`;
}

export async function findActivity(tx, value, { evidence = false } = {}) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      !/^[1-9]\d{0,9}$/.test(String(value)) || Number(value) > 2_147_483_647) return null;
  const sql = evidence
    ? 'SELECT a.id_plan, a.id_actividad FROM evidencia e JOIN actividad a ON a.id_actividad = e.id_actividad WHERE e.id_evidencia = ?'
    : 'SELECT id_plan, id_actividad FROM actividad WHERE id_actividad = ?';
  const [rows] = await tx.execute(sql, [Number(value)]);
  return rows[0] ?? null;
}
