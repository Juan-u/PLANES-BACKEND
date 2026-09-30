const verificarRol = (...rolesPermitidos) => {

    return (req, res, next) => {

        if (!req.usuario) {
            return res.status(401).json({
                message: 'Usuario no autenticado'
            });
        }
        const rolId = Number(req.usuario.rol_id);

        if (!rolesPermitidos.includes(rolId)) {
            return res.status(403).json({
                message: 'No tiene permisos para realizar esta acción'
            });
        }

        next();
    };
};

export default verificarRol;
