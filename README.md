# planes-backend

API REST del Sistema de Planes de Acción — Instituto del Huila.

## Requisitos
- Node.js
- MySQL / XAMPP

## Instalación

```bash
npm install
```

Crea un archivo `.env` basado en `.env.example`:

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=sistema_planes_accion
JWT_SECRET=mi_secreto_jwt_planes_accion
PORT=3000
```

Importa la base de datos en phpMyAdmin usando el archivo `sistema_planes_accion.sql`.

## Ejecutar

```bash
node index.js
```

El servidor corre en `http://localhost:3000`

## Rutas de la API

| Método | Ruta | Descripción | Protegida |
|--------|------|-------------|-----------|
| POST | /api/login | Iniciar sesión | No |
| GET | /api/planes | Listar planes | Sí |
| GET | /api/planes/:id | Obtener un plan | Sí |
| POST | /api/planes | Crear plan | Sí |
| PUT | /api/planes/:id | Actualizar plan | Sí |
| DELETE | /api/planes/:id | Eliminar plan | Sí |
| GET | /api/actividades | Listar actividades | Sí |
| GET | /api/actividades/:id | Obtener actividad | Sí |
| POST | /api/actividades | Crear actividad | Sí |
| PUT | /api/actividades/:id | Actualizar actividad | Sí |
| DELETE | /api/actividades/:id | Eliminar actividad | Sí |

Las rutas protegidas requieren el header: `Authorization: Bearer <token>`
