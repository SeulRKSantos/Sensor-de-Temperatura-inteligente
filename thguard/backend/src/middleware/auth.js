const jwt = require('jsonwebtoken');

function auth(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token ausente' });
    }
    try {
      const token = header.split(' ')[1];
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
      if (roles.length > 0 && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'Sem permissão' });
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Token inválido' });
    }
  };
}

module.exports = { auth };
