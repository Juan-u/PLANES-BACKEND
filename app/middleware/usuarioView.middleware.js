const usuarioView = (req, res, next) => {
    res.locals.usuario = req.usuario || null;
    next();
};

export default usuarioView;