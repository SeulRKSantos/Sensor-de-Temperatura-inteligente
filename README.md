# 🌡️ Sensor de Temperatura Inteligente com Sistema Web

[![CI](https://github.com/SeulRKSantos/Sensor-de-Temperatura-inteligente/actions/workflows/ci.yml/badge.svg)](https://github.com/SeulRKSantos/Sensor-de-Temperatura-inteligente/actions/workflows/ci.yml)

Monitoramento de temperatura com ESP8266/ESP32, MQTT e painel web, para ambientes
(temperatura e umidade) e para máquinas industriais (PT100).

---

## 📁 Estrutura do repositório

```text
Sensor-de-Temperatura-inteligente/
│
├── thguard/                          ← TH-GUARD: plataforma principal (em produção)
│   ├── backend/                      ← API Node.js + Express + WebSocket
│   ├── frontend/                     ← Painel React + Vite
│   ├── firmware/
│   │   ├── thguard_v4_mac/           ← ESP8266 + DHT22 (registro por MAC)
│   │   ├── thguard_v4_local/         ← ESP8266 + DHT22 (versão simplificada)
│   │   ├── thguard_esp32/            ← ESP32 + DHT22 (mesmo protocolo)
│   │   └── va01_industrial/          ← ESP32 + PT100 via transmissor 0–10 V (VA01)
│   ├── docs/INDUSTRIAL.md            ← Sensores industriais: conversão, área morta, deploy
│   ├── mariadb/init.sql              ← Schema do banco
│   ├── mosquitto/config/             ← Broker MQTT (mosquitto.conf, acl.conf)
│   ├── nginx/nginx.conf              ← Proxy reverso (porta 8081)
│   ├── docker-compose.yml
│   └── .env.example
│
└── thi/                              ← THI: stack independente PT100 + MAX31865
    ├── firmware/esp32_mqtt_pt100_v4.ino
    ├── mosquitto/config/mosquitto.conf
    ├── nodered/flows.json            ← MQTT → InfluxDB
    ├── docker-compose.yml            ← Mosquitto, InfluxDB, Node-RED, Grafana
    └── .env.example
```

---

## 📦 Projetos

### 🔵 TH-GUARD — plataforma de monitoramento

Painel web próprio com banco relacional, alertas por e-mail e suporte a dois tipos de sensor:

| Tipo | Hardware | Mede |
|---|---|---|
| Ambiente | ESP8266 (NodeMCU) ou ESP32 + DHT22 | Temperatura e umidade |
| Industrial (VA01) | ESP32 + PT100 → transmissor TxIsoRail 0–10 V | Temperatura de máquina (0–150 °C configurável) |

| Item | Descrição |
|---|---|
| **Comunicação** | MQTT 1883 com usuário/senha e ACL por tópico |
| **Backend** | Node.js + Express + WebSocket |
| **Frontend** | React + Vite (responsivo) |
| **Banco** | MariaDB 11 (cadastro, usuários, alertas) + InfluxDB 2 (séries temporais) |
| **Deploy** | Docker Compose + Nginx |

**Funcionalidades:**
- Registro automático dos sensores por endereço MAC
- Leituras em tempo real via WebSocket e gráficos históricos
- Alertas por e-mail e relatórios diário/semanal/mensal com CSV anexo
- Acesso por perfil (admin, editor, viewer) e por grupo de sensores
- Seção **Industrial**: calibração editável pelo painel (faixa, offsets, falha upscale)
  e área morta para o indicador Therma desligado

→ [Documentação do TH-GUARD](./thguard/README.md) · [Sensores industriais](./thguard/docs/INDUSTRIAL.md)

---

### 🟠 THI — PT100 com MAX31865 (stack independente)

ESP32 lendo o PT100 direto pelo MAX31865 e publicando via MQTT; Node-RED grava no InfluxDB
e o Grafana mostra os dados. A medição do VA01 em produção hoje é feita pelo TH-GUARD.

| Item | Descrição |
|---|---|
| **Sensor** | PT100 via MAX31865 (SPI) |
| **Hardware** | ESP32 |
| **Processamento** | Node-RED |
| **Banco / dashboards** | InfluxDB 2 + Grafana |
| **Deploy** | Docker Compose |

→ [Documentação do THI](./thi/README.md)

---

## 🚀 Início rápido

### TH-GUARD

```bash
cd thguard
cp .env.example .env
nano .env                 # senhas, JWT_SECRET, ADMIN_PASSWORD, ALLOWED_ORIGINS
```

Crie os usuários do broker (passo 3 do [README do TH-GUARD](./thguard/README.md#3--configure-o-mosquitto)) e suba:

```bash
docker compose up -d
```

Painel em `http://localhost:8081`, login `admin@thguard.local` com a senha do `ADMIN_PASSWORD`.

### THI

```bash
cd thi
cp .env.example .env
nano .env
```

Crie o `passwd` e o `acl.conf` do Mosquitto (passo 3 do [README do THI](./thi/README.md#3-usuários-do-broker-mqtt)) e suba:

```bash
docker compose up -d
```

Node-RED em `http://localhost:1880`, Grafana em `http://localhost:3000`.

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
