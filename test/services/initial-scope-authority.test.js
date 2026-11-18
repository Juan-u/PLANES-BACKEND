import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRoleAdministrationService} from '../../app/services/role-administration.service.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const SCOPE_REF = '00000000-0000-4000-8000-000000000002';
const ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000003';

function make({authorized = 1, request = {}, ids = [REQUEST_ID, SCOPE_REF,
  '00000000-0000-4000-8000-000000000004', ASSIGNMENT_ID]} = {}) {
  const calls = [];
  let nextId = 0;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params) { return this.execute(sql, params); },
    async execute(sql, params = []) {
      calls.push({sql, params});
      if (/FROM rol_autorizacion_mutex/.test(sql)) return [[{mutex_id: 1}], []];
      if (/AS authorized/.test(sql)) return [[{authorized}], []];
      if (/SELECT id_usuario FROM usuario/.test(sql)) return [[{id_usuario: params[0]}], []];
      if (/SELECT id_plan FROM plan_accion/.test(sql)) return [[{id_plan: params[0]}], []];
      if (/JOIN rol_configuracion/.test(sql) && /BINARY role\.nombre_rol/.test(sql)) {
        return [[{id_rol: 9, clasificacion_privilegio: 'ordinary',
          permite_vigencia_indefinida: 0, requiere_ambito: 1}], []];
      }
      if (/FROM rol_scope_authority_request/.test(sql) && /WHERE id_plan/.test(sql)) return [[], []];
      if (/INSERT INTO rol_scope_authority_request/.test(sql)) return [{affectedRows: 1}, []];
      if (/FROM rol_scope_authority_request/.test(sql) && /WHERE id_solicitud/.test(sql)) {
        return [[{
          id_solicitud: REQUEST_ID, id_usuario_objetivo: 30, id_plan: 1,
          referencia_institucional: 'ACTA-2026-45', motivo: 'Designación institucional',
          vigente_desde: '2026-11-18 12:00:00.000', vigente_hasta: '2027-11-18 12:00:00.000',
          id_usuario_solicitante: 10, estado: 'pending', ...request
        }], []];
      }
      if (/FROM permiso/.test(sql) && /codigo IN/.test(sql)) {
        return [[
          {id_permiso: 68, codigo: 'M01.roles.manage_scope', activo: 1},
          {id_permiso: 69, codigo: 'assign-role', activo: 1},
          {id_permiso: 70, codigo: 'revoke-role', activo: 1},
          {id_permiso: 71, codigo: 'approve-role-change', activo: 1}
        ], []];
      }
      if (/FROM rol_permiso AS role_permission/.test(sql)) return [[], []];
      if (/FROM rol_scope_recurso AS mapping/.test(sql)) return [[], []];
      if (/FROM rol_scope_permitido/.test(sql)) return [[], []];
      if (/FROM rol_asignacion/.test(sql) && /vigente_desde < \?/.test(sql)) return [[], []];
      if (/SELECT id_evento FROM rol_auditoria/.test(sql)) return [[], []];
      if (/FROM rol_scope_ref/.test(sql) && /BINARY ref_value/.test(sql)) {
        return [[{id_scope_ref: 55, ref_kind: 'string', ref_value: SCOPE_REF}], []];
      }
      if (/FROM rol_asignacion AS a/.test(sql) && /WHERE a\.id_asignacion/.test(sql)) {
        return [[{id_asignacion: ASSIGNMENT_ID, id_usuario: 30, id_rol: 9, id_scope_ref: 55,
          estado: 'active', creado_por: 20, revocado_por: null, ref_kind: 'string',
          ref_value: SCOPE_REF}], []];
      }
      if (/INSERT INTO rol_auditoria/.test(sql)) return [{affectedRows: 1}, []];
      if (/INSERT INTO rol_scope_ref/.test(sql)) return [{insertId: 55}, []];
      if (/INSERT INTO rol_asignacion/.test(sql)) return [{affectedRows: 1}, []];
      if (/UPDATE rol_scope_authority_request/.test(sql)) return [{affectedRows: 1}, []];
      if (/INSERT INTO rol_scope_recurso|INSERT INTO rol_scope_permitido|INSERT INTO rol_permiso/.test(sql)) {
        return [{affectedRows: 1}, []];
      }
      throw new Error(`Unexpected SQL in authority test: ${sql}`);
    }
  };
  const service = createRoleAdministrationService({
    pool: {async getConnection() { return connection; }},
    ids: {async next() {
      const id = ids[nextId];
      nextId += 1;
      return id ?? `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
    }},
    clock: {now: () => NOW}
  });
  return {service, calls};
}

test('initial authority nomination requires a formal reference and bounded validity before opening a transaction', async () => {
  const {service, calls} = make();
  const result = await service.requestInitialScopeAuthority({actorId: 10}, {
    targetUserId: 30, planId: 1, institutionalReference: '  ', reason: 'Reason',
    validUntil: '2027-11-18T12:00:00Z'
  });
  assert.deepEqual(result, {ok: false, code: 'INVALID_INSTITUTIONAL_REFERENCE'});
  assert.equal(calls.length, 0);
});

test('initial authority nomination is stored pending and audited without granting an assignment', async () => {
  const {service, calls} = make();
  const result = await service.requestInitialScopeAuthority({actorId: 10}, {
    targetUserId: 30, planId: 1, institutionalReference: 'ACTA-2026-45',
    reason: 'Designación institucional', validUntil: '2027-11-18T12:00:00Z'
  });
  assert.deepEqual(result, {ok: true, requestId: REQUEST_ID, status: 'pending'});
  assert.ok(calls.some(({sql}) => /INSERT INTO rol_scope_authority_request/.test(sql)));
  assert.equal(calls.some(({sql}) => /INSERT INTO rol_asignacion/.test(sql)), false);
  const audit = calls.find(({sql}) => /INSERT INTO rol_auditoria/.test(sql));
  assert.equal(audit.params[3], 'initial_scope_authority_requested');
  assert.equal(audit.params[7], 'ACTA-2026-45');
});

test('the requester cannot approve the nomination and a different institutional reference is rejected', async () => {
  const own = make();
  const ownResult = await own.service.decideInitialScopeAuthority({actorId: 10}, REQUEST_ID, {
    decision: 'approve', institutionalReference: 'ACTA-2026-45', reason: 'Approve'
  });
  assert.deepEqual(ownResult, {ok: false, code: 'INDEPENDENT_APPROVAL_REQUIRED'});
  assert.equal(own.calls.some(({sql}) => /INSERT INTO rol_asignacion/.test(sql)), false);

  const mismatch = make();
  const mismatchResult = await mismatch.service.decideInitialScopeAuthority({actorId: 20}, REQUEST_ID, {
    decision: 'approve', institutionalReference: 'ACTA-OTHER', reason: 'Approve'
  });
  assert.deepEqual(mismatchResult, {ok: false, code: 'INSTITUTIONAL_REFERENCE_MISMATCH'});
  assert.equal(mismatch.calls.some(({sql}) => /INSERT INTO rol_asignacion/.test(sql)), false);
});

test('a second active administrator grants only the typed plan scope and records assignment and audit together', async () => {
  const {service, calls} = make({
    request: {vigente_desde: '2026-11-18 11:59:59.000'},
    ids: [SCOPE_REF, '00000000-0000-4000-8000-000000000004',
      ASSIGNMENT_ID, '00000000-0000-4000-8000-000000000005']
  });
  const result = await service.decideInitialScopeAuthority({actorId: 20}, REQUEST_ID, {
    decision: 'approve', institutionalReference: 'ACTA-2026-45', reason: 'Acto verificado'
  });

  assert.deepEqual(result, {
    ok: true, requestId: REQUEST_ID, status: 'approved', assignmentId: ASSIGNMENT_ID, scopeRef: SCOPE_REF
  });
  const assignment = calls.find(({sql}) => /INSERT INTO rol_asignacion/.test(sql));
  assert.ok(assignment);
  assert.equal(assignment.params[1], 30);
  assert.equal(assignment.params[2], 9);
  assert.equal(assignment.params[3], 55);
  assert.equal(assignment.params[7], 20);
  assert.match(assignment.params[9], /ACTA-2026-45/);
  assert.ok(calls.some(({sql, params}) =>
    /INSERT INTO rol_scope_recurso/.test(sql) && params[1] === 1));
  assert.ok(calls.some(({sql, params}) =>
    /INSERT INTO rol_scope_permitido/.test(sql) && params[0] === 9 && params[1] === 55));
  const audits = calls.filter(({sql}) => /INSERT INTO rol_auditoria/.test(sql));
  assert.deepEqual(audits.map(({params}) => params[3]), [
    'role_permissions_updated', 'initial_scope_authority_granted'
  ]);
  assert.equal(audits[1].params[7], 'ACTA-2026-45');
  const decision = calls.find(({sql}) => /UPDATE rol_scope_authority_request/.test(sql));
  assert.deepEqual(decision.params.slice(0, 6), [20, 'ACTA-2026-45', 'Acto verificado',
    '2026-11-18 12:00:00.000', 55, ASSIGNMENT_ID]);
});

test('an expired initial authority nomination cannot grant an assignment', async () => {
  const {service, calls} = make({
    request: {
      vigente_desde: '2026-11-18 11:00:00.000',
      vigente_hasta: '2026-11-18 11:59:59.000'
    }
  });
  const result = await service.decideInitialScopeAuthority({actorId: 20}, REQUEST_ID, {
    decision: 'approve', institutionalReference: 'ACTA-2026-45', reason: 'Acto verificado'
  });
  assert.deepEqual(result, {ok: false, code: 'INVALID_VALIDITY'});
  assert.equal(calls.some(({sql}) => /INSERT INTO rol_asignacion/.test(sql)), false);
});
