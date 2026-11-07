import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

function localBase(value) {
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new TypeError('Only loopback service base URLs are supported.');
 return url.origin;
}
export async function checkLocal({backend='http://127.0.0.1:3000',frontend='http://127.0.0.1:4000',timeoutMs=3000,fetchImpl=fetch}={}) {
 const b=localBase(backend),f=localBase(frontend);
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw new TypeError('Invalid timeout.');
 const routes=[[b,'/',200],[b,'/api/informes/institucional',401],[b,'/api/control-interno',401],[f,'/',200],[f,'/informes/institucional',302],[f,'/control-interno',302]];
 const checks=await Promise.all(routes.map(async([base,path,expected])=>{
  try {const response=await fetchImpl(base+path,{redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});await response.body?.cancel();return {service:base===b?'backend':'frontend',path,expected,status:response.status,ok:response.status===expected};}
  catch {return {service:base===b?'backend':'frontend',path,expected,status:null,ok:false,error:'unreachable_or_timeout'};}
 }));
 return {ok:checks.every(c=>c.ok),checks,databaseVerified:false,authenticatedSessionTested:false,persistentWritesPerformed:false};
}
export function parseArgs(args) {
 const result={};for(let i=0;i<args.length;i+=2){const names={'--backend':'backend','--frontend':'frontend','--timeout':'timeoutMs'},key=names[args[i]];if(!key||args[i+1]==null)throw new TypeError('Invalid arguments.');result[key]=key==='timeoutMs'?Number(args[i+1]):args[i+1];}return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {const result=await checkLocal(parseArgs(process.argv.slice(2)));console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;}
 catch {console.error(JSON.stringify({ok:false,error:'invalid_configuration'}));process.exitCode=2;}
}
