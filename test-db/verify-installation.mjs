// Validates a schema-only installation in a generated empty database, never the source.
import mysql from 'mysql2/promise';import dotenv from 'dotenv';import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';import{createHash,randomBytes}from'node:crypto';
assert.equal(process.argv.slice(2).join(' '),'--disposable-3307');
const env=dotenv.parse(await readFile(new URL('.env.test',import.meta.url))),target='planes_install_'+randomBytes(6).toString('hex');
const db=await mysql.createConnection({host:'127.0.0.1',port:3307,user:'root',password:env.TEST_DB_ROOT_PASSWORD,database:'planes_accion_test',dateStrings:true,supportBigNumbers:true,bigNumberStrings:true});
const hash=s=>createHash('sha256').update(s).digest('hex');let created=false;
async function sourceState(){const[tables]=await db.query('SHOW TABLES FROM planes_accion_test');const result={};for(const row of tables){const t=Object.values(row)[0],[[ddl]]=await db.query('SHOW CREATE TABLE planes_accion_test.'+mysql.escapeId(t)),[rows]=await db.query('SELECT * FROM planes_accion_test.'+mysql.escapeId(t));result[t]={ddl:ddl['Create Table'],count:rows.length,hash:hash(rows.map(r=>JSON.stringify(r)).sort().join('\n'))};}return result;}
try{
 assert.equal(db.connection.stream.remotePort,3307);const original=await sourceState();assert.equal(Object.keys(original).length,43);assert.equal(Object.values(original).reduce((n,r)=>n+r.count,0),171);
 const sql=await readFile(new URL('../schema/through-block-f.sql',import.meta.url),'utf8'),manifest=JSON.parse(await readFile(new URL('../schema/through-block-f.json',import.meta.url),'utf8'));assert.equal(hash(sql),manifest.sha256);
 const statements=sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);assert.equal(statements.length,63);assert.ok(statements.every(s=>/^CREATE (TABLE|TRIGGER) /.test(s)));
 assert.match(target,/^planes_install_[a-f0-9]{12}$/);await db.query('CREATE DATABASE '+mysql.escapeId(target)+' CHARACTER SET utf8mb4');created=true;await db.query('USE '+mysql.escapeId(target));
 for(const statement of statements){assert.equal((await db.query('SELECT DATABASE() AS db'))[0][0].db,target);await db.query(statement);}
 for(const[name,digest]of Object.entries(manifest.definitions)){const[[ddl]]=await db.query('SHOW CREATE TABLE '+mysql.escapeId(name));assert.equal(hash(ddl['Create Table'].replace(/ AUTO_INCREMENT=\d+/g,'')),digest);assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM '+mysql.escapeId(name)))[0][0].n),0);}
 const[[fks]]=await db.query('SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=?',[target]),[[triggers]]=await db.query('SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?',[target]);assert.equal(Number(fks.n),86);assert.equal(Number(triggers.n),20);
 assert.deepEqual(await sourceState(),original);console.log(JSON.stringify({schemaInstallationPassed:true,tables:43,foreignKeys:86,triggers:20,recordsInstalled:0,sourceUnchanged:true,sourceRecords:171}));
}catch(error){console.error(JSON.stringify({ok:false,error:error instanceof assert.AssertionError?'schema_validation_failed':'isolated_installation_failed',code:error.code||null}));process.exitCode=1;}
finally{if(created){assert.match(target,/^planes_install_[a-f0-9]{12}$/);await db.query('DROP DATABASE '+mysql.escapeId(target));}await db.end();}
