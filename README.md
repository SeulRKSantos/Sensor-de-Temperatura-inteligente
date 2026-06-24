# 🌡️ Sensor de Temperatura Inteligente com Sistema Web

[![CI](https://github.com/SeulRKSantos/Sensor-de-Temperatura-inteligente-com-sistema-Web/actions/workflows/ci.yml/badge.svg)](https://github.com/SeulRKSantos/Sensor-de-Temperatura-inteligente-com-sistema-Web/actions/workflows/ci.yml)


Repositório com dois projetos de monitoramento ambiental com ESP + MQTT + painel web, desenvolvidos para uso industrial e predial.

---

## 📁 Estrutura do Repositório

```text
Sensor-de-Temperatura-inteligente-com-sistema-Web/
│
├── thguard/                          ← Projeto TH-GUARD (DHT22 + ESP8266)
│   ├── firmware/
│   │   ├── thguard_v4_mac.ino        ← Firmware ESP8266 (MQTT 1883 + registro por MAC)
│   │   └── thguard_v4_local.ino      ← Firmware ESP8266 (versao simplificada)
│   ├── backend/                      ← API Node.js
│   │   └── src/
│   │       ├── models/               ← MariaDB (db.js, migrate.js)
│   │       ├── routes/               ← auth, sensors, alerts, users, commands
│   │       └── services/             ← mqtt, influx, email, alertManager, scheduler
│   ├── frontend/                     ← Interface React + Vite
│   │   └── src/
│   │       ├── pages/                ← Dashboard, Sensores, Alertas, Relatórios
│   │       ├── components/           ← Layout responsivo (desktop + mobile)
│   │       ├── hooks/                ← WebSocket em tempo real
│   │       └── context/              ← Autenticação JWT
│   ├── mosquitto/config/             ← Broker MQTT
│   │   ├── mosquitto.conf            ← Configuração do broker MQTT (porta 1883)
│   │   └── acl.conf                  ← Controle de acesso por usuário
│   ├── mariadb/
│   │   └── init.sql                  ← Schema do banco de dados
│   ├── nginx/
│   │   └── nginx.conf                ← Proxy reverso
│   ├── docker-compose.yml            ← Stack completa
│   ├── .env.example                  ← Variáveis de ambiente
│   └── README.md
│
└── thi/                              ← Projeto THI (PT100 + ESP32)
    ├── firmware/
    │   └── esp32_mqtt_pt100_v4.ino   ← Firmware ESP32 (4-20mA + MQTT + WiFiManager)
    ├── mosquitto/config/
    │   └── mosquitto.conf            ← Configuração do broker MQTT
    ├── nodered/
    │   └── flows.json                ← Fluxos Node-RED (MQTT → InfluxDB → alertas)
    ├── docker-compose.yml            ← Stack: Mosquitto, InfluxDB, Node-RED, Grafana
    └── README.md
```

---

## 📦 Projetos

### 🔵 TH-GUARD — Monitoramento com DHT22 + ESP8266

Plataforma completa de monitoramento de temperatura e umidade com painel web próprio, banco de dados relacional e suporte a múltiplos sensores.

| Item | Descrição |
|---|---|
| **Sensor** | DHT22 (temperatura e umidade) |
| **Hardware** | NodeMCU 1.0 (ESP8266) |
| **Comunicação** | MQTT (porta 1883, usuário/senha) |
| **Backend** | Node.js + Express + WebSocket |
| **Frontend** | React + Vite (responsivo) |
| **Banco** | MariaDB 11 + InfluxDB 2 |
| **Broker** | Eclipse Mosquitto 2 |
| **Deploy** | Docker Compose |

**Funcionalidades:**
- Registro automático de sensores por endereço MAC
- Dashboard com leituras em tempo real via WebSocket
- Gráficos históricos (1h, 6h, 24h, 7 dias)
- Alertas por email com relatórios CSV (diário/semanal/mensal)
- Controle de acesso por roles (admin, editor, viewer)
- Autenticação MQTT por usuário/senha com controle de ACL por tópico
- Interface responsiva para desktop e mobile

→ [Documentação completa](./thguard/README.md)

---

### 🟠 THI — Monitoramento Industrial com PT100 + ESP32

Sistema de monitoramento de temperatura para aplicações industriais usando sensor PT100 com transmissor 4-20mA e ESP32.

| Item | Descrição |
|---|---|
| **Sensor** | PT100 via MAX31865 ou transmissor 4-20mA |
| **Hardware** | ESP32 |
| **Comunicação** | MQTT |
| **Visualização** | Node-RED + Grafana |
| **Banco** | InfluxDB 2 |
| **Broker** | Eclipse Mosquitto 2 |
| **Deploy** | Docker Compose |

→ [Documentação completa](./thi/README.md)

---

## 🚀 Início Rápido

### TH-GUARD

```bash
cd thguard
cp .env.example .env
# Edite .env com suas credenciais
docker compose up -d
# Acesse: http://localhost:8081
```

### THI

```bash
cd thi
docker compose up -d
# Node-RED: http://localhost:1880
# Grafana:  http://localhost:3000
```

---

## 🛠️ Tecnologias

![ESP8266](https://img.shields.io/badge/ESP8266-NodeMCU-blue)
![ESP32](https://img.shields.io/badge/ESP32-IoT-red)
![Node.js](https://img.shields.io/badge/Node.js-20-green)
![React](https://img.shields.io/badge/React-18-61dafb)
![MariaDB](https://img.shields.io/badge/MariaDB-11-003545)
![InfluxDB](https://img.shields.io/badge/InfluxDB-2-22adf6)
![MQTT](https://img.shields.io/badge/MQTT-Mosquitto-660066)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ed)

---

## 📄 Licença

MIT © [Ramon Santos](https://github.com/SeulRKSantos)
