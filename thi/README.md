# TH-IOT PT100 — Monitoramento Industrial de Temperatura

Sistema de monitoramento de temperatura em ambiente industrial com sensor PT100 de 3 fios, transmissor 4-20mA com isolação galvânica, ESP32, MQTT, InfluxDB, Node-RED e Grafana.

## Arquitetura
PT100 (3 fios)
↓ sinal analógico
Transmissor 4-20mA (isolação galvânica 1000V AC)
↓ sinal 4-20mA
GY-ADS1115 (ADC I2C 16 bits)
↓ I2C
ESP32
↓ MQTT (1883)
Mosquitto Broker
↓
Node-RED ──→ InfluxDB (séries temporais)
↓
Grafana (porta 3000)
## Stack

- **Firmware:** ESP32 WROOM-32 + Transmissor PT100 4-20mA + GY-ADS1115
- **Broker:** Eclipse Mosquitto 2 (MQTT)
- **Processamento:** Node-RED
- **Banco de dados:** InfluxDB 2 (séries temporais)
- **Dashboard:** Grafana
- **Containerização:** Docker + Docker Compose
- **VPN:** ZeroTier (acesso remoto)

## Funcionalidades

- Leitura de temperatura via sensor PT100 de 3 fios com isolação galvânica
- Publicação de dados em tempo real via MQTT
- Processamento e roteamento de dados via Node-RED
- Armazenamento de séries temporais no InfluxDB
- Dashboard em tempo real via Grafana
- Acesso remoto via VPN ZeroTier
- Transferência de arquivos via SFTPGo

## Pré-requisitos

- Docker e Docker Compose
- Arduino IDE 2.x com suporte ESP32
- Bibliotecas Arduino: WiFi, PubSubClient, ArduinoJson, Adafruit ADS1X15

## Instalação

### 1 — Clone o repositório

```bash
git clone https://github.com/SeulRKSantos/Sensor-de-Temperatura-inteligente-com-sistema-Web.git
cd Sensor-de-Temperatura-inteligente-com-sistema-Web/thi
```

### 2 — Suba os containers

```bash
docker compose up -d
```

### 3 — Acesse os serviços

| Serviço   | URL                    | Credenciais padrão     |
|-----------|------------------------|------------------------|
| Grafana   | http://localhost:3000  | admin / changeme123    |
| Node-RED  | http://localhost:1880  | —                      |
| InfluxDB  | http://localhost:8086  | admin / changeme123    |

> ⚠️ Altere as senhas padrão antes de usar em produção.

## Firmware

O arquivo `firmware/esp32_mqtt_pt100_v4.ino` é o firmware principal para o sensor PT100.

### Configuração

Edite as constantes no início do arquivo:

```cpp
const char* ID_MAQUINA    = "VA01";         // ID do sensor
const char* WIFI_SSID     = "SEU_SSID";     // Nome da rede Wi-Fi
const char* WIFI_PASSWORD = "SUA_SENHA";    // Senha da rede Wi-Fi
const char* MQTT_SERVER   = "IP_SERVIDOR";  // IP do servidor MQTT
const int   MQTT_PORT     = 1883;
#define TEMP_MIN    0.0    // Temperatura mínima (4mA)
#define TEMP_MAX  200.0    // Temperatura máxima (20mA)
```

### Upload

1. Abra `firmware/esp32_mqtt_pt100_v4.ino` no Arduino IDE
2. Selecione: `Tools → Board → ESP32 Dev Module`
3. Selecione: `Tools → Partition Scheme → Huge APP (3MB No OTA)`
4. Grave o firmware: `Ctrl+U`

## Hardware necessário

| Componente | Especificação |
|------------|---------------|
| ESP32 Dev Module | WROOM-32, 38 pinos |
| Transmissor cabeçote PT100 → 4-20mA | Isolação galvânica, 24V DC, 0-400°C |
| Módulo GY-ADS1115 | ADC I2C 16 bits, 3.3V |
| Resistor shunt | 249 Ohms 1% 0.5W |
| Fonte 24V DC | Mean Well HDR-30-24, trilho DIN |
| Sensor PT100 | 3 fios, padrão DIN IEC 60751 |

## Estrutura do projeto
thi/
├── firmware/                  ← Firmware ESP32
│   └── esp32_mqtt_pt100_v4.ino
├── mosquitto/config/          ← Configuração do broker MQTT
│   └── mosquitto.conf
├── nodered/                   ← Fluxos Node-RED
│   └── flows.json
└── docker-compose.yml         ← Stack completa
## Licença

MIT
