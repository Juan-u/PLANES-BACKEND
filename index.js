import 'dotenv/config';
import express from 'express';
import routeUsuario from './app/routes/routes.usuario.js';
import routeAuth from './app/routes/routes.auth.js';

const app = express();
app.use(express.json());

// Registrar rutas de autenticación PRIMERO
app.use('/api', routeAuth);
// Luego las rutas del CRUD
app.use('/api', routeUsuario);

app.get('/', (req, res) => {
  res.json({ message: 'Servidor funcionando correctamente' });
});

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});