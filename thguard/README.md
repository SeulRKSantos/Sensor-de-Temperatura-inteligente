# TH-GUARD — Plataforma de Monitoramento Ambiental

Sistema completo de monitoramento de temperatura e umidade com ESP8266 + DHT22, backend Node.js, frontend React e banco de dados MariaDB + InfluxDB.

## Arquitetura
ESP8266 + DHT22
↓ MQTT (1883)
Mosquitto Broker
↓
Node.js Backend ──→ MariaDB (usuários, sensores, alertas)
↓               InfluxDB (séries temporais)
React Frontend
↓
Nginx (porta 8081)
## Stack

- **Firmware:** ESP8266 (NodeMCU 1.0) + DHT22
- **Broker:** Eclipse Mosquitto 2 (MQTT)
- **Backend:** Node.js + Express + WebSocket
- **Frontend:** React + Vite
- **Banco de dados:** MariaDB 11 + InfluxDB 2
- **Proxy:** Nginx
- **Containerização:** Docker + Docker Compose

## Funcionalidades

- Registro automático de sensores por endereço MAC
- Dashboard em tempo real via WebSocket
- Gráficos históricos com múltiplos ranges (1h, 6h, 24h, 7d)
- Alertas por email (temperatura alta, umidade alta, sensor offline)
- Relatórios diário/semanal/mensal com CSV anexo
- Controle de acesso por roles (admin, editor, viewer)
- Autenticação MQTT por usuário/senha com controle de ACL por tópico
- Interface responsiva (desktop e mobile)

## Pré-requisitos

- Docker e Docker Compose
- Arduino IDE 2.x com suporte ESP8266
- Bibliotecas Arduino: ESP8266WiFi, DHT, PubSubClient, Adafruit SSD1306, NTPClient, LittleFS

## Instalação

### 1 — Clone o repositório

```bash
git clone https://github.com/SeulRKSantos/Sensor-de-Temperatura-inteligente-com-sistema-Web.git
cd Sensor-de-Temperatura-inteligente-com-sistema-Web/thguard
```

### 2 — Configure as variáveis de ambiente

```bash
cp .env.example .env
# Edite o .env com suas credenciais
nano .env
```

### 3 — Configure o Mosquitto

```bash
# Crie o arquivo de senhas do broker
docker run --rm -v $(pwd)/mosquitto/config:/mosquitto/config \
  --user root eclipse-mosquitto:2 \
  mosquitto_passwd -c -b /mosquitto/config/passwd thguard SUA_SENHA

docker run --rm -v $(pwd)/mosquitto/config:/mosquitto/config \
  --user root eclipse-mosquitto:2 \
  mosquitto_passwd -b /mosquitto/config/passwd thguard-backend SUA_SENHA_BACKEND
```

### 4 — Suba os containers

```bash
docker compose up -d
```

### 5 — Acesse o painel
http://localhost:8081
Login: admin@thguard.local / ***REMOVED***
> ⚠️ Troque a senha padrão após o primeiro acesso em **Usuários → Administrador**.

## Firmware

O arquivo `firmware/thguard_v4_mac.ino` é o firmware universal para todos os sensores.

### Configuração

Edite as constantes no início do arquivo:

```cpp
#define MQTT_USER  "thguard"
#define MQTT_PASS  "sua_senha_mqtt"
```

### Upload

1. Abra `firmware/thguard_v4_mac.ino` no Arduino IDE
2. Selecione: `Tools → Board → NodeMCU 1.0 (ESP-12E Module)`
3. Selecione: `Tools → Flash Size → 4MB (FS:2MB OTA:-1019KB)`
4. Grave o firmware: `Ctrl+U`
5. Configure WiFi e IP do servidor via painel web do sensor (`http://IP_DO_SENSOR`)

## Estrutura do projeto
thguard/
├── backend/              ← API Node.js + serviços
│   └── src/
│       ├── models/       ← MariaDB (db.js, migrate.js)
│       ├── routes/       ← auth, sensors, alerts, users
│       └── services/     ← mqtt, influx, email, alertManager
├── frontend/             ← React + Vite
│   └── src/
│       ├── pages/        ← Dashboard, Sensores, Alertas, Relatórios
│       └── components/   ← Layout, navegação
├── firmware/             ← Firmware ESP8266
├── mariadb/              ← Schema SQL inicial
├── mosquitto/config/     ← Configuração do broker MQTT
├── nginx/                ← Configuração do proxy reverso
├── .env.example          ← Variáveis de ambiente necessárias
└── docker-compose.yml    ← Stack completa
## Licença

MIT
