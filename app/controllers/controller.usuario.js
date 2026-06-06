import pool from '../config/db.js';

// Obtener todos los usuarios controlador
export const listarUsuarios = async (req, res) => {
  try {

    const [rows] = await pool.query('SELECT * FROM usuarios');

    res.json(rows);

  } catch (error) {

    res.status(500).json({ error: error.message });

  }
};

// Obtener un usuario por ID
export const obtenerUsuario = async (req, res) => {
  try {

    const { id } = req.params;

    const [rows] = await pool.query(
      'SELECT * FROM usuarios WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {

      return res.status(404).json({ error: 'Usuario no encontrado' });

    }

    res.json(rows[0]);

  } catch (error) {

    res.status(500).json({ error: error.message });

  }
};

// Crear nuevo usuario
export const crearUsuario = async (req, res) => {
  try {

    const { nombre, email, password } = req.body;

    const [result] = await pool.query(
      'INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)',
      [nombre, email, password]
    );

    res.status(201).json({
      id: result.insertId,
      nombre,
      email
    });

  } catch (error) {

    res.status(500).json({ error: error.message });

  }
};

// Actualizar usuario
export const actualizarUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email } = req.body;

    const [result] = await pool.query(
      'UPDATE usuarios SET nombre = ?, email = ? WHERE id = ?',
      [nombre, email, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ message: 'Usuario actualizado correctamente' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Eliminar usuario
export const eliminarUsuario = async (req, res) => {
  try {

    const { id } = req.params;

    await pool.query('DELETE FROM usuarios WHERE id = ?', [id]);

    res.json({ message: 'Usuario eliminado correctamente' });

  } catch (error) {

    res.status(500).json({ error: error.message });

  }

};