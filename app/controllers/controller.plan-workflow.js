import { WorkflowError, positiveId } from '../services/plan-workflow.rules.js';
export function createPlanWorkflowController(service) {
  const invoke = handler => async(req,res)=>{
    try {
      let actorId;
      try { actorId=positiveId(req.usuario?.sub); } catch { return res.status(401).json({code:'AUTHENTICATION_REQUIRED'}); }
      const context={actorId};
      return res.json(await handler(context,req));
    } catch(error) {
      if(error instanceof WorkflowError)return res.status(error.status).json({code:error.code,...(error.details?{validation:error.details}:{})});
      const code=error.code==='ER_NO_SUCH_TABLE'?'WORKFLOW_SCHEMA_MISSING':'WORKFLOW_UNAVAILABLE';
      return res.status(503).json({code});
    }
  };
  return Object.freeze({get:invoke((c,r)=>service.get(c,r.params.id,r.query)),validate:invoke((c,r)=>service.validate(c,r.params.id)),list:invoke((c,r)=>service.list(c,r.query)),saveProfile:invoke((c,r)=>service.saveProfile(c,r.params.id,r.body)),act:invoke((c,r)=>service.act(c,r.params.id,r.body))});
}
