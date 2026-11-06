const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const { auth } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.getUserByEmail(email);
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Email ou senha invalidos' });
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role, tags: user.tags || [] },
      process.env.JWT_SECRET, { expiresIn: '8h' }
    );
    res.json({ token, user: { id:user.id, name:user.name, email:user.email, role:user.role, tags: user.tags || [] } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/me', auth(), async (req, res) => {
  try {
    const fresh = await db.getUserById(req.user.id);
    if (!fresh) return res.status(401).json({ error: 'Usuario nao encontrado' });
    res.json({ id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role, tags: fresh.tags || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
