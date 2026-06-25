const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { setupWebSocket } = require('./services/websocket');
const { connectMQTT } = require('./services/mqtt');
const { startOfflineChecker } = require('./services/alertManager');
const { startScheduler } = require('./services/scheduler');
const authRoutes = require('./routes/auth');
const sensorRoutes = require('./routes/sensors');
const userRoutes = require('./routes/users');
const commandRoutes = require('./routes/commands');
const alertRoutes = require('./routes/alerts');

const app = express();
app.set('trust proxy', 1); // Nginx proxy
const server = http.createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:8081', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.warn('[CORS] Origem bloqueada:', origin);
    callback(new Error('CORS: origem nao permitida'));
  },
  credentials: true
}));

// Rate limit no login: 10 tentativas por 15 minutos por IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', loginLimiter);
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/sensors', sensorRoutes);
app.use('/api/users', userRoutes);
app.use('/api/commands', commandRoutes);
app.use('/api/alerts', alertRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

setupWebSocket(server);
connectMQTT();
startOfflineChecker();
startScheduler();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`TH-GUARD backend rodando na porta ${PORT}`));
