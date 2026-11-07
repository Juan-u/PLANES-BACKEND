// One-off isolated Docker verification. Never connects to the existing test database.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';import mysql from 'mysql2';
import {hashPassword} from '../app/services/password.service.js';
import {ROLE_PERMISSION_CATALOG} from '../app/config/role-permission-matrix.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(process.argv.slice(2).join(' '),'--railway-simulation');
const directory=new URL('railway-check.tmp/',import.meta.url),backend=new URL('../',import.meta.url),frontend=new URL('../../proyecto fronted erick/',import.meta.url);
const runId=randomBytes(5).toString('hex'),project='planes-cloud-'+runId,database='planes_accion_railway_test',backendTag='planes-cloud-backend:'+runId,frontendTag='planes-cloud-frontend:'+runId;
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
 const shell='set -eu; umask 077; cfg=$(mktemp); trap \'rm -f "$cfg"\' EXIT; printf \'[client]\\nuser=root\\npassword="%s"\\n\' "$MYSQL_ROOT_PASSWORD" > "$cfg"; mysql --defaults-extra-file="$cfg" --default-character-set=utf8mb4 --batch --skip-column-names '+target;
 return(await dc(['exec','-T','db','sh','-c',shell],{input:statement})).stdout.toString().trim();
}
const q=mysql.escape;
await mkdir(directory,{recursive:true});
try{
 for(const port of [3016,4016]){let occupied=false;try{await fetch('http://127.0.0.1:'+port,{signal:AbortSignal.timeout(500)});occupied=true;}catch{}assert.equal(occupied,false,'Alternative port occupied');}
 check((await command(['image','inspect',backendTag],{allowFailure:true})).code!==0,'backend tag did not preexist');check((await command(['image','inspect',frontendTag],{allowFailure:true})).code!==0,'frontend tag did not preexist');
 const compose=`services:
  db:
    image: mysql:8.4
    environment:
      MYSQL_DATABASE: ${database}
      MYSQL_USER: fixture_app
      MYSQL_PASSWORD: \${FD_DB_PASSWORD}
      MYSQL_ROOT_PASSWORD: \${FD_ROOT}
    healthcheck:
      test: ["CMD-SHELL", "MYSQL_PWD=$\${MYSQL_ROOT_PASSWORD} mysql --protocol=tcp --host=127.0.0.1 --user=root --batch --skip-column-names --execute='SELECT 1'"]
      interval: 2s
      timeout: 3s
      retries: 45
    volumes: ["dbdata:/var/lib/mysql"]
    networks:
      default:
        aliases: [mysql.railway.internal]
  backend:
    image: ${backendTag}
    build:
      context: ${JSON.stringify(fileURLToPath(backend))}
    ports: ["127.0.0.1:3016:3000"]
    environment:
      NODE_ENV: staging
      DEPLOYMENT_PROFILE: railway-private-test
      RAILWAY_VOLUME_MOUNT_PATH: /data/evidence
      PORT: "3000"
      APP_HOST: "0.0.0.0"
      DB_HOST: mysql.railway.internal
      DB_PORT: "3306"
      DB_NAME: ${database}
      DB_USER: planes_backend
      DB_PASSWORD: \${FD_DB_PASSWORD}
      JWT_SECRET: \${FD_JWT}
      ENABLE_ROLE_PERMISSION_ROUTES: "true"
      ROLE_APPROVAL_WINDOW_MS: "86400000"
      EVIDENCE_STORAGE_DIR: /data/evidence
    networks:
      default:
        aliases: [backend.railway.internal]
    depends_on:
      db: {condition: service_healthy}
    volumes: ["evidence:/data/evidence"]
  frontend:
    image: ${frontendTag}
    build:
      context: ${JSON.stringify(fileURLToPath(frontend))}
    ports: ["127.0.0.1:4016:4000"]
    environment:
      PORT: "4000"
      APP_HOST: "0.0.0.0"
      DEPLOYMENT_PROFILE: railway-private-test
      NODE_ENV: production
      PUBLIC_ORIGIN: https://private-test.example.invalid
      SESSION_DB_HOST: mysql.railway.internal
      SESSION_DB_PORT: "3306"
      SESSION_DB_NAME: planes_accion_railway_test
      SESSION_DB_USER: planes_web_sessions
      SESSION_DB_PASSWORD: \${FD_DB_PASSWORD}
      BACKEND_API_URL: http://backend.railway.internal:3000/api
      SESSION_SECRET: \${FD_SESSION}
      APP_TIME_ZONE: America/Bogota
    depends_on: [backend]
volumes:
  dbdata: {}
  evidence: {}
`;
 await writeFile(composeURL,compose,{flag:'wx'});await dc(['config','--quiet']);console.log(JSON.stringify({phase:'building',project}));
 await dc(['build','backend','frontend'],{log:'build-'+runId+'.log'});check(true,'both application images built from existing Dockerfiles and cloud changes');
 resourcesStarted=true;console.log(JSON.stringify({phase:'starting',project}));await dc(['up','-d','db','backend','--wait','--wait-timeout','180']);
 const initializer="let data='';for await(const b of process.stdin)data+=b;Object.assign(process.env,JSON.parse(data));process.argv=['node','initialize','--initialize-new-railway-test'];await import('./deployment/railway/initialize-empty.mjs');";
 await dc(['exec','-T','backend','node','--input-type=module','-e',initializer], {input:JSON.stringify({RAILWAY_ENVIRONMENT_NAME:'private-test',BOOTSTRAP_DB_USER:'root',BOOTSTRAP_DB_PASSWORD:env.FD_ROOT,SESSION_DB_PASSWORD:env.FD_DB_PASSWORD})});
 await dc(['up','-d','frontend','--wait','--wait-timeout','60']);
 for(let attempt=0;attempt<30;attempt++){try{if((await fetch('http://127.0.0.1:4016/health/ready')).ok)break;}catch{}await pause(500);}
 check((await fetch('http://127.0.0.1:3016/health/ready')).status===200,'backend cloud schema readiness');
 check(await sql('SELECT DATABASE()')===database,'separate disposable database selected');
 check(Number(await sql('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'))===44,'cloud installation has 44 tables');
 check(Number(await sql('SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()'))===86,'clean installation has 86 foreign keys');
 check(Number(await sql('SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'))===20,'clean installation has 20 triggers');
 const emptyTables=(await sql('SHOW TABLES')).split(/\r?\n/);for(const name of emptyTables)assert.equal(Number(await sql('SELECT COUNT(*) FROM '+mysql.escapeId(name))),name==='rol_autorizacion_mutex'?1:0);check(true,'new cloud schema has only the technical mutex, no accounts or institutional rows');
 const password=randomBytes(32).toString('base64url'),passwordHash=await hashPassword(password),admin='docker-admin-'+runId+'@example.invalid',limited='docker-limited-'+runId+'@example.invalid';
 await sql(''+[admin,limited,'docker-decider-'+runId+'@example.invalid'].map((email,i)=>`INSERT INTO usuario (id_usuario,nombre,correo,\`contraseña\`,estado) VALUES (${i+1},'Cuenta sintética Docker',${q(email)},${q(passwordHash)},'Activo');`).join('\n'));
 const role=ROLE_PERMISSION_CATALOG.roles.find(r=>r.code==='system_administrator');assert.equal(role.classification,'privileged');assert.equal(role.requiresScope,false);
 await sql("INSERT INTO rol (id_rol,nombre_rol) VALUES (1,'Fixture Docker');INSERT INTO rol_configuracion (id_rol,clasificacion_privilegio,permite_vigencia_indefinida,requiere_ambito) VALUES (1,'privileged',1,0);");
 let pi=0;for(const code of role.permissions){pi++;await sql(`INSERT INTO permiso (id_permiso,codigo,activo) VALUES (${pi},${q(code)},1);INSERT INTO rol_permiso (id_rol,id_permiso,creado_en,creado_por) VALUES (1,${pi},UTC_TIMESTAMP(3),2);`);}
 const assignment=randomUUID(),request=randomUUID();await sql(`INSERT INTO rol_asignacion (id_asignacion,id_usuario,id_rol,vigente_desde,estado,creado_por,creado_en,motivo) VALUES (${q(assignment)},1,1,'2020-01-01','active',2,UTC_TIMESTAMP(3),'Synthetic fixture');INSERT INTO rol_solicitud (id_solicitud,tipo_accion,id_usuario_solicitante,id_usuario_objetivo,id_rol,id_asignacion_resultado,vigente_desde,estado,motivo,solicitada_en,vence_en) VALUES (${q(request)},'assign',2,1,1,${q(assignment)},'2020-01-01','approved','Synthetic fixture','2020-01-01','2020-01-02');INSERT INTO rol_decision (id_solicitud,tipo_actor,id_usuario_decisor,resultado,decidida_en,motivo) VALUES (${q(request)},'user',3,'approved','2020-01-01 01:00:00','Synthetic fixture');`);
 console.log(JSON.stringify({phase:'authenticating',project}));
 const base='http://127.0.0.1:3016/api',ui='http://127.0.0.1:4016';
 async function api(path,{method='GET',body,token,binary,headers={}}={}){const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:binary??(body?JSON.stringify(body):undefined),signal:AbortSignal.timeout(10000)});return{status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():await r.text()};}
 const login=await api('/login',{method:'POST',body:{correo:admin,password}});check(login.status===200&&typeof login.body.token==='string','actual backend scrypt login');const token=login.body.token;
 const restricted=await api('/login',{method:'POST',body:{correo:limited,password}});check(restricted.status===200,'restricted synthetic login');check((await api('/planes',{token:restricted.body.token})).status===403,'actual RBAC denies restricted plans');
 const caps=await api('/roles/capacidades',{token});check(caps.status===200&&caps.body.permissions.includes('M12.reports.export'),'RBAC capabilities through container-to-database connection');
 const jar=new Map();async function web(path,{body,method='GET',headers={}}={}){const r=await fetch(ui+path,{method,redirect:'manual',headers:{'X-Forwarded-Proto':'https',...(jar.size?{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(10000)});for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}return{status:r.status,headers:r.headers,text:await r.text()};}
 const webLogin=await web('/login',{method:'POST',body:{correo:admin,password}});check(webLogin.status===302&&webLogin.headers.get('location')==='/menu','actual frontend session via Docker backend DNS');
 check(/Secure/i.test(webLogin.headers.get('set-cookie'))&&/HttpOnly/i.test(webLogin.headers.get('set-cookie'))&&/SameSite=Lax/i.test(webLogin.headers.get('set-cookie')),'secure HttpOnly SameSite session cookie behind HTTPS proxy');
 check((await fetch(ui+'/login',{redirect:'manual'})).status===308,'HTTP requests redirect to fixed HTTPS origin');
 check((await fetch(ui+'/login',{method:'POST',redirect:'manual'})).status===400,'insecure writes rejected');
 await dc(['restart','frontend']);await pause(2000);
 check((await web('/planes')).status===200,'MySQL session survives frontend restart');
 const plansPage=await web('/planes');check(plansPage.status===200,'authenticated plan form');const csrf=plansPage.text.match(/name="csrfToken" value="([^\"]+)"/)[1];
 const create=await web('/planes/crear',{method:'POST',body:{csrfToken:csrf,nombre:'Plan sintético Docker',descripcion:'Ensayo Docker','institucional[objetivo_general]':'Objetivo de prueba',objective_description:'Objetivo específico de prueba'}});check(create.status===302&&!create.headers.get('location').includes('error'),'CSRF-protected plan creation via BFF');
 const planId=Number(await sql('SELECT id_plan FROM plan_accion ORDER BY id_plan DESC LIMIT 1'));
 const activity=await api('/actividades',{method:'POST',token,body:{id_plan:planId,descripcion:'Actividad Docker',responsable:'Responsable sintético',fecha_inicio:'2091-01-01',fecha_fin:'2091-03-31',estado:'Pendiente'}});check(activity.status===201,'activity persisted from container API');const activityId=activity.body.id_actividad;
 await sql("INSERT INTO periodo_seguimiento (id_periodo,anio,trimestre,fecha_inicio,fecha_fin,estado,creado_por) VALUES (1,2091,1,'2091-01-01','2091-03-31','open',1)");
 const followup=await api('/actividades/'+activityId+'/seguimientos',{method:'POST',token,body:{id_periodo:1,porcentaje:25,observaciones:'Provisional Docker'}});check(followup.status===201&&followup.body.estado==='pending','followup remains provisional');
 const upload=await api('/actividades/'+activityId+'/evidencias',{method:'POST',token,binary:Buffer.from('Synthetic Docker evidence'),headers:{'Content-Type':'application/octet-stream','X-Evidence-Name':'docker.txt','X-Evidence-Type':'text/plain','X-Followup-Id':String(followup.body.id_seguimiento)}});check(upload.status===201,'private evidence written to disposable volume');
 await dc(['restart','backend']);await pause(2000);
 const download=await api('/evidencias/'+upload.body.id_evidencia+'/descarga',{token});check(download.status===200&&download.body==='Synthetic Docker evidence','private evidence download matches uploaded content');
 for(const path of ['/menu','/usuarios','/roles','/planes','/actividades','/actividades/'+activityId,'/seguimiento?periodId=1','/informes','/informes/institucional?periodId=1','/control-interno'])check((await web(path)).status===200,'authenticated main route '+path.split('?')[0]);
 const report=await api('/informes/institucional?periodId=1',{token});check(report.status===200&&report.body.meta.character==='analitico'&&report.body.summary[0].activitiesApproved===0,'pending data does not become approved official result');
 const csv=await web('/informes/institucional/exportar/csv',{method:'POST',body:{csrfToken:csrf,periodId:'1'}});check(csv.status===200&&csv.text.includes('analitico'),'authorized CSV via frontend and CSRF');
 const print=await web('/informes/institucional/exportar/pdf',{method:'POST',body:{csrfToken:csrf,periodId:'1'}});check(print.status===200&&print.text.includes('data-report-print'),'authorized print-to-PDF page');
 check((await api('/control-interno/actuaciones/create',{method:'POST',token,body:{planId}})).status===403,'institutional CI write remains blocked');check((await api('/informes/institucional/publicar',{method:'POST',token,body:{}})).status===403,'official publication remains blocked');check((await api('/seguimientos/'+followup.body.id_seguimiento+'/decision',{method:'POST',token,body:{resultado:'approved',motivo:'Denied'}})).status===403,'followup approval remains blocked');
 const dbId=(await dc(['ps','-q','db'])).stdout.toString().trim();const backendId=(await dc(['ps','-q','backend'])).stdout.toString().trim();check((await command(['inspect','--format','{{json .HostConfig.PortBindings}}',dbId])).stdout.toString().trim().match(/^(?:\{\}|null)$/)!==null,'database has no published host port');
 const configured=(await command(['inspect','--format','{{range .Config.Env}}{{println .}}{{end}}',backendId])).stdout.toString().split(/\r?\n/);check(configured.includes('DB_HOST=mysql.railway.internal')&&configured.includes('DB_NAME='+database),'backend is configured only for new database');
 const backendBindings=(await command(['inspect','--format','{{json .HostConfig.PortBindings}}',backendId])).stdout.toString();
 check(backendBindings.includes('127.0.0.1'),'simulation backend published only to local test runner, cloud backend has no public domain');
 check(Number(await sql('SELECT COUNT(*) FROM web_sessions'))>0,'sessions persisted only in dedicated SQL table');
 const denied=await dc(['exec','-T','frontend','node','--input-type=module','-e',"import mysql from 'mysql2/promise';const c=await mysql.createConnection({host:process.env.SESSION_DB_HOST,user:process.env.SESSION_DB_USER,password:process.env.SESSION_DB_PASSWORD,database:process.env.SESSION_DB_NAME});try{await c.query('SELECT correo FROM usuario');process.exitCode=2;}catch(e){if(e.code!=='ER_TABLEACCESS_DENIED_ERROR')process.exitCode=3;}finally{await c.end();}"]);
 check(denied.code===0,'frontend SQL account cannot read users or business data');
 check((await web('/logout')).status===302,'normal logout');check((await web('/planes')).status===302,'session cannot access plans after logout');result.success=true;
}catch(error){result.success=false;let diagnostic=error.diagnostic||String(error.stack).split('\n').filter(l=>/^\s+at /.test(l)).slice(0,3).join('\n');for(const key of ['FD_ROOT','FD_DB_PASSWORD','FD_JWT','FD_SESSION'])diagnostic=diagnostic.replaceAll(env[key],'[redacted]');diagnostic=diagnostic.replace(/scrypt\$v1\$[^\s'"]+/g,'[redacted_hash]');await writeFile(new URL('diagnostic-'+runId+'.log',directory),diagnostic);result.failure=error instanceof assert.AssertionError?error.message:'Controlled Docker verification failed; raw diagnostics suppressed';console.error(JSON.stringify({phase:'failed',message:result.failure}));}
finally{
 try{if(closeBrowser)await closeBrowser();ws?.close();browser?.kill();}catch{}
 try{if(resourcesStarted)await dc(['down','--volumes','--remove-orphans']);for(const tag of [backendTag,frontendTag])await command(['image','rm',tag],{allowFailure:true});const afterContainers=await lines(['ps','-aq']),afterVolumes=await lines(['volume','ls','-q']);assert.ok(existingContainers.every(id=>afterContainers.includes(id)));assert.ok(existingVolumes.every(name=>afterVolumes.includes(name)));assert.equal((await lines(['ps','-aq','--filter','label=com.docker.compose.project='+project])).length,0);result.cleanup={ownedContainersAndVolumesRemoved:true,preexistingContainersAndVolumesPreserved:true,baseImagesAndBuildCacheNotPruned:true};}catch{result.cleanup={failed:true};result.success=false;}
 assert.equal(new URL('../',profileURL).href,directory.href);await rm(profileURL,{recursive:true,force:true});result.passed=result.checks.length;await writeFile(resultURL,JSON.stringify(result,null,2));console.log(JSON.stringify({success:result.success,project,passed:result.passed,result:fileURLToPath(resultURL),cleanup:result.cleanup,portable:result.portable}));if(!result.success)process.exitCode=1;
}
