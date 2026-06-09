const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { auth } = require('../middleware/auth');
const db = require('../models/db');

router.get('/', auth(['admin']), async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json(users.map(u => ({ ...u, password: undefined })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth(['admin']), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role)
      return res.status(400).json({ error: 'Campos obrigatorios: name, email, password, role' });
    if (!['admin','editor','viewer'].includes(role))
      return res.status(400).json({ error: 'Role invalida' });
    const existing = await db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email ja cadastrado' });
    const user = await db.createUser({ name, email, password: bcrypt.hashSync(password, 10), role });
    res.status(201).json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', auth(['admin']), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const fields = {};
    if (name)  fields.name  = name;
    if (email) fields.email = email;
    if (password) fields.password = bcrypt.hashSync(password, 10);
    if (role && ['admin','editor','viewer'].includes(role)) fields.role = role;
    await db.updateUser(req.params.id, fields);
    const user = await db.getUserById(req.params.id);
    res.json({ ...user, password: undefined });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth(['admin']), async (req, res) => {
  try {
    await db.deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
