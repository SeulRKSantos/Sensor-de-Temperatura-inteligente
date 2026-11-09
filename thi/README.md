# THI — Monitoramento de temperatura com PT100 (MAX31865)

Stack independente para medir temperatura de máquina com PT100 ligado direto a um ESP32
pelo conversor **MAX31865**, publicando via MQTT e guardando os dados com Node-RED, InfluxDB e Grafana.

> **Situação atual:** a medição do VA01 em produção não usa esta pasta. Ela é feita pelo
> firmware industrial do TH-GUARD (PT100 → transmissor TxIsoRail 0–10 V → ESP32), com painel,
> alertas e relatórios na plataforma TH-GUARD. Veja [`thguard/docs/INDUSTRIAL.md`](../thguard/docs/INDUSTRIAL.md).
> Este diretório continua aqui como a versão com MAX31865 e stack Node-RED/Grafana.

## Arquitetura

```
PT100
  │  resistência
  ▼
MAX31865 (SPI)
  │
  ▼
ESP32 ── MQTT 1883 ──▶ Mosquitto ──▶ Node-RED ──▶ InfluxDB 2 ──▶ Grafana
          sensores/<ID>/temperatura
          sensores/<ID>/status
```

## Stack (`docker-compose.yml`)

| Serviço | Container | Porta | Função |
|---|---|---|---|
| Eclipse Mosquitto 2 | `thi-mosquitto` | 1883 | Broker MQTT (com autenticação) |
| InfluxDB 2 | `thi-influxdb` | 8086 | Séries temporais (org `iot`, bucket `sensores`, retenção **48 h**) |
| Node-RED | `thi-nodered` | 1880 | Recebe o MQTT e grava no InfluxDB |
| Grafana | `thi-grafana` | 3000 | Dashboards |

## Instalação

### 1. Clonar

```bash
git clone https://github.com/SeulRKSantos/Sensor-de-Temperatura-inteligente.git
cd Sensor-de-Temperatura-inteligente/thi
```

### 2. Senhas (`.env`)

```bash
cp .env.example .env
nano .env
```

Defina `INFLUX_PASSWORD` e `GRAFANA_PASSWORD`. O `.env` não vai para o Git.

### 3. Usuários do broker MQTT

O `mosquitto.conf` exige usuário e senha (`allow_anonymous false`) e lê dois arquivos que
**não estão no repositório** e precisam ser criados antes de subir a stack:

```bash
docker run --rm -it -v "$PWD/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
  mosquitto_passwd -c /mosquitto/config/passwd nodered
```

```bash
cat > mosquitto/config/acl.conf <<'EOF'
user nodered
topic readwrite #
EOF
```

Para mais usuários, rode o `mosquitto_passwd` de novo **sem** o `-c` (o `-c` recria o arquivo).

### 4. Subir

```bash
docker compose up -d
```

### 5. Acessos

| Serviço | URL | Login |
|---|---|---|
| Grafana | http://localhost:3000 | `admin` / `GRAFANA_PASSWORD` do `.env` |
| InfluxDB | http://localhost:8086 | `admin` / `INFLUX_PASSWORD` do `.env` |
| Node-RED | http://localhost:1880 | **sem login** — não exponha a porta 1880 fora da rede interna |

### 6. Node-RED

O `nodered/flows.json` **não é carregado automaticamente** (o Node-RED usa um volume próprio).
Importe pelo menu ☰ → *Import* e depois configure as credenciais, que não vão no arquivo:

- nó **Mosquitto Local**: usuário/senha criados no passo 3;
- nó **InfluxDB Local**: token do InfluxDB (InfluxDB → *Load Data → API Tokens*).

O fluxo faz:

| Entrada | Saída no InfluxDB |
|---|---|
| `sensores/#` (leituras) | measurement `temperatura`, bucket `sensores` |
| `sensores/<ID>/status` | measurement `status_sensor` (`online` 0/1) |
| timer de 15 s | alerta de offline no debug para os IDs da lista `SENSORES` no nó *Checar Offline* (hoje `['VA01']`) |

## Firmware (`firmware/esp32_mqtt_pt100_v4.ino`)

### Ligação

| MAX31865 | ESP32 |
|---|---|
| VIN | 3V3 |
| GND | GND |
| CLK | GPIO 18 |
| SDO | GPIO 19 |
| SDI | GPIO 23 |
| CS | GPIO 5 |

LED de status no GPIO 2 (onboard). Resistor de referência do módulo: 430 Ω (versão PT100).

O firmware inicializa o sensor em **2 fios** (`sensor.begin(MAX31865_2WIRE)`).
Para PT100 de 3 fios, troque para `MAX31865_3WIRE` e feche o jumper de 3 fios na placa do MAX31865.

### Bibliotecas

Adafruit MAX31865, PubSubClient, ArduinoJson, ESPAsyncWebServer e AsyncTCP
(`Preferences` já vem com o core ESP32).

### Gravar

O Arduino exige que o `.ino` fique numa pasta com o mesmo nome, então copie antes:

```bash
mkdir -p ~/esp32_mqtt_pt100_v4 && cp firmware/esp32_mqtt_pt100_v4.ino ~/esp32_mqtt_pt100_v4/
arduino-cli compile --fqbn esp32:esp32:esp32 ~/esp32_mqtt_pt100_v4
arduino-cli upload -p /dev/ttyACM0 --fqbn esp32:esp32:esp32 ~/esp32_mqtt_pt100_v4
```

Ou pela Arduino IDE (placa *ESP32 Dev Module*), que oferece mover o arquivo para a pasta certa.

### Configuração (modo pareamento)

O ESP entra em pareamento quando não tem Wi-Fi salvo ou quando o **BOOT** é segurado por 3 s ao ligar.

1. Conecte na rede `PT100-<ID>`.
2. Abra `http://192.168.4.1`.
3. Informe Wi-Fi, IP e porta do broker, ID da máquina e intervalo de envio.

A senha dessa rede está fixa no firmware (`AP_PASSWORD`). Como o código é público,
**troque-a antes de gravar** um sensor que vai ficar em campo.

### Protocolo MQTT

| Tópico | Direção | Conteúdo |
|---|---|---|
| `sensores/<ID>/temperatura` | ESP → broker | `{"id","ts","t","f"}` — `t` em °C (null em falha), `f` = 1 em falha do MAX31865 |
| `sensores/<ID>/status` | ESP → broker (retido) | heartbeat a cada 30 s com IP, RSSI, uptime, limites; LWT `{"online":false}` |
| `config/<ID>/limiares` | broker → ESP | `{"temp_alta","temp_baixa","temp_critica"}` |
| `config/<ID>/intervalo` | broker → ESP | `{"intervalo_s"}` |
| `config/broadcast` | broker → todos | mesmos campos; `{"cmd":"reset"}` volta ao pareamento |

### Limitação conhecida

O firmware v4 conecta ao broker **sem usuário e senha**, mas o `mosquitto.conf` desta pasta
recusa conexões anônimas — a conexão falha com `rc=5`. Para usar os dois juntos é preciso
adicionar credenciais MQTT ao firmware (como faz o firmware do TH-GUARD, via `secrets.h`).

## Estrutura

```
thi/
├── firmware/
│   └── esp32_mqtt_pt100_v4.ino   ← ESP32 + MAX31865, portal de pareamento
├── mosquitto/config/
│   └── mosquitto.conf            ← passwd e acl.conf são criados na instalação
├── nodered/
│   └── flows.json                ← fluxo MQTT → InfluxDB (importar manualmente)
├── docker-compose.yml
└── .env.example
```

## Licença

MIT
