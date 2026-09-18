import 'dotenv/config';
import express from 'express';
import routeAuth from './app/routes/routes.auth.js';
import routePlan from './app/routes/routes.plan.js';
import routeActividad from './app/routes/routes.actividad.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Rutas de autenticación (sin protección)
app.use('/api', routeAuth);

// Rutas protegidas con JWT
app.use('/api', routePlan);
app.use('/api', routeActividad);

app.get('/', (req, res) => {
    res.json({ message: 'API Sistema Planes de Acción funcionando correctamente' });
});

app.listen(PORT, '0.0.0.0',() => {
    console.log(`Servidor corriendo en ${PORT}`);
});
