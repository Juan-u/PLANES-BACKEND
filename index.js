import 'dotenv/config';
import express from 'express';

import routeAuth from './app/routes/routes.auth.js';
import routePlan from './app/routes/routes.plan.js';
import routeActividad from './app/routes/routes.actividad.js';

const app = express();

const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// ============================================
// RUTAS
// ============================================

// Autenticación
app.use('/api', routeAuth);

// Planes
app.use('/api', routePlan);

// Actividades
app.use('/api', routeActividad);

// ============================================
// HEALTH CHECK
// ============================================

app.get('/', (req, res) => {
    res.status(200).json({
        message: 'API Sistema Planes de Acción funcionando correctamente'
    });
});

// ============================================
// SERVIDOR
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});