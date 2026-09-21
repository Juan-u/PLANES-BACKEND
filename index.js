import 'dotenv/config';
import express from 'express';

import routeAuth from './app/routes/routes.auth.js';
import routeUsuario from './app/routes/routes.usuarios.js';
import routePlan from './app/routes/routes.plan.js';
import routeActividad from './app/routes/routes.actividad.js';
import routePeriodo from './app/routes/routes.periodo.js';

const app = express();

const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// ============================================
// RUTAS
// ============================================

// Autenticación
app.use('/api', routeAuth);

// Usuarios
app.use('./api', routeUsuario);

// Planes
app.use('/api', routePlan);

// Actividades
app.use('/api', routeActividad);

// Periodos
app.use('/api', routePeriodo);

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