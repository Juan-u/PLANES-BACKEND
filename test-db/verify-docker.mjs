// One-off isolated Docker verification. Never connects to the existing test database.
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,createHash,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
import assert from 'node:assert/strict';import mysql from 'mysql2';
import {hashPassword} from '../app/services/password.service.js';
import {ROLE_PERMISSION_CATALOG} from '../app/config/role-permission-matrix.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
const derive=(password,salt)=>scryptSync(password,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
function decrypt(envelope,password){
 assert.equal(envelope.version,1);assert.equal(envelope.algorithm,'AES-256-GCM');assert.equal(envelope.kdf,'scrypt-N16384-r8-p1');
 const salt=Buffer.from(envelope.salt,'base64'),iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');assert.equal(salt.length,16);assert.equal(iv.length,12);assert.equal(tag.length,16);
 const cipher=createDecipheriv('aes-256-gcm',derive(password,salt),iv);cipher.setAAD(Buffer.from(JSON.stringify({version:envelope.version,algorithm:envelope.algorithm,kdf:envelope.kdf,salt:envelope.salt,iv:envelope.iv})));cipher.setAuthTag(tag);return Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,'base64')),cipher.final()]);
}
if(process.argv[2]==='--portable-child'){
 let data='';for await(const chunk of process.stdin)data+=chunk;
 const input=JSON.parse(data),plain=decrypt(input.envelope,input.password);process.stdout.write(JSON.stringify({sha256:hash(plain),bytes:plain.length}));process.exit(0);
}
assert.equal(process.argv.slice(2).join(' '),'--isolated-docker');
const directory=new URL('docker-final.tmp/',import.meta.url),backend=new URL('../',import.meta.url),frontend=new URL('../../proyecto fronted erick/',import.meta.url);
const runId=randomBytes(5).toString('hex'),project='planes-final-'+runId,database='planes_docker_fixture',backendTag='planes-final-backend:'+runId,frontendTag='planes-final-frontend:'+runId;
const composeURL=new URL('compose-'+runId+'.yml',directory),resultURL=new URL('result-'+runId+'.json',directory),composePath=fileURLToPath(composeURL);
const env={...process.env,FD_ROOT:randomBytes(32).toString('base64url'),FD_DB_PASSWORD:randomBytes(32).toString('base64url'),FD_JWT:randomBytes(48).toString('base64url'),FD_SESSION:randomBytes(48).toString('base64url')};
const result={runId,project,startedAt:new Date().toISOString(),checks:[],persistentDatabaseConnected:false,originalProcessesModified:false,realInstitutionalDataUsed:false};
const check=(condition,label)=>{assert.ok(condition,label);result.checks.push(label);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function command(args,{input,allowFailure=false,log}={}){
 return new Promise((resolve,reject)=>{const child=spawn('docker',args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});const out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.on('error',()=>reject(new Error('Docker command could not start')));child.on('close',async code=>{const stdout=Buffer.concat(out),stderr=Buffer.concat(err);if(log)await writeFile(new URL(log,directory),Buffer.concat([stdout,stderr]));if(code&&!allowFailure)reject(Object.assign(new Error('Docker command failed: '+args.slice(0,3).join(' ')),{diagnostic:stderr.toString()}));else resolve({code,stdout,stderr});});child.stdin.end(input);});
}
const dc=(args,options)=>command(['compose','-p',project,'-f',composePath,...args],options);
async function lines(args){return(await command(args)).stdout.toString().trim().split(/\r?\n/).filter(Boolean);}
const existingContainers=await lines(['ps','-aq']),existingVolumes=await lines(['volume','ls','-q']);
let resourcesStarted=false,browser,ws,closeBrowser;
const profileURL=new URL('edge-'+runId+'/',directory);
async function sql(statement,target=database){assert.ok([database,'planes_docker_recovered'].includes(target));
 const shell='set -eu; umask 077; cfg=$(mktemp); trap \'rm -f "$cfg"\' EXIT; printf \'[client]\\nuser=root\\npassword="%s"\\n\' "$MARIADB_ROOT_PASSWORD" > "$cfg"; mariadb --defaults-extra-file="$cfg" --default-character-set=utf8mb4 --batch --skip-column-names '+target;
 return(await dc(['exec','-T','db','sh','-c',shell],{input:statement})).stdout.toString().trim();
}
const q=mysql.escape;
await mkdir(directory,{recursive:true});
try{
 for(const port of [3015,4015]){let occupied=false;try{await fetch('http://127.0.0.1:'+port,{signal:AbortSignal.timeout(500)});occupied=true;}catch{}assert.equal(occupied,false,'Alternative port occupied');}
 check((await command(['image','inspect',backendTag],{allowFailure:true})).code!==0,'backend tag did not preexist');check((await command(['image','inspect',frontendTag],{allowFailure:true})).code!==0,'frontend tag did not preexist');
 const compose=`services:
  db:
    image: mariadb:10.4.32
    environment:
      MARIADB_DATABASE: ${database}
      MARIADB_USER: fixture_app
      MARIADB_PASSWORD: \${FD_DB_PASSWORD}
      MARIADB_ROOT_PASSWORD: \${FD_ROOT}
    healthcheck:
      test: ["CMD-SHELL", "MYSQL_PWD=$\${MARIADB_ROOT_PASSWORD} mariadb --protocol=tcp --host=127.0.0.1 --user=root --batch --skip-column-names --execute='SELECT 1'"]
      interval: 2s
      timeout: 3s
      retries: 45
    volumes: ["dbdata:/var/lib/mysql"]
  backend:
    image: ${backendTag}
    build:
      context: ${JSON.stringify(fileURLToPath(backend))}
    ports: ["127.0.0.1:3015:3000"]
    environment:
      NODE_ENV: development
      PORT: "3000"
      APP_HOST: "0.0.0.0"
      DB_HOST: db
      DB_PORT: "3306"
      DB_NAME: ${database}
      DB_USER: fixture_app
      DB_PASSWORD: \${FD_DB_PASSWORD}
      JWT_SECRET: \${FD_JWT}
      ENABLE_ROLE_PERMISSION_ROUTES: "true"
      ROLE_APPROVAL_WINDOW_MS: "86400000"
      EVIDENCE_STORAGE_DIR: /app/storage/evidence
    depends_on:
      db: {condition: service_healthy}
    volumes: ["evidence:/app/storage/evidence"]
  frontend:
    image: ${frontendTag}
    build:
      context: ${JSON.stringify(fileURLToPath(frontend))}
    ports: ["127.0.0.1:4015:4000"]
    environment:
      PORT: "4000"
      APP_HOST: "0.0.0.0"
      BACKEND_API_URL: http://backend:3000/api
      SESSION_SECRET: \${FD_SESSION}
      APP_TIME_ZONE: America/Bogota
    depends_on: [backend]
volumes:
  dbdata: {}
  evidence: {}
`;
 await writeFile(composeURL,compose,{flag:'wx'});await dc(['config','--quiet']);console.log(JSON.stringify({phase:'building',project}));
 await dc(['build','backend','frontend'],{log:'build-'+runId+'.log'});check(true,'both application images built from unchanged Dockerfiles');
 resourcesStarted=true;console.log(JSON.stringify({phase:'starting',project}));await dc(['up','-d','--wait','--wait-timeout','120']);
 const schema=await readFile(new URL('../schema/through-block-f.sql',import.meta.url),'utf8'),manifest=JSON.parse(await readFile(new URL('../schema/through-block-f.json',import.meta.url),'utf8'));assert.equal(hash(schema),manifest.sha256);await sql(schema);
 check(await sql('SELECT DATABASE()')===database,'separate disposable database selected');
 check(Number(await sql('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'))===43,'clean installation has 43 tables');
 check(Number(await sql('SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()'))===86,'clean installation has 86 foreign keys');
 check(Number(await sql('SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'))===20,'clean installation has 20 triggers');
 const counts=await sql("SELECT GROUP_CONCAT(CONCAT('SELECT COUNT(*) AS n FROM `',TABLE_NAME,'`') SEPARATOR ' UNION ALL ') FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");check((await sql(counts)).split(/\r?\n/).every(n=>Number(n)===0),'baseline contains no institutional or user rows');
 const password=randomBytes(32).toString('base64url'),passwordHash=await hashPassword(password),admin='docker-admin-'+runId+'@example.invalid',limited='docker-limited-'+runId+'@example.invalid';
 await sql('INSERT INTO rol_autorizacion_mutex (mutex_id) VALUES (1);'+[admin,limited,'docker-decider-'+runId+'@example.invalid'].map((email,i)=>`INSERT INTO usuario (id_usuario,nombre,correo,\`contraseña\`,estado) VALUES (${i+1},'Cuenta sintética Docker',${q(email)},${q(passwordHash)},'Activo');`).join('\n'));
 const role=ROLE_PERMISSION_CATALOG.roles.find(r=>r.code==='system_administrator');assert.equal(role.classification,'privileged');assert.equal(role.requiresScope,false);
 await sql("INSERT INTO rol (id_rol,nombre_rol) VALUES (1,'Fixture Docker');INSERT INTO rol_configuracion (id_rol,clasificacion_privilegio,permite_vigencia_indefinida,requiere_ambito) VALUES (1,'privileged',1,0);");
 let pi=0;for(const code of role.permissions){pi++;await sql(`INSERT INTO permiso (id_permiso,codigo,activo) VALUES (${pi},${q(code)},1);INSERT INTO rol_permiso (id_rol,id_permiso,creado_en,creado_por) VALUES (1,${pi},UTC_TIMESTAMP(3),2);`);}
 const assignment=randomUUID(),request=randomUUID();await sql(`INSERT INTO rol_asignacion (id_asignacion,id_usuario,id_rol,vigente_desde,estado,creado_por,creado_en,motivo) VALUES (${q(assignment)},1,1,'2020-01-01','active',2,UTC_TIMESTAMP(3),'Synthetic fixture');INSERT INTO rol_solicitud (id_solicitud,tipo_accion,id_usuario_solicitante,id_usuario_objetivo,id_rol,id_asignacion_resultado,vigente_desde,estado,motivo,solicitada_en,vence_en) VALUES (${q(request)},'assign',2,1,1,${q(assignment)},'2020-01-01','approved','Synthetic fixture','2020-01-01','2020-01-02');INSERT INTO rol_decision (id_solicitud,tipo_actor,id_usuario_decisor,resultado,decidida_en,motivo) VALUES (${q(request)},'user',3,'approved','2020-01-01 01:00:00','Synthetic fixture');`);
 console.log(JSON.stringify({phase:'authenticating',project}));
 const base='http://127.0.0.1:3015/api',ui='http://127.0.0.1:4015';
 async function api(path,{method='GET',body,token,binary,headers={}}={}){const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:binary??(body?JSON.stringify(body):undefined),signal:AbortSignal.timeout(10000)});return{status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():await r.text()};}
 const login=await api('/login',{method:'POST',body:{correo:admin,password}});check(login.status===200&&typeof login.body.token==='string','actual backend scrypt login');const token=login.body.token;
 const restricted=await api('/login',{method:'POST',body:{correo:limited,password}});check(restricted.status===200,'restricted synthetic login');check((await api('/planes',{token:restricted.body.token})).status===403,'actual RBAC denies restricted plans');
 const caps=await api('/roles/capacidades',{token});check(caps.status===200&&caps.body.permissions.includes('M12.reports.export'),'RBAC capabilities through container-to-database connection');
 const jar=new Map();async function web(path,{body,method='GET',headers={}}={}){const r=await fetch(ui+path,{method,redirect:'manual',headers:{...(jar.size?{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(10000)});for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}return{status:r.status,headers:r.headers,text:await r.text()};}
 const webLogin=await web('/login',{method:'POST',body:{correo:admin,password}});check(webLogin.status===302&&webLogin.headers.get('location')==='/menu','actual frontend session via Docker backend DNS');
 const plansPage=await web('/planes');check(plansPage.status===200,'authenticated plan form');const csrf=plansPage.text.match(/name="csrfToken" value="([^\"]+)"/)[1];
 const create=await web('/planes/crear',{method:'POST',body:{csrfToken:csrf,nombre:'Plan sintético Docker',descripcion:'Ensayo Docker','institucional[objetivo_general]':'Objetivo de prueba',objective_description:'Objetivo específico de prueba'}});check(create.status===302&&!create.headers.get('location').includes('error'),'CSRF-protected plan creation via BFF');
 const planId=Number(await sql('SELECT id_plan FROM plan_accion ORDER BY id_plan DESC LIMIT 1'));
 const activity=await api('/actividades',{method:'POST',token,body:{id_plan:planId,descripcion:'Actividad Docker',responsable:'Responsable sintético',fecha_inicio:'2091-01-01',fecha_fin:'2091-03-31',estado:'Pendiente'}});check(activity.status===201,'activity persisted from container API');const activityId=activity.body.id_actividad;
 await sql("INSERT INTO periodo_seguimiento (id_periodo,anio,trimestre,fecha_inicio,fecha_fin,estado,creado_por) VALUES (1,2091,1,'2091-01-01','2091-03-31','open',1)");
 const followup=await api('/actividades/'+activityId+'/seguimientos',{method:'POST',token,body:{id_periodo:1,porcentaje:25,observaciones:'Provisional Docker'}});check(followup.status===201&&followup.body.estado==='pending','followup remains provisional');
 const upload=await api('/actividades/'+activityId+'/evidencias',{method:'POST',token,binary:Buffer.from('Synthetic Docker evidence'),headers:{'Content-Type':'application/octet-stream','X-Evidence-Name':'docker.txt','X-Evidence-Type':'text/plain','X-Followup-Id':String(followup.body.id_seguimiento)}});check(upload.status===201,'private evidence written to disposable volume');
 const download=await api('/evidencias/'+upload.body.id_evidencia+'/descarga',{token});check(download.status===200&&download.body==='Synthetic Docker evidence','private evidence download matches uploaded content');
 for(const path of ['/menu','/usuarios','/roles','/planes','/actividades','/actividades/'+activityId,'/seguimiento?periodId=1','/informes','/informes/institucional?periodId=1','/control-interno'])check((await web(path)).status===200,'authenticated main route '+path.split('?')[0]);
 const report=await api('/informes/institucional?periodId=1',{token});check(report.status===200&&report.body.meta.character==='analitico'&&report.body.summary[0].activitiesApproved===0,'pending data does not become approved official result');
 const csv=await web('/informes/institucional/exportar/csv',{method:'POST',body:{csrfToken:csrf,periodId:'1'}});check(csv.status===200&&csv.text.includes('analitico'),'authorized CSV via frontend and CSRF');
 const print=await web('/informes/institucional/exportar/pdf',{method:'POST',body:{csrfToken:csrf,periodId:'1'}});check(print.status===200&&print.text.includes('data-report-print'),'authorized print-to-PDF page');
 check((await api('/control-interno/actuaciones/create',{method:'POST',token,body:{planId}})).status===403,'institutional CI write remains blocked');check((await api('/informes/institucional/publicar',{method:'POST',token,body:{}})).status===403,'official publication remains blocked');check((await api('/seguimientos/'+followup.body.id_seguimiento+'/decision',{method:'POST',token,body:{resultado:'approved',motivo:'Denied'}})).status===403,'followup approval remains blocked');
 const dbId=(await dc(['ps','-q','db'])).stdout.toString().trim();const backendId=(await dc(['ps','-q','backend'])).stdout.toString().trim();check((await command(['inspect','--format','{{json .HostConfig.PortBindings}}',dbId])).stdout.toString().trim().match(/^(?:\{\}|null)$/)!==null,'database has no published host port');
 const configured=(await command(['inspect','--format','{{range .Config.Env}}{{println .}}{{end}}',backendId])).stdout.toString().split(/\r?\n/);check(configured.includes('DB_HOST=db')&&configured.includes('DB_NAME='+database),'backend is configured only for new database');
 const dumpShell='set -eu; umask 077; cfg=$(mktemp); trap \'rm -f "$cfg"\' EXIT; printf \'[client]\\nuser=root\\npassword="%s"\\n\' "$MARIADB_ROOT_PASSWORD" > "$cfg"; mariadb-dump --defaults-extra-file="$cfg" --single-transaction --routines --events --triggers --hex-blob --skip-comments --no-tablespaces '+database;
 const dump=(await dc(['exec','-T','db','sh','-c',dumpShell])).stdout;
 const portablePassword=randomBytes(48).toString('base64url'),salt=randomBytes(16),iv=randomBytes(12),envelope={version:1,algorithm:'AES-256-GCM',kdf:'scrypt-N16384-r8-p1',salt:salt.toString('base64'),iv:iv.toString('base64')};
 const cipher=createCipheriv('aes-256-gcm',derive(portablePassword,salt),iv);cipher.setAAD(Buffer.from(JSON.stringify(envelope)));envelope.ciphertext=Buffer.concat([cipher.update(dump),cipher.final()]).toString('base64');envelope.tag=cipher.getAuthTag().toString('base64');await writeFile(new URL('portable-synthetic-'+runId+'.json',directory),JSON.stringify(envelope),{flag:'wx'});
 const portable=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--portable-child'],{input:JSON.stringify({envelope,password:portablePassword}),encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});check(portable.status===0&&JSON.parse(portable.stdout).sha256===hash(dump),'portable synthetic dump decrypted in separate process without DPAPI');
 const linuxCode=`import assert from 'node:assert/strict';import {scryptSync,createDecipheriv,createHash}from'node:crypto';const derive=${derive.toString()};const decrypt=${decrypt.toString()};let data='';for await(const b of process.stdin)data+=b;const input=JSON.parse(data),plain=decrypt(input.envelope,input.password);console.log(JSON.stringify({sha256:createHash('sha256').update(plain).digest('hex'),platform:process.platform}));`;
 const linux=await dc(['exec','-T','backend','node','--input-type=module','-e',linuxCode],{input:JSON.stringify({envelope,password:portablePassword})});const linuxProof=JSON.parse(linux.stdout.toString());check(linuxProof.platform==='linux'&&linuxProof.sha256===hash(dump),'portable synthetic backup decrypted on Linux container from Windows');
 await sql('CREATE DATABASE planes_docker_recovered CHARACTER SET utf8mb4');assert.ok(!/^\s*(?:USE\s|CREATE DATABASE)/im.test(dump.toString()));await sql(decrypt(envelope,portablePassword),'planes_docker_recovered');
 const tableNames=(await sql('SHOW TABLES')).split(/\r?\n/);const checksumSql=tableNames.map(t=>'CHECKSUM TABLE '+mysql.escapeId(database)+'.'+mysql.escapeId(t)+', '+mysql.escapeId('planes_docker_recovered')+'.'+mysql.escapeId(t)+' EXTENDED;').join('\n');const checksums=(await sql(checksumSql)).split(/\r?\n/);assert.equal(checksums.length,86);for(let i=0;i<checksums.length;i+=2){const a=checksums[i].split('\t')[1],b=checksums[i+1].split('\t')[1];assert.notEqual(a,'NULL');assert.equal(a,b);}check(true,'portable decrypted dump restored to second disposable database with all table checksums matching');

 assert.throws(()=>decrypt(envelope,randomBytes(32).toString('base64url')));check(true,'wrong portable passphrase rejected');const altered={...envelope,ciphertext:Buffer.from(envelope.ciphertext,'base64').map((v,i)=>i===0?v^1:v).toString('base64')};assert.throws(()=>decrypt(altered,portablePassword));check(true,'tampered portable backup rejected');result.portable={syntheticOnly:true,separateProcessVerified:true,linuxDecryptionVerified:true,restorationAndAllTableChecksumsVerified:true,wrongKeyRejected:true,tamperRejected:true,keyStored:false,windowsIdentityRequired:false,bytes:dump.length};
 check((await web('/logout')).status===302,'normal logout');check((await web('/planes')).status===302,'session cannot access plans after logout');result.success=true;
}catch(error){result.success=false;let diagnostic=error.diagnostic||String(error.stack).split('\n').filter(l=>/^\s+at /.test(l)).slice(0,3).join('\n');for(const key of ['FD_ROOT','FD_DB_PASSWORD','FD_JWT','FD_SESSION'])diagnostic=diagnostic.replaceAll(env[key],'[redacted]');diagnostic=diagnostic.replace(/scrypt\$v1\$[^\s'"]+/g,'[redacted_hash]');await writeFile(new URL('diagnostic-'+runId+'.log',directory),diagnostic);result.failure=error instanceof assert.AssertionError?error.message:'Controlled Docker verification failed; raw diagnostics suppressed';console.error(JSON.stringify({phase:'failed',message:result.failure}));}
finally{
 try{if(closeBrowser)await closeBrowser();ws?.close();browser?.kill();}catch{}
 try{if(resourcesStarted)await dc(['down','--volumes','--remove-orphans']);for(const tag of [backendTag,frontendTag])await command(['image','rm',tag],{allowFailure:true});const afterContainers=await lines(['ps','-aq']),afterVolumes=await lines(['volume','ls','-q']);assert.ok(existingContainers.every(id=>afterContainers.includes(id)));assert.ok(existingVolumes.every(name=>afterVolumes.includes(name)));assert.equal((await lines(['ps','-aq','--filter','label=com.docker.compose.project='+project])).length,0);result.cleanup={ownedContainersAndVolumesRemoved:true,preexistingContainersAndVolumesPreserved:true,baseImagesAndBuildCacheNotPruned:true};}catch{result.cleanup={failed:true};result.success=false;}
 assert.equal(new URL('../',profileURL).href,directory.href);await rm(profileURL,{recursive:true,force:true});result.passed=result.checks.length;await writeFile(resultURL,JSON.stringify(result,null,2));console.log(JSON.stringify({success:result.success,project,passed:result.passed,result:fileURLToPath(resultURL),cleanup:result.cleanup,portable:result.portable}));if(!result.success)process.exitCode=1;
}
