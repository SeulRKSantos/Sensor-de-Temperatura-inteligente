const express = require('express');
const cors = require('cors');
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
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
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
