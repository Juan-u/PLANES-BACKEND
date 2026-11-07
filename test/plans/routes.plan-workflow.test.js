import assert from 'node:assert/strict';import {test,mock,after}from'node:test';import {randomBytes}from'node:crypto';import express from'express';import jwt from'jsonwebtoken';
const secret=randomBytes(48).toString('base64url');let permission=false,writes=0;
const pool={async query(){return[[{id_usuario:1,estado:'activo'}],[]];},async getConnection(){return {async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(){return[[],[]];},async execute(sql){if(!sql.startsWith('SELECT'))writes++;if(sql.includes('FROM usuario'))return[[{id_usuario:1}],[]];if(sql.includes('rol_autorizacion_mutex'))return[[{mutex_id:1}],[]];if(sql.startsWith('SELECT EXISTS'))return[[{authorized:permission?1:0}],[]];return[[],[]];}};}};
mock.module('../../app/config/auth.js',{namedExports:{JWT_SECRET:secret}});mock.module('../../app/config/db.js',{defaultExport:pool});
const {createPlanWorkflowRouter}=await import('../../app/routes/routes.plan-workflow.js');
const app=express();app.use(express.json());app.use('/api',createPlanWorkflowRouter({pool,authority:{permissionFor:()=> 'M03.plans.approve',authorize:async()=>({allowed:true})}}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const url='http://127.0.0.1:'+server.address().port;
after(()=>new Promise(resolve=>server.close(resolve)));
test('every workflow read and write route requires a real verified JWT',async()=>{
  for(const [method,path]of [['GET','/planeacion'],['GET','/planes/1/flujo'],['GET','/planes/1/flujo/validacion'],['POST','/planes/1/flujo/ficha'],['POST','/planes/1/flujo/acciones']]){
    const r=await fetch(url+'/api'+path,{method});assert.equal(r.status,401);
  }
  assert.equal(writes,0);
});
test('valid JWT without effective read permission cannot query the institutional inbox',async()=>{
  permission=false;const token=jwt.sign({sub:'1'},secret,{algorithm:'HS256',expiresIn:'1m'});
  const r=await fetch(url+'/api/planeacion',{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,403);assert.deepEqual(await r.json(),{code:'FORBIDDEN'});assert.equal(writes,0);
});
test('neither all permission results, router options nor client authority claims activate approval',async()=>{
  permission=true;const token=jwt.sign({sub:'1'},secret,{algorithm:'HS256',expiresIn:'1m'});
  const r=await fetch(url+'/api/planes/1/flujo/acciones',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'aprobar',revision:1,authority:{allowed:true},role:'Planeacion',actorId:999})});
  assert.equal(r.status,403);assert.deepEqual(await r.json(),{code:'AUTHORITY_NOT_CONFIGURED'});assert.equal(writes,0);
});
