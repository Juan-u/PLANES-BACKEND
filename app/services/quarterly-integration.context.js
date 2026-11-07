import { IntegrationError, approvedValue } from './quarterly-integration.rules.js';
export async function integrationReady(db) {
  try {
    const[[state]]=await db.query(`SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('seguimiento_formulacion','evidencia_carga','seguimiento_evidencia','evidencia_decision_institucional','periodo_reapertura_solicitud','periodo_actuacion','periodo_resultado_version')) AS table_count,
      (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('sf_no_update','sf_no_delete','se_no_update','se_no_delete','edi_no_update','edi_no_delete','pa_no_update','pa_no_delete','prv_no_update','prv_no_delete','prs_no_update','prs_no_delete','ec_no_update','ec_no_delete')) AS trigger_count,
      (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_evidencia_archivo_bytes' AND CHECK_CLAUSE LIKE '%10485760%') AS limit_count`);
    return Number(state?.table_count)===7&&Number(state?.trigger_count)===14&&Number(state?.limit_count)===1;
  }catch(error){if(error.code==='ER_NO_SUCH_TABLE')return false;throw error;}
}
export async function recordPeriodAction(tx,id,actor,action,previous,next,reference) {
  if(!await integrationReady(tx))return;
  await tx.execute('INSERT INTO periodo_actuacion (id_periodo,accion,actor_id,estado_anterior,estado_nuevo,autoridad_referencia,creado_en) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))',[id,action,actor,previous,next,reference]);
  if(action!=='closed')return;
  const[periods]=await tx.execute("SELECT id_periodo,DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fecha_fin FROM periodo_seguimiento WHERE id_periodo=?",[id]);
  const[rows]=await tx.execute(`SELECT a.id_actividad,a.id_plan,DATE_FORMAT(a.fecha_inicio,'%Y-%m-%d') AS fecha_inicio,DATE_FORMAT(a.fecha_fin,'%Y-%m-%d') AS fecha_fin,
    (SELECT s.porcentaje FROM seguimiento_actividad s WHERE s.id_actividad=a.id_actividad AND s.id_periodo=? AND s.estado='approved' ORDER BY s.id_seguimiento DESC LIMIT 1) AS porcentaje_aprobado
    FROM actividad a WHERE a.fecha_fin IS NOT NULL AND a.fecha_fin<=? AND (a.fecha_inicio IS NULL OR a.fecha_inicio<=?) ORDER BY a.id_actividad FOR UPDATE`,[id,periods[0].fecha_fin,periods[0].fecha_fin]);
  await tx.execute('INSERT INTO periodo_resultado_version (id_periodo,registrado_por,registrado_en,instantanea) VALUES (?,?,UTC_TIMESTAMP(3),?)',[id,actor,JSON.stringify({eligibility:'existing_due_by_period_end',rows})]);
}
export async function captureFollowupContext(tx,id,activityId) {
  try{await tx.query('SELECT id_seguimiento FROM seguimiento_formulacion LIMIT 0');}catch(e){if(e.code==='ER_NO_SUCH_TABLE')return;throw e;}
  const[rows]=await tx.query(`SELECT a.id_actividad,a.id_plan,p.nombre AS plan_nombre,i.id_objetivo,o.descripcion AS objetivo,ind.id_indicador,ind.nombre AS indicador,ind.descripcion AS indicador_descripcion,ind.formula,ind.unidad,ind.fuente,i.evidencias_esperadas FROM actividad a JOIN plan_accion p ON p.id_plan=a.id_plan LEFT JOIN actividad_institucional i ON i.id_actividad=a.id_actividad LEFT JOIN plan_objetivo o ON o.id_objetivo=i.id_objetivo LEFT JOIN plan_indicador ind ON ind.id_plan=a.id_plan AND (i.id_indicador IS NULL OR ind.id_indicador=i.id_indicador) WHERE a.id_actividad=?`,[activityId]);
  await tx.execute('INSERT INTO seguimiento_formulacion (id_seguimiento,id_actividad,instantanea,creado_en) VALUES (?,?,?,UTC_TIMESTAMP(3))',[id,activityId,JSON.stringify(rows[0]||{})]);
}
export async function closedPeriodSnapshot(db,periodId) {
  let rows;try{[rows]=await db.query('SELECT instantanea FROM periodo_resultado_version WHERE id_periodo=? ORDER BY id_version DESC LIMIT 1',[periodId]);}catch(error){if(error.code==='ER_NO_SUCH_TABLE')return null;throw error;}
  if(!rows.length)return null;
  let snapshot;try{snapshot=JSON.parse(rows[0].instantanea);}catch{throw new IntegrationError('INVALID_CLOSED_SNAPSHOT',503);}
  if(!Array.isArray(snapshot?.rows)||!snapshot.rows.every(r=>r&&Number.isSafeInteger(Number(r.id_actividad))&&Number(r.id_actividad)>0&&Object.hasOwn(r,'porcentaje_aprobado')))throw new IntegrationError('INVALID_CLOSED_SNAPSHOT',503);
  snapshot.rows.forEach(row=>approvedValue(row.porcentaje_aprobado));
  return snapshot;
}
export async function assertLinkable(tx,followupId,activityId) {
  const[found]=await tx.execute('SELECT id_periodo FROM seguimiento_actividad WHERE id_seguimiento=? AND id_actividad=?',[followupId,activityId]);
  if(found.length!==1)throw new IntegrationError('FOLLOWUP_ACTIVITY_MISMATCH',400);
  const[periods]=await tx.execute('SELECT estado FROM periodo_seguimiento WHERE id_periodo=? FOR UPDATE',[found[0].id_periodo]);
  if(periods[0]?.estado!=='open')throw new IntegrationError('PERIOD_CLOSED',409);
  const[rows]=await tx.execute('SELECT estado FROM seguimiento_actividad WHERE id_seguimiento=? AND id_actividad=? FOR UPDATE',[followupId,activityId]);
  if(rows[0]?.estado!=='pending')throw new IntegrationError('FOLLOWUP_NOT_PENDING',409);
}
export async function recordUpload(tx,evidenceId,activityId,actorId,followupId,{verifiedInTransaction=false}={}) {
  if(!verifiedInTransaction&&!await integrationReady(tx))return;
  if(followupId&&!verifiedInTransaction)await assertLinkable(tx,followupId,activityId);
  await tx.execute('INSERT INTO evidencia_carga (id_evidencia,id_actividad,creado_por,creado_en) VALUES (?,?,?,UTC_TIMESTAMP(3))',[evidenceId,activityId,actorId]);
  if(followupId)await tx.execute('INSERT INTO seguimiento_evidencia (id_seguimiento,id_evidencia,id_actividad,vinculado_por,vinculado_en) VALUES (?,?,?,?,UTC_TIMESTAMP(3))',[followupId,evidenceId,activityId,actorId]);
}
