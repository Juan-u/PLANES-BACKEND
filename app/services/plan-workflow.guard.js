import { WorkflowError } from './plan-workflow.rules.js';

export async function workflowSchemaReady(db) {
  try {
    await db.query('SELECT id_plan,estado,revision,fecha_inicio,fecha_fin,responsable_propuesto_id FROM plan_flujo LIMIT 0');
    await db.query('SELECT id_evento,id_plan,instantanea,instantanea_sha256 FROM plan_flujo_evento LIMIT 0');
    const [triggers]=await db.query("SELECT TRIGGER_NAME,EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='plan_flujo_evento' AND ACTION_TIMING='BEFORE' AND TRIGGER_NAME IN (?,?)",['plan_flujo_evento_no_update','plan_flujo_evento_no_delete']);
    return triggers.some(t=>t.TRIGGER_NAME==='plan_flujo_evento_no_update'&&t.EVENT_MANIPULATION==='UPDATE')&&triggers.some(t=>t.TRIGGER_NAME==='plan_flujo_evento_no_delete'&&t.EVENT_MANIPULATION==='DELETE');
  }catch(error){if(error.code==='ER_NO_SUCH_TABLE')return false;throw error;}
}

// Called inside each existing write transaction after the base plan is locked.
// Before Block D migration, Block C remains operational without new tables.
export async function assertWorkflowEditable(tx, planId) {
  let states;
  try { await tx.query('SELECT estado FROM plan_flujo WHERE id_plan=?', [planId]); }
  catch (error) { if (error.code === 'ER_NO_SUCH_TABLE') return; throw error; }
  await tx.execute('SELECT id_plan FROM plan_accion WHERE id_plan=? FOR UPDATE',[planId]);
  [states] = await tx.query('SELECT estado FROM plan_flujo WHERE id_plan=? FOR UPDATE',[planId]);
  if (states.length) {
    if (!['borrador','devuelto'].includes(states[0].estado)) throw new WorkflowError('PLAN_LOCKED_BY_WORKFLOW',409);
    return;
  }
  const [rows] = await tx.execute('SELECT estado FROM plan_accion WHERE id_plan=? FOR UPDATE',[planId]);
  const legacy = String(rows[0]?.estado ?? '').trim().toLowerCase();
  if (legacy && legacy !== 'borrador') throw new WorkflowError('LEGACY_STATE_REQUIRES_REVIEW',409);
}

export async function attachWorkflowStates(db,rows,kind='plan') {
  if(!rows.length)return rows;
  const ids=[...new Set(rows.map(row=>row.id_plan).filter(Boolean))];if(!ids.length)return rows;
  let states;
  try { [states]=await db.query(`SELECT id_plan,estado,revision FROM plan_flujo WHERE id_plan IN (${ids.map(()=>'?').join(',')})`,ids); }
  catch(error){if(error.code==='ER_NO_SUCH_TABLE')return rows;throw error;}
  return rows.map(row=>{
    const state=states.find(s=>Number(s.id_plan)===Number(row.id_plan));
    return state?{...row,flujo:state,...(kind==='plan'&&row.institucional?{institucional:{...row.institucional,modo:state.estado}}:{})}:row;
  });
}
