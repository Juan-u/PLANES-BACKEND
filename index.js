import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import pool from './app/config/db.js';
import routeAuth from './app/routes/routes.auth.js';
import { createUsuarioRouter } from './app/routes/routes.usuario.js';
import { createPermissionMiddleware } from './app/middleware/permission.middleware.js';
import { createRoleAssignmentComposition } from './app/services/role-assignment.composition.js';
import { createRoleAssignmentRouter } from './app/routes/routes.role-assignment.js';
import { createRoleAdministrationComposition } from './app/services/role-administration.composition.js';
import { createRoleAdministrationRouter, createRoleCapabilitiesRouter } from './app/routes/routes.role-administration.js';
import { crearRouterPlanes } from './app/routes/routes.plan.js';
import { createActivityRouter } from './app/routes/routes.activity.js';
import { createReadModelsRouter } from './app/routes/routes.readmodels.js';
import { createFollowupRouter } from './app/routes/routes.followup.js';
import { createEvidenceRouter } from './app/routes/routes.evidence.js';
import { createEvidenceStorage } from './app/services/evidence-storage.service.js';

const app = express();
app.use(express.json());
app.use('/api', routeAuth);

// Authenticated user CRUD is permission-protected. Login remains independent
// from authorization and continues to authenticate any active valid account.
const requirePermission = createPermissionMiddleware({ pool });
app.use('/api', createUsuarioRouter({ requirePermission }));

const ids = Object.freeze({ next: randomUUID });
const clock = Object.freeze({ now: () => new Date() });
let administration = null;
// A self-only read endpoint supports local UI capability filtering. It is not
// mounted in production and cannot modify role or permission data.
if (process.env.NODE_ENV !== 'production') {
  administration = createRoleAdministrationComposition({ pool, ids, clock });
  app.use('/api', createRoleCapabilitiesRouter({ service: administration.service }));
}

// Role administration is opt-in for local/staging validation. Production
// refuses startup with this flag, and the database migration is never applied here.
if (process.env.ENABLE_ROLE_PERMISSION_ROUTES === 'true') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Role-permission routes must remain disabled in production.');
  }
  const approvalWindowMs = Number(process.env.ROLE_APPROVAL_WINDOW_MS);
  if (!Number.isSafeInteger(approvalWindowMs) || approvalWindowMs <= 0) {
    throw new Error('ROLE_APPROVAL_WINDOW_MS must be configured before enabling role routes.');
  }
  const assignment = createRoleAssignmentComposition({ pool, ids, clock, approvalWindowMs });
  administration ??= createRoleAdministrationComposition({ pool, ids, clock });
  app.use('/api', createRoleAssignmentRouter({ service: assignment.service }));
  app.use('/api', createRoleAdministrationRouter({ service: administration.service }));
  app.use('/api', crearRouterPlanes({
    pool,
    autorizarConsultaPlanes: requirePermission('M03.plans.read'),
    autorizarCrearPlan: requirePermission('M03.plans.create'),
    autorizarActualizarPlan: requirePermission('M03.plans.update')
  }));
  app.use('/api', createActivityRouter({
    pool,
    authorizeRead: requirePermission('M04.activities.read'),
    authorizeCreate: requirePermission('M04.activities.create'),
    authorizeUpdate: requirePermission('M04.activities.update')
  }));
  app.use('/api', createReadModelsRouter({
    pool,
    authorizeReportRead: requirePermission('M12.reports.read'),
    authorizeReportExport: requirePermission('M12.reports.export')
  }));
  app.use('/api', createEvidenceRouter({
    pool,
    storage: createEvidenceStorage(),
    authorizeRead: requirePermission('M13.evidence.read'),
    authorizeUpload: requirePermission('M13.evidence.upload')
  }));
  app.use('/api', createFollowupRouter({
    pool,
    authorizeRead: requirePermission('M05.followup.read'),
    authorizeCreate: requirePermission('M05.followup.create'),
    authorizeUpdate: requirePermission('M05.followup.update'),
    authorizeApprove: requirePermission('M05.followup.approve'),
    authorizeReportRead: requirePermission('M12.reports.read')
  }));
}

app.get('/', (_req, res) => res.json({ message: 'Servidor funcionando correctamente' }));

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});
