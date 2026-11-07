// Presentation data is optional in drafts; this module does not approve plans or evaluate indicators.
export class DraftError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const bad = message => { throw new DraftError(message); };
const own = (o, k) => Object.hasOwn(o, k);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 10000) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.includes('\0') || value.length > max || Buffer.byteLength(value, 'utf8') > 60000) bad('Revisa la longitud y el formato de los textos institucionales.');
  return value.trim() || null;
};
const id = value => {
  if (value == null || value === '') return null;
  if (!(typeof value === 'number' || typeof value === 'string' && /^[1-9]\d*$/.test(value))) bad('La referencia institucional no es válida.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) bad('La referencia institucional no es válida.');
  return n;
};
const decimal = (value, scale, nonnegative = false) => {
  if (value == null || value === '') return null;
  const s = String(value);
  if (!new RegExp(`^${nonnegative ? '' : '-?'}\\d{1,${18 - scale}}(?:\\.\\d{1,${scale}})?$`).test(s)) bad('Revisa los valores numéricos; usa punto decimal y respeta la precisión indicada.');
  return s;
};
function list(value, parse) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) bad('Se admiten como máximo 100 elementos por formulario.');
  const result = value.map(parse), ids = result.filter(v => v.id != null).map(v => v.id);
  if (new Set(ids).size !== ids.length) bad('Hay referencias repetidas en el formulario.');
  return result;
}
export function normalizeDraft(body, kind) {
  if (!own(body ?? {}, 'institucional')) return undefined; // Legacy clients remain compatible.
  const raw = body.institucional;
  if (!object(raw)) bad('La ficha institucional no es válida.');
  const result = { revision: id(raw.revision) };
  if (kind === 'plan') {
    for (const k of ['problema','causas','consecuencias','objetivo_general','meta_descripcion']) result[k] = text(raw[k]);
    result.id_proceso = id(raw.id_proceso);
    result.meta_valor = decimal(raw.meta_valor, 4);
    result.meta_unidad = text(raw.meta_unidad, 100);
    result.responsable_principal = text(raw.responsable_principal, 150);
    result.objetivos = list(raw.objetivos, item => {
      if (!object(item)) bad('Revisa los objetivos específicos.');
      const descripcion = text(item.descripcion);
      if (!descripcion) bad('Cada objetivo añadido necesita una descripción.');
      return { id: id(item.id), descripcion };
    });
    if (raw.indicador !== undefined) {
      if (!object(raw.indicador)) bad('Revisa el indicador principal.');
      result.indicador = {};
      for (const k of ['nombre','descripcion','formula','unidad','fuente']) result.indicador[k] = text(raw.indicador[k], k === 'nombre' ? 150 : k === 'unidad' ? 100 : 10000);
    }
  } else {
    result.nombre = text(raw.nombre, 150);
    result.resultado_esperado = text(raw.resultado_esperado);
    result.id_objetivo = id(raw.id_objetivo); result.id_indicador = id(raw.id_indicador);
    for (const k of ['metodo_verificacion','evidencias_esperadas','observaciones','instrucciones']) result[k] = text(raw[k]);
    result.prioridad = text(raw.prioridad, 5);
    if (result.prioridad && !['alta','media','baja'].includes(result.prioridad)) bad('La prioridad debe ser alta, media o baja.');
    result.recursos = list(raw.recursos, item => {
      if (!object(item)) bad('Revisa los recursos.');
      const descripcion = text(item.descripcion, 255);
      if (!descripcion) bad('Cada recurso añadido necesita una descripción.');
      return { id: id(item.id), descripcion, cantidad: decimal(item.cantidad, 4, true), costo_estimado: decimal(item.costo_estimado, 2, true) };
    });
  }
  return result;
}

export async function attachDrafts(db, rows, kind) {
  if (!rows.length) return rows;
  const isPlan = kind === 'plan', key = isPlan ? 'id_plan' : 'id_actividad';
  const ids = rows.map(row => row[key]), placeholders = ids.map(() => '?').join(',');
  let details;
  try {
    [details] = await db.query(`SELECT ${isPlan ? 'i.id_plan,i.id_proceso,i.problema,i.causas,i.consecuencias,i.objetivo_general,i.meta_descripcion,i.meta_valor,i.meta_unidad,i.responsable_principal,i.revision,p.nombre AS proceso_nombre' : 'i.id_actividad,i.id_plan,i.nombre,i.resultado_esperado,i.id_objetivo,i.id_indicador,i.metodo_verificacion,i.prioridad,i.evidencias_esperadas,i.observaciones,i.instrucciones,i.revision'} FROM ${isPlan ? 'plan_institucional' : 'actividad_institucional'} i ${isPlan ? 'LEFT JOIN proceso_institucional p ON p.id_proceso=i.id_proceso' : ''} WHERE i.${key} IN (${placeholders})`, ids);
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return rows.map(row => ({ ...row, institucional: null }));
    throw error;
  }
  let objectives = [], indicators = [], resources = [];
  if (isPlan) {
    [objectives] = await db.query(`SELECT id_objetivo AS id,id_plan,descripcion,orden FROM plan_objetivo WHERE id_plan IN (${placeholders}) ORDER BY orden,id_objetivo`, ids);
    [indicators] = await db.query(`SELECT id_indicador,id_plan,nombre,descripcion,formula,unidad,fuente FROM plan_indicador WHERE id_plan IN (${placeholders})`, ids);
  } else [resources] = await db.query(`SELECT id_recurso AS id,id_actividad,descripcion,cantidad,costo_estimado FROM actividad_recurso WHERE id_actividad IN (${placeholders}) ORDER BY id_recurso`, ids);
  return rows.map(row => {
    const item = details.find(item => Number(item[key]) === Number(row[key]));
    return { ...row, institucional: item ? { ...item, modo: 'borrador', ...(isPlan ? { objetivos: objectives.filter(v => Number(v.id_plan) === Number(row[key])), indicador: indicators.find(v => Number(v.id_plan) === Number(row[key])) ?? null } : { recursos: resources.filter(v => Number(v.id_actividad) === Number(row[key])) }) } : null };
  });
}

async function reference(tx, table, key, value, planId) {
  if (value == null) return;
  const [rows] = await tx.execute(`SELECT ${key} FROM ${table} WHERE ${key}=? AND id_plan=? FOR UPDATE`, [value, planId]);
  if (rows.length !== 1) bad('El objetivo o indicador seleccionado no pertenece al plan de esta actividad.');
}

export async function saveDraft(tx, kind, entityId, planId, data, actorId) {
  if (data === undefined) return;
  const isPlan = kind === 'plan', table = isPlan ? 'plan_institucional' : 'actividad_institucional', key = isPlan ? 'id_plan' : 'id_actividad';
  if (!planId) bad('Es necesario asociar un plan válido para guardar la ficha institucional.');
  const [plans] = await tx.execute('SELECT id_plan FROM plan_accion WHERE id_plan=? FOR UPDATE', [planId]);
  if (plans.length !== 1) bad('El plan asociado no está disponible.');
  const [before] = await attachDrafts(tx, [{ [key]: entityId }], kind);
  if (before.institucional && (data.revision == null || data.revision !== Number(before.institucional.revision))) throw new DraftError('La ficha cambió en otra sesión. Recarga el registro antes de guardar.', 409);
  if (isPlan && data.id_proceso) {
    const [processes] = await tx.execute('SELECT id_proceso FROM proceso_institucional WHERE id_proceso=? AND activo=1 FOR UPDATE', [data.id_proceso]);
    if (processes.length !== 1) bad('Selecciona un proceso institucional activo del catálogo autorizado.');
  }
  if (!isPlan) {
    await reference(tx, 'plan_objetivo', 'id_objetivo', data.id_objetivo, planId);
    await reference(tx, 'plan_indicador', 'id_indicador', data.id_indicador, planId);
  }
  const fields = isPlan ? ['id_proceso','problema','causas','consecuencias','objetivo_general','meta_descripcion','meta_valor','meta_unidad','responsable_principal'] : ['nombre','resultado_esperado','id_objetivo','id_indicador','metodo_verificacion','prioridad','evidencias_esperadas','observaciones','instrucciones'];
  if (before.institucional) {
    await tx.execute(`UPDATE ${table} SET ${fields.map(f => `${f}=?`).join(',')},revision=revision+1 WHERE ${key}=?`, [...fields.map(f => data[f]), entityId]);
  } else {
    const insertFields = [key, ...(!isPlan ? ['id_plan'] : []), ...fields];
    await tx.execute(`INSERT INTO ${table} (${insertFields.join(',')}) VALUES (${insertFields.map(() => '?').join(',')})`, [entityId, ...(!isPlan ? [planId] : []), ...fields.map(f => data[f])]);
  }
  if (isPlan) {
    for (const [order, objective] of (data.objetivos ?? []).entries()) {
      if (objective.id) {
        await reference(tx, 'plan_objetivo', 'id_objetivo', objective.id, planId);
        await tx.execute('UPDATE plan_objetivo SET descripcion=?,orden=? WHERE id_objetivo=? AND id_plan=?', [objective.descripcion, order, objective.id, planId]);
      } else await tx.execute('INSERT INTO plan_objetivo (id_plan,descripcion,orden) VALUES (?,?,?)', [planId, objective.descripcion, order]);
    }
    if (data.indicador !== undefined) {
      const fields = ['nombre','descripcion','formula','unidad','fuente'];
      await tx.execute(`INSERT INTO plan_indicador (id_plan,${fields.join(',')}) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ${fields.map(f => `${f}=VALUES(${f})`).join(',')}`, [planId, ...fields.map(f => data.indicador[f])]);
    }
  } else {
    for (const resource of data.recursos ?? []) {
      if (resource.id) {
        const [found] = await tx.execute('SELECT id_recurso FROM actividad_recurso WHERE id_recurso=? AND id_actividad=? FOR UPDATE', [resource.id, entityId]);
        if (found.length !== 1) bad('El recurso no pertenece a esta actividad.');
        await tx.execute('UPDATE actividad_recurso SET descripcion=?,cantidad=?,costo_estimado=? WHERE id_recurso=? AND id_actividad=?', [resource.descripcion, resource.cantidad, resource.costo_estimado, resource.id, entityId]);
      } else await tx.execute('INSERT INTO actividad_recurso (id_actividad,descripcion,cantidad,costo_estimado) VALUES (?,?,?,?)', [entityId, resource.descripcion, resource.cantidad, resource.costo_estimado]);
    }
  }
  const [after] = await attachDrafts(tx, [{ [key]: entityId }], kind);
  await tx.execute('INSERT INTO registro_cambio_institucional (entidad,id_registro,actor_id,antes,despues) VALUES (?,?,?,?,?)', [kind === 'plan' ? 'plan' : 'actividad', entityId, actorId, before.institucional ? JSON.stringify(before.institucional) : null, JSON.stringify(after.institucional)]);
}
