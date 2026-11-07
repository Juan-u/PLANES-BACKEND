// Explicit isolated integration harness. Never runs as part of the normal unit suite.
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { crearControladorConsultaPlanes } from '../app/controllers/controller.plan.js';
import { createActivityController } from '../app/controllers/controller.activity.js';

if (process.argv.slice(2).join(' ') !== '--isolated-3307') throw new Error('Use --isolated-3307 explicitly.');
const env = dotenv.parse(await readFile(new URL('.env.test', import.meta.url)));
const options = { host: '127.0.0.1', port: 3307, user: 'root', password: env.TEST_DB_ROOT_PASSWORD, database: 'planes_accion_test' };
assert.ok(options.password, 'The isolated root credential is required.');
const db = await mysql.createConnection(options);
const suffix = randomBytes(4).toString('hex');
const target = `planes_blockc_${suffix}`, recovery = `planes_blockc_restore_${suffix}`;
const bases = ['rol','usuario','plan_accion','actividad','historico'];
let pool;
let passed = 0;
const check = (condition, message) => { assert.ok(condition, message); passed++; };
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const call = async (fn, body = {}, id) => { const res = response(); await fn({ body, params: { id: String(id) }, query: {}, usuario: { sub: '1001' } }, res); return res; };
async function select(schema) {
  assert.ok([target, recovery, 'planes_accion_test'].includes(schema));
  assert.equal(db.connection.stream.remotePort, 3307);
  await db.query(`USE \`${schema}\``);
  const [[row]] = await db.query('SELECT DATABASE() AS db');
  assert.equal(row.db, schema);
}
async function migration(direction) {
  await select(target);
  const sql = await readFile(new URL(`../migrations/20261102_institutional_drafts.${direction}.sql`, import.meta.url), 'utf8');
  for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
}
try {
  await select('planes_accion_test');
  const [[server]] = await db.query('SELECT @@version AS version');
  check(server.version.includes('MariaDB'), 'Expected isolated MariaDB.');
  const ddl = [];
  for (const table of bases) { const [[row]] = await db.query(`SHOW CREATE TABLE \`${table}\``); ddl.push(row['Create Table'].replace(/ AUTO_INCREMENT=\d+/g, '')); }
  // This backup is schema-only: no existing users, hashes, plans or other records are copied.
  await db.query(`CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4`);
  await select(target);
  for (const statement of ddl) await db.query(statement);
  const backup = JSON.stringify({ target, host: options.host, port: options.port, ddl });
  const digest = value => createHash('sha256').update(value).digest('hex');
  const directory = new URL('institutional-backups.tmp/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const path = new URL(`${suffix}.json`, directory);
  await writeFile(path, backup, { flag: 'wx' });
  const saved = await readFile(path, 'utf8');
  check(digest(saved) === digest(backup), 'Backup checksum verified.');
  await db.query(`CREATE DATABASE \`${recovery}\` CHARACTER SET utf8mb4`);
  await select(recovery);
  for (const statement of JSON.parse(saved).ddl) await db.query(statement);
  const [restored] = await db.query('SHOW TABLES');
  check(restored.length === bases.length, 'Backup successfully restored before migration.');
  await migration('up');
  // Disabled synthetic row solely satisfies the existing actor FK; it is not a login credential.
  await db.execute('INSERT INTO usuario (id_usuario,nombre,correo,`contrase\u00f1a`,estado) VALUES (1001,?,?,?,?)', ['Persistence fixture', 'fixture@example.invalid', 'NOT_A_LOGIN_HASH', 'inactivo']);
  await db.execute('INSERT INTO proceso_institucional (nombre) VALUES (?)', ['Proceso sintético de prueba']);
  pool = mysql.createPool({ ...options, database: target, connectionLimit: 2 });
  const plan = crearControladorConsultaPlanes(pool), activity = createActivityController(pool);
  const input = { nombre: 'Borrador sintético', institucional: { id_proceso: 1, problema: 'Situación', objetivo_general: 'Mejorar', meta_valor: '0.0000', responsable_principal: 'Propuesto', objetivos: [{ descripcion: 'Objetivo A' }], indicador: { nombre: 'Indicador', descripcion: 'Medición', formula: 'real/meta*100', unidad: '%', fuente: 'Fuente de prueba' } } };
  const created = await call(plan.crearPlan, input);
  check(created.statusCode === 201, 'Plan and institutional draft persisted.');
  const id = created.body.id_plan;
  let fetched = await call(plan.obtenerPlan, {}, id);
  check(fetched.body.institucional.meta_valor === '0.0000', 'Zero decimal preserved exactly.');
  check(fetched.body.estado == null && fetched.body.institucional.modo === 'borrador', 'No approval transition.');
  check(fetched.body.institucional.problema === 'Situación' && fetched.body.institucional.responsable_principal === 'Propuesto', 'Institutional text fields survive a database round trip.');
  const objective = fetched.body.institucional.objetivos[0].id, indicator = fetched.body.institucional.indicador.id_indicador;
  const a = await call(activity.create, { id_plan: id, responsable: 'Responsable', fecha_inicio: '2026-11-02', fecha_fin: '2026-11-06', institucional: { nombre: 'Actividad', id_objetivo: objective, id_indicador: indicator, prioridad: 'alta', recursos: [{ descripcion: 'Equipo', cantidad: '2.5000', costo_estimado: '100.20' }], metodo_verificacion: 'Acta', evidencias_esperadas: 'Documento', observaciones: 'Nota', instrucciones: 'Instrucción' } });
  check(a.statusCode === 201, 'Activity fields and resources persisted.');
  const aid = a.body.id_actividad, af = await call(activity.getById, {}, aid);
  check(af.body.institucional.recursos[0].costo_estimado === '100.20', 'Resource decimals preserved.');
  check(af.body.fecha_inicio === '2026-11-02', 'Date calendar value unchanged.');
  check(af.body.institucional.instrucciones === 'Instrucción' && af.body.institucional.evidencias_esperadas === 'Documento' && af.body.institucional.prioridad === 'alta', 'Activity formulation fields survive a database round trip.');
  const updated = await call(plan.actualizarPlan, { ...input, nombre: 'Edición', institucional: { ...input.institucional, revision: 1, objetivos: [{ id: objective, descripcion: 'Objetivo editado' }] } }, id);
  check(updated.statusCode === 200, 'Institutional plan edit persisted.');
  const stale = await call(plan.actualizarPlan, { ...input, nombre: 'NO DEBE GUARDARSE', institucional: { revision: 1 } }, id);
  check(stale.statusCode === 409, 'Stale revision rejected.');
  fetched = await call(plan.obtenerPlan, {}, id);
  check(fetched.body.nombre === 'Edición' && fetched.body.institucional.revision === 2, 'Base-row change rolled back on conflict.');
  check(fetched.body.institucional.objetivos[0].id === objective && fetched.body.institucional.indicador.id_indicador === indicator, 'Linked IDs remain stable.');
  const p2 = await call(plan.crearPlan, { nombre: 'Otro plan', institucional: { objetivos: [{ descripcion: 'Objetivo ajeno' }] } });
  const other = await call(plan.obtenerPlan, {}, p2.body.id_plan);
  const invalid = await call(activity.update, { descripcion: 'NO GUARDAR', institucional: { revision: 1, id_objetivo: other.body.institucional.objetivos[0].id } }, aid);
  check(invalid.statusCode === 400, 'Cross-plan reference rejected.');
  const still = await call(activity.getById, {}, aid);
  check(still.body.descripcion == null && still.body.institucional.revision === 1, 'Activity and draft both rolled back.');
  const edit = await call(activity.update, { descripcion: 'Actualizada', responsable: 'Responsable', institucional: { revision: 1, nombre: 'Nombre editado', prioridad: 'media', recursos: [{ id: still.body.institucional.recursos[0].id, descripcion: 'Equipo editado', cantidad: '0', costo_estimado: '0.00' }] } }, aid);
  check(edit.statusCode === 200, 'Activity institutional edit persisted.');
  const edited = await call(activity.getById, {}, aid);
  check(edited.body.institucional.recursos[0].id === still.body.institucional.recursos[0].id && edited.body.institucional.recursos[0].costo_estimado === '0.00', 'Resource update preserves its ID and zero cost.');
  const wrongResource = await call(activity.update, { institucional: { revision: 2, recursos: [{ id: 2147483647, descripcion: 'No corresponde' }] } }, aid);
  check(wrongResource.statusCode === 400 && (await call(activity.getById, {}, aid)).body.institucional.revision === 2, 'Unknown resource is rejected without partial writes.');
  const blank = await call(plan.crearPlan, { nombre: 'Incompleto', institucional: {} });
  check(blank.statusCode === 201, 'Incomplete draft persisted without invented values.');
  const [[audit]] = await db.query('SELECT COUNT(*) AS n FROM registro_cambio_institucional');
  check(audit.n === 6, 'Only committed draft changes have before/after audit entries.');
  const [[beforeDown]] = await db.query('SELECT COUNT(*) AS n FROM plan_accion');
  await migration('down');
  const [[afterDown]] = await db.query('SELECT COUNT(*) AS n FROM plan_accion');
  check(beforeDown.n === afterDown.n, 'Down migration preserves legacy plan records.');
  check((await call(plan.obtenerPlan, {}, id)).body.nombre === 'Edición', 'Legacy reads continue before the new schema is reapplied.');
  await migration('up');
  check((await call(plan.obtenerPlan, {}, id)).body.institucional == null, 'Up/down/up round trip succeeds.');
  console.log(JSON.stringify({ passed, target, restoredBackup: true, migration: 'up/down/up', commercialDataAccessed: false, existingTestDataModified: false }));
} catch (error) {
  // Never emit database errors, connection options, SQL parameters or credentials.
  console.error(`Isolated verification failed: ${error instanceof assert.AssertionError ? error.message : 'check failed; inspect the harness locally'}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
  // These names are generated by this invocation, validated, and never supplied externally.
  for (const schema of [recovery, target]) {
    assert.match(schema, /^planes_blockc_(restore_)?[0-9a-f]{8}$/);
    await db.query(`DROP DATABASE IF EXISTS \`${schema}\``);
  }
  await db.end();
}
