const MODULE_OPERATIONS = Object.freeze({
  M01: { users: ['read', 'create', 'update', 'deactivate'], roles: ['read', 'manage'], permissions: ['read', 'manage'], assignments: ['read'], requests: ['read'] },
  M02: { catalog: ['read', 'manage'] },
  M03: { plans: ['read', 'create', 'update', 'submit', 'approve', 'archive'] },
  M04: { activities: ['read', 'create', 'update', 'assign', 'close'] },
  M05: { followup: ['read', 'create', 'update', 'submit', 'approve'] },
  M06: { milestones: ['read', 'create', 'update', 'approve'] },
  M07: { indicators: ['read', 'create', 'update', 'approve'] },
  M08: { consolidation: ['read', 'create', 'update', 'approve'] },
  M09: { corrective: ['read', 'create', 'update', 'close'] },
  M10: { appeals: ['read', 'create', 'update', 'resolve'] },
  M11: { incidents: ['read', 'create', 'update', 'resolve'] },
  M12: { reports: ['read', 'export'] },
  M13: { evidence: ['read', 'upload', 'verify'] },
  M14: { notifications: ['read', 'manage', 'escalate'] },
  M15: { audit: ['read', 'export'] },
  M16: { security: ['read', 'manage'] }
});

const p = (...entries) => entries.flatMap(([module, resource, operations]) =>
  operations.map((operation) => `${module}.${resource}.${operation}`));
const allPermissions = Object.freeze(Object.entries(MODULE_OPERATIONS).flatMap(([module, resources]) =>
  Object.entries(resources).flatMap(([resource, operations]) =>
    operations.map((operation) => `${module}.${resource}.${operation}`))));

// ASUMIDO: los documentos definen M01-M16 pero aún no nombran roles operativos.
// Estos perfiles son una configuración inicial explícita, revisable y no se insertan automáticamente.
const ROLE_ROWS = [
  ['system_administrator', 'Administración total del sistema', 'privileged', false, true, allPermissions],
  ['technology_administrator', 'Administración de usuarios, catálogos y seguridad', 'privileged', false, true,
    p(['M01','users',['read','create','update','deactivate']],['M01','roles',['read']],['M01','permissions',['read']],['M01','assignments',['read']],['M01','requests',['read']],['M02','catalog',['read','manage']],['M12','reports',['read','export']],['M15','audit',['read','export']],['M16','security',['read']])],
  ['planning_coordinator', 'Coordinación de planeación y consolidación', 'ordinary', true, false,
    p(['M02','catalog',['read']],['M03','plans',['read']],['M05','followup',['read','approve']],['M08','consolidation',['read','create','update','approve']],['M09','corrective',['read','create','update','close']],['M10','appeals',['read','resolve']],['M11','incidents',['read','resolve']],['M12','reports',['read','export']],['M14','notifications',['read','manage','escalate']])],
  ['plan_author', 'Elaboración de planes', 'ordinary', true, false,
    p(['M02','catalog',['read']],['M03','plans',['read','create','update','submit']],['M04','activities',['read','create','update','assign']],['M05','followup',['read','create','update','submit']],['M06','milestones',['read','create','update']],['M07','indicators',['read','create','update']],['M09','corrective',['read','create','update']],['M10','appeals',['read','create','update']],['M12','reports',['read','export']],['M13','evidence',['read','upload']],['M14','notifications',['read']])],
  ['plan_approver', 'Aprobación de planes y seguimientos', 'ordinary', true, false,
    p(['M02','catalog',['read']],['M03','plans',['read','approve']],['M05','followup',['read','approve']],['M06','milestones',['read','approve']],['M07','indicators',['read','approve']],['M08','consolidation',['read','approve']],['M09','corrective',['read','close']],['M10','appeals',['read','resolve']],['M12','reports',['read','export']],['M13','evidence',['read']],['M14','notifications',['read']])],
  ['activity_responsible', 'Responsabilidad de actividades asignadas', 'ordinary', true, false,
    p(['M02','catalog',['read']],['M04','activities',['read','update','close']],['M05','followup',['read','create','update','submit']],['M06','milestones',['read','update']],['M07','indicators',['read','update']],['M09','corrective',['read','create','update']],['M11','incidents',['read','create','update']],['M13','evidence',['read','upload','verify']],['M14','notifications',['read']])],
  ['collaborator', 'Colaboración en actividades asignadas', 'ordinary', true, false,
    p(['M04','activities',['read','update']],['M05','followup',['read','create','update']],['M06','milestones',['read']],['M07','indicators',['read']],['M13','evidence',['read','upload']],['M14','notifications',['read']])],
  ['auditor', 'Consulta de trazabilidad y reportes', 'ordinary', true, false,
    p(['M01','users',['read']],['M01','roles',['read']],['M01','permissions',['read']],['M01','assignments',['read']],['M01','requests',['read']],['M12','reports',['read','export']],['M15','audit',['read','export']],['M16','security',['read']])]
].map(([code, description, classification, requiresScope, allowOpenEnded, permissions]) => Object.freeze({
  code, description, classification, requiresScope, allowOpenEnded, permissions: Object.freeze(permissions)
}));

const permissionRows = Object.freeze(allPermissions.map((code) => Object.freeze({
  code,
  description: code
})));

export const ROLE_PERMISSION_CATALOG = Object.freeze({
  modules: MODULE_OPERATIONS,
  permissions: permissionRows,
  roles: Object.freeze(ROLE_ROWS)
});

export function permissionCodesForRole(roleCode) {
  return ROLE_ROWS.find((role) => role.code === roleCode)?.permissions ?? null;
}
