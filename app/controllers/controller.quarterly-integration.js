import {IntegrationError} from '../services/quarterly-integration.rules.js';
import {WorkflowError,positiveId} from '../services/plan-workflow.rules.js';
export function createQuarterlyIntegrationController(service){
  const invoke=fn=>async(req,res)=>{try{return res.json(await fn({actorId:positiveId(req.usuario?.sub)},req));}catch(error){
    if(error instanceof IntegrationError||error instanceof WorkflowError)return res.status(error.status).json({code:error.code});
    return res.status(503).json({code:error.code==='ER_NO_SUCH_TABLE'?'INTEGRATION_NOT_ACTIVATED':'INTEGRATION_UNAVAILABLE'});
  }};
  return {overview:invoke((c,r)=>service.overview(c,r.query)),options:invoke(c=>service.options(c)),requestReopen:invoke((c,r)=>service.requestReopen(c,r.params.id,r.body)),act:invoke((c,r)=>service.institutionalAction(c,r.params.action,r.body))};
}
