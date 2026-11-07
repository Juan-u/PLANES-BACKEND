import {Router} from 'express';
import {verificarToken} from '../middleware/auth.middleware.js';
import {createInstitutionalReportService} from '../services/institutional-report.service.js';
import {createInternalControlService} from '../services/internal-control.service.js';
import {createInstitutionalReportsController} from '../controllers/controller.institutional-reports.js';
export function createInstitutionalReportsRouter({pool}){
 const router=Router(),c=createInstitutionalReportsController({reports:createInstitutionalReportService({pool}),control:createInternalControlService({pool})});
 // Services own the permission mutex. Never stack a second permission lease here.
 router.get('/informes/institucional',verificarToken,c.query);
 router.get('/informes/institucional/export.csv',verificarToken,c.csv);
 router.get('/informes/institucional/impresion',verificarToken,c.print);
 router.post('/informes/institucional/publicar',verificarToken,c.publish);
 router.get('/control-interno',verificarToken,c.list);
 router.get('/control-interno/contexto',verificarToken,c.controlQuery);
 router.get('/control-interno/:id',verificarToken,c.detail);
 router.post('/control-interno/actuaciones/:action',verificarToken,c.act);
 return router;
}
