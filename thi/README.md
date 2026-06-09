# PT100 — Monitoramento Industrial de Temperatura

Sistema de monitoramento de temperatura em tempo real desenvolvido para ambiente industrial químico. Utiliza sensor PT100 de 3 fios com isolação galvânica, ESP32, MQTT, InfluxDB, Node-RED e Grafana.

## Arquitetura
PT100 → Transmissor 4-20mA (isolação galvânica) → GY-ADS1115 → ESP32 → MQTT → Node-RED → InfluxDB → Grafana
## Stack

| Serviço    | Função                          | Porta |
|------------|---------------------------------|-------|
| Mosquitto  | Broker MQTT                     | 1883  |
| InfluxDB 2 | Banco de dados série temporal   | 8086  |
| Node-RED   | Processamento e roteamento      | 1880  |
| Grafana    | Dashboard de visualização       | 3000  |

## Hardware

- ESP32 Dev Module
- Transmissor de cabeçote PT100 → 4-20mA com isolação galvânica
- Módulo GY-ADS1115 (ADC I2C 16 bits)
- Sensor PT100 de 3 fios
- Fonte 24V DC Mean Well HDR-30-24

## Firmwares

| Arquivo | Descrição |
|---------|-----------|
| `thguard_panel.ino` | Versão principal — leitura 4-20mA com painel web |
| `esp32_mqtt_pt100_v4.ino` | Versão base — leitura MAX31865 + MQTT |
| `teste_pt100_simples.ino` | Versão de teste simples |

## Como executar

```bash
git clone https://github.com/SeulRKSantos/Sensor-de-Temperatura-inteligente-com-sistema-Web.git
cd Sensor-de-Temperatura-inteligente-com-sistema-Web/thi
docker compose up -d
```

Acessar:
- Grafana: http://localhost:3000
- Node-RED: http://localhost:1880
- InfluxDB: http://localhost:8086

## Credenciais padrão

| Serviço   | Usuário | Senha       |
|-----------|---------|-------------|
| Grafana   | admin   | changeme123 |
| InfluxDB  | admin   | changeme123 |

> Altere as senhas antes de usar em produção.
