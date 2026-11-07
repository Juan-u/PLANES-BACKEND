import {IntegrationError} from '../services/quarterly-integration.rules.js';
import {WorkflowError} from '../services/plan-workflow.rules.js';
import {reportCsv} from '../services/institutional-report.rules.js';
export function createInstitutionalReportsController({reports,control}){
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','private, no-store');return await fn(req,res);}catch(e){if(e instanceof IntegrationError||e instanceof WorkflowError)return res.status(e.status).json({code:e.code});if(e.code==='ER_NO_SUCH_TABLE')return res.status(503).json({code:'REPORTS_NOT_ACTIVATED'});return res.status(503).json({code:'REPORT_TEMPORARILY_UNAVAILABLE'});}};
 const context=req=>({actorId:req.usuario?.sub});
 return {
  query:wrap(async(req,res)=>res.json(await reports.query(context(req),req.query))),
  controlQuery:wrap(async(req,res)=>res.json(await reports.controlQuery(context(req),req.query))),
  csv:wrap(async(req,res)=>{const data=await reports.export(context(req),req.query,'csv');return res.type('text/csv; charset=utf-8').attachment('informe-'+data.meta.id+'.csv').send(reportCsv(data));}),
  print:wrap(async(req,res)=>res.json(await reports.export(context(req),req.query,'print'))),
  publish:wrap(async(req,res)=>res.json(await reports.publish(context(req)))),
  list:wrap(async(req,res)=>res.json(await control.list(context(req),req.query))),
  detail:wrap(async(req,res)=>res.json(await control.detail(context(req),req.params.id))),
  act:wrap(async(req,res)=>res.json(await control.act(context(req),req.params.action,req.body)))
 };
}
