/*
 * ============================================================
 *  FIRMWARE MQTT — ESP32 + PT100 (MAX31865)
 *  Versão: 4.0 — WiFiManager + Configuração Web
 * ============================================================
 *  Modos de operação:
 *
 *  [MODO NORMAL]
 *   - Conecta no Wi-Fi salvo
 *   - Publica temperatura via MQTT no servidor
 *   - Recebe configurações remotas do servidor
 *
 *  [MODO PAREAMENTO]
 *   - Ativado quando não encontra Wi-Fi salvo
 *   - OU quando botão BOOT é pressionado por 3s
 *   - Cria rede Wi-Fi: "PT100-{ID_MAQUINA}"
 *   - Senha da rede: "pt100config"
 *   - Acesse 192.168.4.1 no navegador para configurar
 *   - Configura: SSID, senha Wi-Fi, IP servidor, ID máquina
 *
 * ============================================================
 *  PINAGEM:
 *   MAX31865    →    ESP32
 *   VIN         →    3.3V
 *   GND         →    GND
 *   CLK         →    GPIO 18
 *   SDO         →    GPIO 19
 *   SDI         →    GPIO 23
 *   CS          →    GPIO 5
 *
 *   LED status  →    GPIO 2  (onboard)
 *   Botão reset →    GPIO 0  (BOOT button — já existe na placa)
 *
 * ============================================================
 *  BIBLIOTECAS NECESSÁRIAS:
 *   - Adafruit MAX31865   (by Adafruit)
 *   - PubSubClient        (by Nick O'Leary)
 *   - ArduinoJson         (by Benoit Blanchon)
 *   - Preferences         (built-in ESP32 — não precisa instalar)
 *   - ESPAsyncWebServer   (by ESP Async)
 *   - AsyncTCP            (by ESP Async)
 * ============================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_MAX31865.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>

// ============================================================
//  CONFIGURAÇÕES PADRÃO DE FÁBRICA
//  (substituídas pelas salvas em flash após primeira config)
// ============================================================
#define DEFAULT_ID_MAQUINA   "maquina_01"
#define DEFAULT_MQTT_SERVER  "10.10.0.208"
#define DEFAULT_MQTT_PORT    1883
#define DEFAULT_INTERVALO_S  1
#define AP_SSID_PREFIX       "PT100-"
#define AP_PASSWORD          "pt100config"
#define TIMEOUT_PAREAMENTO   300000  // 5 minutos em modo pareamento

// ============================================================
//  SENSOR
// ============================================================
#define RREF      430.0
#define RNOMINAL  100.0
#define PIN_CS    5
#define PIN_SCK   18
#define PIN_MISO  19
#define PIN_MOSI  23
#define PIN_LED   2
#define PIN_BOOT  0   // Botão BOOT já existente na placa

// ============================================================
//  OBJETOS GLOBAIS
// ============================================================
Adafruit_MAX31865 sensor = Adafruit_MAX31865(PIN_CS, PIN_MOSI, PIN_MISO, PIN_SCK);
Preferences       prefs;
WiFiClient        wifiClient;
PubSubClient      mqttClient(wifiClient);
AsyncWebServer    webServer(80);

// ============================================================
//  CONFIGURAÇÕES (carregadas da flash)
// ============================================================
struct Config {
  char id_maquina[32];
  char wifi_ssid[64];
  char wifi_password[64];
  char mqtt_server[64];
  int  mqtt_port;
  int  intervalo_s;
  float limite_alta;
  float limite_baixa;
  float limite_critica;
} cfg;

// ============================================================
//  ESTADO DO SISTEMA
// ============================================================
enum ModoOperacao { MODO_NORMAL, MODO_PAREAMENTO };
ModoOperacao modoAtual = MODO_NORMAL;

float tempAtual     = 0.0;
bool  falhaAtual    = false;
bool  wifiOK        = false;
bool  mqttOK        = false;

unsigned long ultimaLeitura    = 0;
unsigned long ultimoHeartbeat  = 0;
unsigned long ultimoReconect   = 0;
unsigned long inicioPareamento = 0;

char topico_temp[64];
char topico_status[64];
char topico_config_lim[64];
char topico_config_int[64];
const char* topico_broadcast = "config/broadcast";

// ============================================================
//  HTML DO PAINEL DE PAREAMENTO
// ============================================================
const char HTML_PAREAMENTO[] PROGMEM = R"HTMLEND(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configurar Sensor PT100</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0f1117;color:#e8eaf0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;padding:28px;width:100%;max-width:420px}
h1{font-size:20px;color:#00d4ff;margin-bottom:4px}
.sub{font-size:13px;color:#8892a4;margin-bottom:24px}
.sep{border:none;border-top:1px solid #2a2d3a;margin:20px 0}
h2{font-size:13px;font-weight:600;color:#8892a4;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px}
label{display:block;font-size:12px;color:#8892a4;margin-bottom:5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
input{width:100%;background:#22252f;border:1px solid #2a2d3a;color:#e8eaf0;padding:10px 12px;border-radius:8px;font-size:14px;font-family:inherit;margin-bottom:14px}
input:focus{outline:none;border-color:#00d4ff}
.btn{width:100%;background:#00d4ff;color:#000;border:none;padding:13px;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;margin-top:6px;font-family:inherit}
.btn:hover{filter:brightness(1.1)}
.badge{display:inline-block;background:#003d1f;color:#00e676;border-radius:20px;padding:3px 12px;font-size:11px;font-weight:600;margin-bottom:16px}
.badge.warn{background:#3d2a00;color:#ffb347}
.info{background:#22252f;border-radius:8px;padding:12px;font-size:12px;color:#8892a4;margin-bottom:14px;line-height:1.6}
.msg{padding:12px;border-radius:8px;margin-top:14px;font-size:13px;display:none}
.msg.ok{background:#003d1f;color:#00e676;border:1px solid #00e676}
.msg.err{background:#3d0000;color:#ff4444;border:1px solid #ff4444}
</style>
</head>
<body>
<div class="card">
  <h1>Sensor PT100</h1>
  <p class="sub">Painel de Configuracao Inicial</p>
  <div class="badge warn">Modo Pareamento Ativo</div>

  <h2>Rede Wi-Fi</h2>
  <div id="redes-loading" class="info">Buscando redes disponíveis...</div>
  <div id="redes-lista" style="display:none;margin-bottom:14px"></div>

  <label>SSID (nome da rede)</label>
  <input type="text" id="ssid" placeholder="Nome da rede Wi-Fi">

  <label>Senha</label>
  <input type="password" id="senha" placeholder="Senha do Wi-Fi">

  <hr class="sep">
  <h2>Servidor MQTT</h2>

  <label>IP do Servidor</label>
  <input type="text" id="mqtt_ip" value="10.10.0.208" placeholder="192.168.0.102">

  <label>Porta MQTT</label>
  <input type="number" id="mqtt_porta" value="1883">

  <hr class="sep">
  <h2>Identificação</h2>

  <label>ID da Máquina</label>
  <input type="text" id="id_maquina" placeholder="maquina_01">

  <label>Intervalo de Leitura (segundos)</label>
  <input type="number" id="intervalo" value="1" min="1" max="3600">

  <button class="btn" onclick="salvar()">Salvar e Conectar</button>
  <div class="msg" id="msg"></div>
</div>

<script>
// Buscar redes Wi-Fi disponíveis
fetch('/redes')
  .then(r=>r.json())
  .then(redes=>{
    document.getElementById('redes-loading').style.display='none';
    const lista = document.getElementById('redes-lista');
    lista.style.display='block';
    if(redes.length===0){
      lista.innerHTML='<div class="info">Nenhuma rede encontrada. Digite manualmente.</div>';
      return;
    }
    lista.innerHTML = '<label>Redes encontradas</label>' +
      redes.map(r=>`
        <div onclick="document.getElementById('ssid').value='${r.ssid}'"
          style="background:#22252f;border:1px solid #2a2d3a;border-radius:8px;
          padding:10px 12px;margin-bottom:8px;cursor:pointer;font-size:13px;
          display:flex;justify-content:space-between;align-items:center">
          <span>${r.ssid}</span>
          <span style="color:#8892a4;font-size:11px">${r.rssi} dBm</span>
        </div>`).join('');
  })
  .catch(()=>{
    document.getElementById('redes-loading').textContent='Não foi possível listar redes.';
  });

function salvar(){
  const dados = {
    ssid:       document.getElementById('ssid').value.trim(),
    senha:      document.getElementById('senha').value,
    mqtt_ip:    document.getElementById('mqtt_ip').value.trim(),
    mqtt_porta: parseInt(document.getElementById('mqtt_porta').value),
    id_maquina: document.getElementById('id_maquina').value.trim(),
    intervalo:  parseInt(document.getElementById('intervalo').value)
  };
  if(!dados.ssid){return mostrarMsg('Digite o nome da rede Wi-Fi.','err');}
  if(!dados.mqtt_ip){return mostrarMsg('Digite o IP do servidor.','err');}
  if(!dados.id_maquina){return mostrarMsg('Digite o ID da máquina.','err');}

  mostrarMsg('Salvando e conectando... O sensor irá reiniciar.','ok');

  fetch('/salvar',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(dados)
  }).catch(()=>{});
}

function mostrarMsg(txt,tipo){
  const m=document.getElementById('msg');
  m.textContent=txt;
  m.className='msg '+tipo;
  m.style.display='block';
}
</script>
</body>
</html>
)HTMLEND";

// ============================================================
//  FUNÇÕES — FLASH (Preferences)
// ============================================================
void carregarConfig() {
  prefs.begin("pt100", false);

  strlcpy(cfg.id_maquina,    prefs.getString("id",       DEFAULT_ID_MAQUINA).c_str(),  32);
  strlcpy(cfg.wifi_ssid,     prefs.getString("ssid",     "").c_str(),                  64);
  strlcpy(cfg.wifi_password, prefs.getString("pass",     "").c_str(),                  64);
  strlcpy(cfg.mqtt_server,   prefs.getString("mqtt_ip",  DEFAULT_MQTT_SERVER).c_str(), 64);
  cfg.mqtt_port      = prefs.getInt("mqtt_port",  DEFAULT_MQTT_PORT);
  cfg.intervalo_s    = prefs.getInt("intervalo",  DEFAULT_INTERVALO_S);
  cfg.limite_alta    = prefs.getFloat("lim_alta",  85.0);
  cfg.limite_baixa   = prefs.getFloat("lim_baixa", 10.0);
  cfg.limite_critica = prefs.getFloat("lim_crit",  100.0);

  prefs.end();

  Serial.println("[FLASH] Configurações carregadas:");
  Serial.printf("  ID:       %s\n", cfg.id_maquina);
  Serial.printf("  SSID:     %s\n", cfg.wifi_ssid);
  Serial.printf("  Servidor: %s:%d\n", cfg.mqtt_server, cfg.mqtt_port);
  Serial.printf("  Intervalo:%ds\n", cfg.intervalo_s);
}

void salvarConfig() {
  prefs.begin("pt100", false);
  prefs.putString("id",       cfg.id_maquina);
  prefs.putString("ssid",     cfg.wifi_ssid);
  prefs.putString("pass",     cfg.wifi_password);
  prefs.putString("mqtt_ip",  cfg.mqtt_server);
  prefs.putInt("mqtt_port",   cfg.mqtt_port);
  prefs.putInt("intervalo",   cfg.intervalo_s);
  prefs.putFloat("lim_alta",  cfg.limite_alta);
  prefs.putFloat("lim_baixa", cfg.limite_baixa);
  prefs.putFloat("lim_crit",  cfg.limite_critica);
  prefs.end();
  Serial.println("[FLASH] Configurações salvas.");
}

void resetarConfig() {
  prefs.begin("pt100", false);
  prefs.clear();
  prefs.end();
  Serial.println("[FLASH] Configurações resetadas.");
}

// ============================================================
//  FUNÇÕES — TÓPICOS MQTT
// ============================================================
void montarTopicos() {
  snprintf(topico_temp,       sizeof(topico_temp),       "sensores/%s/temperatura", cfg.id_maquina);
  snprintf(topico_status,     sizeof(topico_status),     "sensores/%s/status",      cfg.id_maquina);
  snprintf(topico_config_lim, sizeof(topico_config_lim), "config/%s/limiares",      cfg.id_maquina);
  snprintf(topico_config_int, sizeof(topico_config_int), "config/%s/intervalo",     cfg.id_maquina);
}

// ============================================================
//  FUNÇÕES — LED
// ============================================================
void piscarLED(int vezes, int ms_on, int ms_off) {
  for (int i = 0; i < vezes; i++) {
    digitalWrite(PIN_LED, HIGH); delay(ms_on);
    digitalWrite(PIN_LED, LOW);  delay(ms_off);
  }
}

// ============================================================
//  FUNÇÕES — MODO PAREAMENTO
// ============================================================
void iniciarPareamento() {
  modoAtual = MODO_PAREAMENTO;
  inicioPareamento = millis();

  // Criar rede Wi-Fi do ESP32
  char ap_ssid[48];
  snprintf(ap_ssid, sizeof(ap_ssid), "%s%s", AP_SSID_PREFIX, cfg.id_maquina);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap_ssid, AP_PASSWORD);

  Serial.println("\n[PAREAMENTO] Modo ativo!");
  Serial.printf("[PAREAMENTO] Rede: %s\n", ap_ssid);
  Serial.printf("[PAREAMENTO] Senha: %s\n", AP_PASSWORD);
  Serial.printf("[PAREAMENTO] IP do painel: http://192.168.4.1\n");
  Serial.printf("[PAREAMENTO] Timeout: %d minutos\n", TIMEOUT_PAREAMENTO / 60000);

  // ── Rota: página principal ──
  webServer.on("/", HTTP_GET, [](AsyncWebServerRequest *req) {
    req->send_P(200, "text/html", HTML_PAREAMENTO);
  });

  // ── Rota: listar redes Wi-Fi ──
  webServer.on("/redes", HTTP_GET, [](AsyncWebServerRequest *req) {
    int n = WiFi.scanNetworks();
    String json = "[";
    for (int i = 0; i < n; i++) {
      if (i > 0) json += ",";
      json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + WiFi.RSSI(i) + "}";
    }
    json += "]";
    req->send(200, "application/json", json);
  });

  // ── Rota: salvar configurações ──
  webServer.on("/salvar", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    NULL,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t idx, size_t total) {
      StaticJsonDocument<512> doc;
      if (deserializeJson(doc, data, len)) {
        req->send(400, "application/json", "{\"ok\":false}");
        return;
      }

      // Salvar na struct e na flash
      strlcpy(cfg.wifi_ssid,     doc["ssid"]      | "",                     64);
      strlcpy(cfg.wifi_password, doc["senha"]      | "",                     64);
      strlcpy(cfg.mqtt_server,   doc["mqtt_ip"]    | DEFAULT_MQTT_SERVER,    64);
      strlcpy(cfg.id_maquina,    doc["id_maquina"] | DEFAULT_ID_MAQUINA,     32);
      cfg.mqtt_port   = doc["mqtt_porta"] | DEFAULT_MQTT_PORT;
      cfg.intervalo_s = doc["intervalo"]  | DEFAULT_INTERVALO_S;

      salvarConfig();
      req->send(200, "application/json", "{\"ok\":true}");

      // Reiniciar após 2 segundos
      Serial.println("[PAREAMENTO] Configurações salvas! Reiniciando...");
      delay(2000);
      ESP.restart();
    }
  );

  // ── Rota: status JSON (para debug) ──
  webServer.on("/status", HTTP_GET, [](AsyncWebServerRequest *req) {
    StaticJsonDocument<256> doc;
    doc["id"]       = cfg.id_maquina;
    doc["ssid"]     = cfg.wifi_ssid;
    doc["servidor"] = cfg.mqtt_server;
    doc["porta"]    = cfg.mqtt_port;
    doc["modo"]     = "pareamento";
    String out; serializeJson(doc, out);
    req->send(200, "application/json", out);
  });

  webServer.begin();
  Serial.println("[PAREAMENTO] Servidor web iniciado em http://192.168.4.1");
}

// ============================================================
//  FUNÇÕES — WI-FI (modo normal)
// ============================================================
bool conectarWiFi() {
  if (strlen(cfg.wifi_ssid) == 0) {
    Serial.println("[WiFi] Nenhum SSID configurado.");
    return false;
  }

  Serial.printf("[WiFi] Conectando a '%s'...", cfg.wifi_ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.wifi_ssid, cfg.wifi_password);

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(500); Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiOK = true;
    Serial.printf("[WiFi] Conectado! IP: %s\n", WiFi.localIP().toString().c_str());
    configTime(-3 * 3600, 0, "pool.ntp.org", "br.pool.ntp.org");
    return true;
  }

  wifiOK = false;
  Serial.println("[WiFi] Falha ao conectar.");
  return false;
}

// ============================================================
//  FUNÇÕES — MQTT CALLBACK
// ============================================================
void callbackMQTT(char* topico, byte* payload, unsigned int length) {
  char msg[256];
  if (length >= sizeof(msg)) length = sizeof(msg) - 1;
  memcpy(msg, payload, length);
  msg[length] = '\0';

  Serial.printf("[MQTT] Recebido em '%s': %s\n", topico, msg);

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, msg) != DeserializationError::Ok) return;

  bool alterado = false;

  if (doc.containsKey("temp_alta"))    { cfg.limite_alta    = doc["temp_alta"];    alterado = true; }
  if (doc.containsKey("temp_baixa"))   { cfg.limite_baixa   = doc["temp_baixa"];   alterado = true; }
  if (doc.containsKey("temp_critica")) { cfg.limite_critica = doc["temp_critica"]; alterado = true; }
  if (doc.containsKey("intervalo_s"))  { cfg.intervalo_s    = doc["intervalo_s"];  alterado = true; }

  // Comando de reset (volta ao modo pareamento)
  if (doc.containsKey("cmd") && strcmp(doc["cmd"], "reset") == 0) {
    Serial.println("[MQTT] Comando de reset recebido! Entrando em modo pareamento...");
    resetarConfig();
    delay(1000);
    ESP.restart();
  }

  if (alterado) {
    salvarConfig();
    Serial.printf("[CONFIG] Atualizado: Alta=%.1f Baixa=%.1f Critica=%.1f Int=%ds\n",
      cfg.limite_alta, cfg.limite_baixa, cfg.limite_critica, cfg.intervalo_s);
  }
}

// ============================================================
//  FUNÇÕES — MQTT CONECTAR
// ============================================================
void conectarMQTT() {
  if (mqttClient.connected() || !wifiOK) return;

  char clientId[48];
  snprintf(clientId, sizeof(clientId), "esp32_%s", cfg.id_maquina);

  char lwt[128];
  snprintf(lwt, sizeof(lwt),
    "{\"id\":\"%s\",\"online\":false}", cfg.id_maquina);

  Serial.printf("[MQTT] Conectando a %s:%d...\n", cfg.mqtt_server, cfg.mqtt_port);

  bool ok = mqttClient.connect(clientId, NULL, NULL,
    topico_status, 1, true, lwt);

  if (ok) {
    mqttOK = true;
    mqttClient.subscribe(topico_config_lim, 1);
    mqttClient.subscribe(topico_config_int, 1);
    mqttClient.subscribe(topico_broadcast, 1);

    char status[128];
    snprintf(status, sizeof(status),
      "{\"id\":\"%s\",\"online\":true,\"ip\":\"%s\"}",
      cfg.id_maquina, WiFi.localIP().toString().c_str());
    mqttClient.publish(topico_status, status, true);

    Serial.println("[MQTT] Conectado!");
  } else {
    mqttOK = false;
    Serial.printf("[MQTT] Falha (rc=%d)\n", mqttClient.state());
  }
}

// ============================================================
//  FUNÇÕES — PUBLICAR
// ============================================================
void publicarLeitura() {
  if (!mqttClient.connected()) return;

  uint32_t ts = (uint32_t)time(nullptr);
  char payload[256];

  if (falhaAtual) {
    snprintf(payload, sizeof(payload),
      "{\"id\":\"%s\",\"ts\":%u,\"t\":null,\"f\":1}", cfg.id_maquina, ts);
  } else {
    snprintf(payload, sizeof(payload),
      "{\"id\":\"%s\",\"ts\":%u,\"t\":%.2f,\"f\":0}", cfg.id_maquina, ts, tempAtual);
  }

  if (mqttClient.publish(topico_temp, payload, false)) {
    Serial.printf("[PUB] %.2f°C → %s\n", tempAtual, topico_temp);
  } else {
    mqttOK = false;
    Serial.println("[PUB] Falha ao publicar.");
  }
}

void publicarHeartbeat() {
  if (!mqttClient.connected()) return;

  char payload[256];
  snprintf(payload, sizeof(payload),
    "{\"id\":\"%s\",\"online\":true,\"ip\":\"%s\","
    "\"rssi\":%d,\"uptime\":%lu,\"temp\":%.2f,\"falha\":%s,"
    "\"intervalo\":%d,\"lim_alta\":%.1f,\"lim_crit\":%.1f}",
    cfg.id_maquina,
    WiFi.localIP().toString().c_str(),
    WiFi.RSSI(),
    millis() / 1000,
    tempAtual,
    falhaAtual ? "true" : "false",
    cfg.intervalo_s,
    cfg.limite_alta,
    cfg.limite_critica
  );

  mqttClient.publish(topico_status, payload, true);
  Serial.printf("[HB] RSSI:%ddBm Uptime:%lus\n", WiFi.RSSI(), millis() / 1000);
}

// ============================================================
//  SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  digitalWrite(PIN_LED, LOW);

  Serial.println("\n========================================");
  Serial.println("  PT100 Monitor — Firmware v4.0");
  Serial.println("========================================\n");

  // Inicializar sensor
  sensor.begin(MAX31865_2WIRE);
  Serial.println("[OK] MAX31865 inicializado");

  // Carregar configurações da flash
  carregarConfig();
  montarTopicos();

  // Verificar se botão BOOT está pressionado (forçar pareamento)
  Serial.println("[BOOT] Segure o botão BOOT por 3s para entrar em modo pareamento...");
  unsigned long t0 = millis();
  bool forcePareamento = false;
  while (millis() - t0 < 3000) {
    if (digitalRead(PIN_BOOT) == LOW) {
      piscarLED(1, 50, 50);
    } else {
      // Botão não pressionado
      forcePareamento = false;
      break;
    }
    if (millis() - t0 >= 3000) {
      forcePareamento = true;
    }
  }

  if (forcePareamento) {
    Serial.println("[BOOT] Botão pressionado — forçando modo pareamento.");
    piscarLED(5, 100, 100);
    iniciarPareamento();
    return;
  }

  // Tentar conectar Wi-Fi
  bool conectou = conectarWiFi();

  if (!conectou) {
    // Sem Wi-Fi → entrar em modo pareamento
    Serial.println("[WiFi] Sem conexão — entrando em modo pareamento.");
    piscarLED(3, 200, 200);
    iniciarPareamento();
    return;
  }

  // Wi-Fi OK → configurar MQTT
  mqttClient.setServer(cfg.mqtt_server, cfg.mqtt_port);
  mqttClient.setCallback(callbackMQTT);
  mqttClient.setKeepAlive(60);
  mqttClient.setBufferSize(512);

  conectarMQTT();

  Serial.println("\n[OK] Sistema iniciado. Publicando leituras...\n");
}

// ============================================================
//  LOOP
// ============================================================
void loop() {
  unsigned long agora = millis();

  // ── MODO PAREAMENTO ──
  if (modoAtual == MODO_PAREAMENTO) {
    // Piscar LED lentamente para indicar modo pareamento
    static unsigned long tLed = 0;
    if (agora - tLed > 500) {
      tLed = agora;
      digitalWrite(PIN_LED, !digitalRead(PIN_LED));
    }

    // Timeout do modo pareamento (reinicia após 5 minutos)
    if (agora - inicioPareamento > TIMEOUT_PAREAMENTO) {
      Serial.println("[PAREAMENTO] Timeout — reiniciando...");
      ESP.restart();
    }

    return; // Não executa o restante do loop em modo pareamento
  }

  // ── MODO NORMAL ──

  // Manter MQTT
  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  // Reconectar Wi-Fi
  if (WiFi.status() != WL_CONNECTED && agora - ultimoReconect > 10000) {
    ultimoReconect = agora;
    wifiOK  = false;
    mqttOK  = false;
    Serial.println("[WiFi] Reconectando...");
    conectarWiFi();
  }

  // Reconectar MQTT
  if (!mqttClient.connected() && wifiOK && agora - ultimoReconect > 5000) {
    ultimoReconect = agora;
    conectarMQTT();
  }

  // Leitura e publicação
  unsigned long intervalo_ms = (unsigned long)cfg.intervalo_s * 1000UL;
  if (agora - ultimaLeitura >= intervalo_ms) {
    ultimaLeitura = agora;

    uint8_t fault = sensor.readFault();
    if (fault) {
      falhaAtual = true;
      sensor.clearFault();
      Serial.printf("[SENSOR] Falha: 0x%02X\n", fault);
    } else {
      falhaAtual = false;
      tempAtual  = sensor.temperature(RNOMINAL, RREF);
      Serial.printf("[TEMP] %.2f°C | Alta:%.1f Crit:%.1f\n",
        tempAtual, cfg.limite_alta, cfg.limite_critica);
    }

    publicarLeitura();
  }

  // Heartbeat a cada 30s
  if (agora - ultimoHeartbeat >= 30000) {
    ultimoHeartbeat = agora;
    publicarHeartbeat();
  }

  // LED: fixo se tudo OK, pisca se sem MQTT
  if (mqttOK) {
    digitalWrite(PIN_LED, HIGH);
  } else {
    static unsigned long tLed = 0;
    if (agora - tLed > 300) {
      tLed = agora;
      digitalWrite(PIN_LED, !digitalRead(PIN_LED));
    }
  }
}
