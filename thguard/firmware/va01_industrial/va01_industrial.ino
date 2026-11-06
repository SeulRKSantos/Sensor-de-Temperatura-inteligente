// ═══════════════════════════════════════════════════════════════════
//  TH-GUARD INDUSTRIAL — Firmware VA01 (ESP32 DevKit)
//
//  Cadeia de medicao:
//    PT100 -> TxIsoRail (0-10 V) -> modulo divisor 0-25 V (5:1) -> GPIO34
//
//  Este firmware NAO converte para graus. Ele mede a tensao no pino
//  (mV, filtrada) e envia ao servidor TH-GUARD. A conversao para °C
//  (faixa do transmissor, offset, fator do modulo, deteccao de falha)
//  fica no servidor e e editada pelo painel, aba "Industrial".
//  Assim, trocar a faixa de 150 °C para outra nao exige regravar o ESP.
//
//  Protocolo: o mesmo do TH-GUARD (registro por MAC), com "kind":"industrial".
//    -> thguard/register            {"mac","kind":"industrial","model","fw"}
//    <- thguard/<MAC>/config        {"sensor_id":"ind-001","interval":5}  (retained)
//    -> thguard/<id>/data           {"mv":412.3,"spread":2.1,"n":5,"ts":...}
//    -> thguard/<id>/status         {"ip","ssid","rssi","uptime","mac","kind","fw","interval"}
//    <- thguard/<id>/cmd            restart | reset_id | set_config | identify | read_now
//
//  Sem display e sem LEDs externos. Sinalizacao pelo LED azul da placa
//  (GPIO2, se existir) e pelo Serial (115200).
//
//  Bibliotecas: PubSubClient (Nick O'Leary), ArduinoJson (v7).
//  Core: esp32 by Espressif 2.x ou 3.x.
// ═══════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>
#include "secrets.h"

#define FW_VERSION "va01-1.0.0"
#define MODEL      "VA01"

// ══════════════════════════════════════════
//  HARDWARE
// ══════════════════════════════════════════
#define PIN_SINAL      34   // ADC1_CH6 — funciona com Wi-Fi ligado. Somente entrada.
#define PIN_BOOT       0    // botao BOOT da placa: segurar 6 s = apagar config
#define PIN_LED        2    // LED azul onboard (DevKit V1). -1 se a placa nao tiver.
#define LED_ATIVO_ALTO 1

// ══════════════════════════════════════════
//  AMOSTRAGEM (igual ao VA01_teste_leitura validado)
// ══════════════════════════════════════════
#define N_AMOSTRAS        64      // por leitura
#define US_ENTRE_AMOSTRAS 500     // 500 us entre amostras (~32 ms por leitura)
#define MS_ENTRE_LEITURAS 1000UL  // 1 leitura por segundo
#define MAX_LEITURAS_JAN  300     // limite do acumulador (intervalo maximo 300 s)

// ══════════════════════════════════════════
//  MQTT / TEMPOS
// ══════════════════════════════════════════
#define TOPIC_REGISTER     "thguard/register"
#define REGISTER_RETRY_MS  30000UL   // reenvia register a cada 30 s ate ter ID
#define MQTT_RETRY_MS      10000UL
#define STATUS_MS          60000UL   // status a cada 60 s
#define WIFI_RETRY_MS      60000UL   // em modo portal, tenta a rede salva a cada 60 s
#define WDT_TIMEOUT_S      60
#define INTERVALO_PADRAO_S 5
#define INTERVALO_MIN_S    2
#define INTERVALO_MAX_S    300

// ══════════════════════════════════════════
//  OBJETOS
// ══════════════════════════════════════════
WiFiClient   espClient;
PubSubClient mqtt(espClient);
WebServer    server(80);
Preferences  prefs;

// ══════════════════════════════════════════
//  CONFIG (persistida em NVS)
// ══════════════════════════════════════════
String cfg_ssid1, cfg_pass1, cfg_ssid2, cfg_pass2;
String cfg_server = "10.10.0.208";   // IP cabeado do servidor TH-GUARD
int    cfg_port   = 1883;
String sensorId   = "";
int    intervaloS = INTERVALO_PADRAO_S;

// ══════════════════════════════════════════
//  ESTADO
// ══════════════════════════════════════════
String macAddr;
String TOPIC_CONFIG, TOPIC_DATA, TOPIC_STATUS, TOPIC_CMD;
bool   registrado = false;
bool   modoPortal = false;

float  ultimoMv     = NAN;   // ultima leitura (1 s)
float  ultimoSpread = 0;
double somaMv       = 0;     // acumulador da janela de envio
float  somaSpread   = 0;
int    nJanela      = 0;

unsigned long t_leitura = 0, t_envio = 0, t_status = 0;
unsigned long t_register = 0, t_mqttRetry = 0, t_wifiRetry = 0;
unsigned long identifyAte = 0;

// ══════════════════════════════════════════
//  LED onboard (unica sinalizacao fisica)
//   portal (sem rede) .......... pisca lento (1 s)
//   Wi-Fi ok, sem MQTT ......... 2 piscadas curtas a cada 2 s
//   aguardando ID do servidor .. pisca rapido (150 ms)
//   operando ................... apagado, piscada curta a cada envio
//   identify (comando painel) .. pisca muito rapido por 15 s
// ══════════════════════════════════════════
void led(bool on) {
  if (PIN_LED < 0) return;
  digitalWrite(PIN_LED, (on == (bool)LED_ATIVO_ALTO) ? HIGH : LOW);
}

void tickLED() {
  if (PIN_LED < 0) return;
  unsigned long m = millis();
  if (identifyAte && m < identifyAte) { led((m / 60) % 2); return; }
  identifyAte = 0;
  if (modoPortal && WiFi.status() != WL_CONNECTED) { led((m / 1000) % 2); return; }
  if (!mqtt.connected()) { unsigned long f = m % 2000; led(f < 80 || (f > 240 && f < 320)); return; }
  if (!registrado) { led((m / 150) % 2); return; }
  led(m - t_envio < 40);
}

// ══════════════════════════════════════════
//  CONFIG — NVS
// ══════════════════════════════════════════
void carregarConfig() {
  prefs.begin("va01", true);
  cfg_ssid1  = prefs.getString("ssid1", "");
  cfg_pass1  = prefs.getString("pass1", "");
  cfg_ssid2  = prefs.getString("ssid2", "");
  cfg_pass2  = prefs.getString("pass2", "");
  cfg_server = prefs.getString("server", "10.10.0.208");
  cfg_port   = prefs.getInt("port", 1883);
  sensorId   = prefs.getString("sid", "");
  intervaloS = prefs.getInt("intv", INTERVALO_PADRAO_S);
  prefs.end();
  if (intervaloS < INTERVALO_MIN_S || intervaloS > INTERVALO_MAX_S) intervaloS = INTERVALO_PADRAO_S;
  registrado = sensorId.length() > 0;
  Serial.printf("[CFG] SSID1=%s SSID2=%s server=%s:%d ID=%s intervalo=%ds\n",
    cfg_ssid1.c_str(), cfg_ssid2.c_str(), cfg_server.c_str(), cfg_port,
    registrado ? sensorId.c_str() : "(nenhum)", intervaloS);
}

void salvarConfig() {
  prefs.begin("va01", false);
  prefs.putString("ssid1", cfg_ssid1);
  prefs.putString("pass1", cfg_pass1);
  prefs.putString("ssid2", cfg_ssid2);
  prefs.putString("pass2", cfg_pass2);
  prefs.putString("server", cfg_server);
  prefs.putInt("port", cfg_port);
  prefs.putString("sid", sensorId);
  prefs.putInt("intv", intervaloS);
  prefs.end();
  Serial.println("[CFG] Salvo.");
}

void apagarConfig() {
  prefs.begin("va01", false);
  prefs.clear();
  prefs.end();
  Serial.println("[CFG] Configuracao apagada.");
}

// ══════════════════════════════════════════
//  LEITURA ANALOGICA
//  64 amostras, ordena, descarta 25% de cada ponta, media do meio.
//  Retorna mV no PINO, sem offset (o offset e aplicado no servidor).
// ══════════════════════════════════════════
float lerPinoMv(float* spreadOut) {
  uint32_t a[N_AMOSTRAS];
  for (int i = 0; i < N_AMOSTRAS; i++) {
    a[i] = analogReadMilliVolts(PIN_SINAL);
    delayMicroseconds(US_ENTRE_AMOSTRAS);
  }
  for (int i = 1; i < N_AMOSTRAS; i++) {           // insercao
    uint32_t k = a[i]; int j = i - 1;
    while (j >= 0 && a[j] > k) { a[j + 1] = a[j]; j--; }
    a[j + 1] = k;
  }
  const int ini = N_AMOSTRAS / 4, fim = N_AMOSTRAS - N_AMOSTRAS / 4;
  uint32_t soma = 0;
  for (int i = ini; i < fim; i++) soma += a[i];
  if (spreadOut) *spreadOut = (float)a[fim - 1] - (float)a[ini];  // faixa interquartil (ruido)
  return (float)soma / (float)(fim - ini);
}

void tickLeitura() {
  if (millis() - t_leitura < MS_ENTRE_LEITURAS) return;
  t_leitura = millis();
  float sp = 0;
  float mv = lerPinoMv(&sp);
  ultimoMv = mv; ultimoSpread = sp;
  if (nJanela < MAX_LEITURAS_JAN) { somaMv += mv; somaSpread += sp; nJanela++; }
}

// ══════════════════════════════════════════
//  TOPICOS
// ══════════════════════════════════════════
void configurarTopicos() {
  TOPIC_DATA   = "thguard/" + sensorId + "/data";
  TOPIC_STATUS = "thguard/" + sensorId + "/status";
  TOPIC_CMD    = "thguard/" + sensorId + "/cmd";
}

// ══════════════════════════════════════════
//  WI-FI
// ══════════════════════════════════════════
bool tentarRede(const String& ssid, const String& pass) {
  if (ssid.length() == 0) return false;
  Serial.printf("[WIFI] Conectando a %s", ssid.c_str());
  WiFi.begin(ssid.c_str(), pass.c_str());
  unsigned long ini = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - ini < 15000) {
    delay(250); Serial.print("."); esp_task_wdt_reset();
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void abrirPortal() {
  if (modoPortal) return;
  String nome = "VA01-Setup-" + macAddr.substring(8);
  WiFi.mode(cfg_ssid1.length() ? WIFI_AP_STA : WIFI_AP);
  WiFi.softAP(nome.c_str(), AP_PASS);
  modoPortal = true;
  Serial.printf("[AP] Portal aberto: rede '%s', http://%s\n",
    nome.c_str(), WiFi.softAPIP().toString().c_str());
}

void fecharPortal() {
  if (!modoPortal) return;
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  modoPortal = false;
  Serial.println("[AP] Portal fechado (rede conectada).");
}

void conectarWifi() {
  if (cfg_ssid1.length() == 0) { abrirPortal(); return; }
  WiFi.mode(modoPortal ? WIFI_AP_STA : WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (tentarRede(cfg_ssid1, cfg_pass1) || tentarRede(cfg_ssid2, cfg_pass2)) {
    Serial.printf("[WIFI] OK  IP=%s  RSSI=%d  GW=%s\n",
      WiFi.localIP().toString().c_str(), WiFi.RSSI(), WiFi.gatewayIP().toString().c_str());
    fecharPortal();
  } else {
    Serial.println("[WIFI] Falhou. Abrindo portal e tentando de novo a cada 60 s.");
    abrirPortal();
  }
}

// Em campo, apos queda de energia o roteador pode subir depois do ESP.
// Por isso o portal nao e um estado final: a rede salva continua sendo tentada.
void tickWifi() {
  if (WiFi.status() == WL_CONNECTED) { if (modoPortal) fecharPortal(); return; }
  if (cfg_ssid1.length() == 0) return;
  if (millis() - t_wifiRetry < WIFI_RETRY_MS) return;
  t_wifiRetry = millis();
  if (WiFi.softAPgetStationNum() > 0) return;   // alguem esta usando o portal: nao derrubar
  conectarWifi();
}

// ══════════════════════════════════════════
//  MQTT — PUBLICACOES
// ══════════════════════════════════════════
void publicarStatus() {
  if (!mqtt.connected() || !registrado) return;
  JsonDocument d;
  d["ip"]       = WiFi.localIP().toString();
  d["ssid"]     = WiFi.SSID();
  d["rssi"]     = WiFi.RSSI();
  d["uptime"]   = millis() / 1000;
  d["mac"]      = macAddr;
  d["kind"]     = "industrial";
  d["model"]    = MODEL;
  d["fw"]       = FW_VERSION;
  d["interval"] = intervaloS;
  char buf[320]; serializeJson(d, buf, sizeof(buf));
  mqtt.publish(TOPIC_STATUS.c_str(), buf);
  t_status = millis();
}

void publicarDados() {
  if (!mqtt.connected() || !registrado) return;
  if (nJanela == 0) return;
  float mv = somaMv / nJanela;
  float sp = somaSpread / nJanela;
  JsonDocument d;
  d["mv"]     = serialized(String(mv, 1));
  d["spread"] = serialized(String(sp, 1));
  d["n"]      = nJanela;
  d["ts"]     = millis();
  char buf[160]; serializeJson(d, buf, sizeof(buf));
  if (mqtt.publish(TOPIC_DATA.c_str(), buf)) Serial.println("[MQTT] -> " + String(buf));
  somaMv = 0; somaSpread = 0; nJanela = 0;
  t_envio = millis();
}

void enviarRegister() {
  if (!mqtt.connected()) return;
  JsonDocument d;
  d["mac"]   = macAddr;
  d["kind"]  = "industrial";
  d["model"] = MODEL;
  d["fw"]    = FW_VERSION;
  char buf[160]; serializeJson(d, buf, sizeof(buf));
  mqtt.publish(TOPIC_REGISTER, buf);
  Serial.println("[MQTT] Register: " + String(buf));
  t_register = millis();
}

// ══════════════════════════════════════════
//  MQTT — CALLBACK
// ══════════════════════════════════════════
void aplicarIntervalo(JsonVariantConst v) {
  if (v.isNull()) return;
  int s = v.as<int>();
  if (s >= INTERVALO_MIN_S && s <= INTERVALO_MAX_S && s != intervaloS) {
    intervaloS = s;
    Serial.printf("[CFG] Intervalo de envio = %d s\n", intervaloS);
    salvarConfig();
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int len) {
  String t(topic);
  JsonDocument d;
  DeserializationError err = deserializeJson(d, payload, len);
  Serial.printf("[MQTT] <- %s (%u bytes)\n", topic, len);
  if (err) { Serial.println("[MQTT] JSON invalido: " + String(err.c_str())); return; }

  // ── Atribuicao de ID pelo servidor ──
  if (t == TOPIC_CONFIG) {
    const char* sid = d["sensor_id"];
    if (!sid || !*sid) return;
    if (String(sid) != sensorId) {
      if (registrado) mqtt.unsubscribe(TOPIC_CMD.c_str());
      sensorId = sid;
      registrado = true;
      configurarTopicos();
      salvarConfig();
      Serial.println("[MQTT] ID atribuido: " + sensorId);
    }
    aplicarIntervalo(d["interval"]);
    mqtt.subscribe(TOPIC_CMD.c_str());
    publicarStatus();
    return;
  }

  // ── Comandos do painel ──
  // O backend envia {"action":"restart"} (routes/commands.js); o formato
  // antigo {"restart":true} tambem e aceito.
  if (t == TOPIC_CMD) {
    String act = d["action"] | "";
    auto cmd = [&](const char* k) { return act == k || (d[k] | false); };
    if (cmd("restart")) {
      Serial.println("[CMD] restart"); mqtt.disconnect(); delay(300); ESP.restart();
    }
    if (cmd("reset_id") || cmd("reset_eeprom")) {
      Serial.println("[CMD] reset_id: apagando ID e registrando de novo");
      sensorId = ""; registrado = false; salvarConfig();
      mqtt.disconnect(); delay(300); ESP.restart();
    }
    if (cmd("identify")) {
      Serial.println("[CMD] identify: LED piscando por 15 s");
      identifyAte = millis() + 15000;
    }
    if (cmd("read_now")) {
      if (nJanela == 0) { somaMv = ultimoMv; somaSpread = ultimoSpread; nJanela = isnan(ultimoMv) ? 0 : 1; }
      publicarDados(); publicarStatus();
    }
    if (cmd("set_config")) {
      bool reconectar = false;
      auto str = [&](const char* k, String& dst, bool rede) {
        const char* v = d[k];
        if (v && *v && dst != v) { dst = v; if (rede) reconectar = true; }
      };
      str("ssid1", cfg_ssid1, true);  str("pass1", cfg_pass1, true);
      str("ssid2", cfg_ssid2, true);  str("pass2", cfg_pass2, true);
      str("serverIp", cfg_server, true);
      if (!d["serverPort"].isNull()) {
        int p = d["serverPort"]; if (p > 0 && p < 65536 && p != cfg_port) { cfg_port = p; reconectar = true; }
      }
      aplicarIntervalo(d["interval"]);
      salvarConfig();
      publicarStatus();
      if (reconectar) {
        Serial.println("[CMD] Rede/servidor alterados. Reiniciando em 1 s...");
        mqtt.disconnect(); delay(1000); ESP.restart();
      }
    }
  }
}

// ══════════════════════════════════════════
//  MQTT — CONEXAO
// ══════════════════════════════════════════
void conectarMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  mqtt.setServer(cfg_server.c_str(), cfg_port);
  mqtt.setCallback(mqttCallback);
  mqtt.setKeepAlive(60);
  mqtt.setBufferSize(512);
  mqtt.setSocketTimeout(5);
  String cid = "thguard-" + macAddr;
  Serial.printf("[MQTT] Conectando %s em %s:%d... ", cid.c_str(), cfg_server.c_str(), cfg_port);
  if (!mqtt.connect(cid.c_str(), MQTT_USER, MQTT_PASS)) {
    Serial.printf("falha rc=%d%s\n", mqtt.state(),
      mqtt.state() == 4 || mqtt.state() == 5 ? " (usuario/senha MQTT - confira secrets.h)" : "");
    return;
  }
  Serial.println("OK");
  TOPIC_CONFIG = "thguard/" + macAddr + "/config";
  mqtt.subscribe(TOPIC_CONFIG.c_str());
  if (registrado) {
    configurarTopicos();
    mqtt.subscribe(TOPIC_CMD.c_str());
    publicarStatus();
  } else {
    enviarRegister();
  }
}

void tickMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!mqtt.connected()) {
    if (millis() - t_mqttRetry >= MQTT_RETRY_MS) { t_mqttRetry = millis(); conectarMQTT(); }
    return;
  }
  mqtt.loop();
  if (!registrado) {
    if (millis() - t_register >= REGISTER_RETRY_MS) enviarRegister();
    return;
  }
  if (millis() - t_envio  >= (unsigned long)intervaloS * 1000UL) publicarDados();
  if (millis() - t_status >= STATUS_MS) publicarStatus();
}

// ══════════════════════════════════════════
//  PORTAL WEB (http://192.168.4.1 no AP, ou http://<ip> na rede)
//  Protegido por usuario/senha (PORTAL_USER/PORTAL_PASS em secrets.h).
//  Senhas de Wi-Fi nunca sao exibidas; campo vazio = manter a atual.
// ══════════════════════════════════════════
const char HTML_PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VA01 - Configuracao</title><style>
body{font-family:Arial,sans-serif;background:#080a0f;color:#dfe6f3;margin:0;padding:16px}
.c{max-width:440px;margin:auto}h1{color:#1a4fd6;font-size:20px;margin:0 0 4px}
.sub{color:#7d8aa3;font-size:12px;margin-bottom:14px}
.box{background:#111622;border:1px solid #1f2738;border-radius:8px;padding:12px;margin-bottom:12px}
.row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}
.ok{color:#2ecc71}.err{color:#e74c3c}.big{font-size:28px;font-weight:bold;color:#fff}
label{display:block;font-size:12px;color:#9aa6bd;margin-top:8px}
input{width:100%;box-sizing:border-box;padding:8px;background:#0b0f18;border:1px solid #2a3348;
color:#fff;border-radius:5px}button{margin-top:14px;width:100%;padding:10px;background:#1a4fd6;
color:#fff;border:0;border-radius:5px;font-size:15px}
</style></head><body><div class="c">
<h1>TH-GUARD Industrial - VA01</h1><div class="sub">%FW%</div>
<div class="box">
<div class="row"><span>Sinal no pino</span><span class="big" id="mv">%MV%</span></div>
<div class="row"><span>Tensao estimada no transmissor</span><span id="vtx">%VTX%</span></div>
<div class="row"><span>Ruido (faixa interquartil)</span><span id="sp">%SP%</span></div>
</div>
<div class="box">
<div class="row"><span>MAC</span><span>%MAC%</span></div>
<div class="row"><span>ID no servidor</span><span>%SID%</span></div>
<div class="row"><span>Wi-Fi</span><span class="%WC%">%WS%</span></div>
<div class="row"><span>MQTT</span><span class="%MC%">%MS%</span></div>
<div class="row"><span>Intervalo de envio</span><span>%INT% s</span></div>
</div>
<form class="box" method="POST" action="/salvar">
<label>Rede Wi-Fi principal</label><input name="s1" value="%S1%">
<label>Senha (vazio = manter)</label><input name="p1" type="password">
<label>Rede Wi-Fi reserva</label><input name="s2" value="%S2%">
<label>Senha (vazio = manter)</label><input name="p2" type="password">
<label>Servidor TH-GUARD (IP)</label><input name="sv" value="%SV%">
<label>Porta MQTT</label><input name="sp" value="%SPT%">
<button type="submit">Salvar e reiniciar</button>
</form>
<div class="sub">A conversao para &deg;C, a faixa do transmissor e os limites de alarme
sao configurados no painel TH-GUARD, aba Industrial.</div>
</div><script>
setInterval(()=>{fetch('/api').then(r=>r.json()).then(d=>{
document.getElementById('mv').innerText=d.mv.toFixed(1)+' mV';
document.getElementById('vtx').innerText=(d.mv*5/1000).toFixed(2)+' V';
document.getElementById('sp').innerText=d.sp.toFixed(1)+' mV';}).catch(()=>{});},2000);
</script></body></html>
)rawliteral";

bool autenticar() {
  if (server.authenticate(PORTAL_USER, PORTAL_PASS)) return true;
  server.requestAuthentication(BASIC_AUTH, "VA01");
  return false;
}

String escHtml(String s) {
  s.replace("&", "&amp;"); s.replace("<", "&lt;"); s.replace(">", "&gt;"); s.replace("\"", "&quot;");
  return s;
}

void handleRoot() {
  if (!autenticar()) return;
  bool wok = WiFi.status() == WL_CONNECTED;
  String p = FPSTR(HTML_PAGE);
  p.replace("%FW%",  FW_VERSION);
  p.replace("%MV%",  isnan(ultimoMv) ? "--" : String(ultimoMv, 1) + " mV");
  p.replace("%VTX%", isnan(ultimoMv) ? "--" : String(ultimoMv * 5.0f / 1000.0f, 2) + " V");
  p.replace("%SP%",  String(ultimoSpread, 1) + " mV");
  p.replace("%MAC%", macAddr);
  p.replace("%SID%", registrado ? sensorId : "aguardando servidor");
  p.replace("%WC%",  wok ? "ok" : "err");
  p.replace("%WS%",  wok ? escHtml(WiFi.SSID()) + " (" + String(WiFi.RSSI()) + " dBm)" : "desconectado");
  p.replace("%MC%",  mqtt.connected() ? "ok" : "err");
  p.replace("%MS%",  mqtt.connected() ? "conectado" : "desconectado");
  p.replace("%INT%", String(intervaloS));
  p.replace("%S1%",  escHtml(cfg_ssid1));
  p.replace("%S2%",  escHtml(cfg_ssid2));
  p.replace("%SV%",  escHtml(cfg_server));
  p.replace("%SPT%", String(cfg_port));
  server.send(200, "text/html", p);
}

void handleApi() {
  if (!autenticar()) return;
  char buf[96];
  snprintf(buf, sizeof(buf), "{\"mv\":%.1f,\"sp\":%.1f,\"id\":\"%s\"}",
    isnan(ultimoMv) ? 0.0f : ultimoMv, ultimoSpread, sensorId.c_str());
  server.send(200, "application/json", buf);
}

void handleSalvar() {
  if (!autenticar()) return;
  String s1 = server.arg("s1"); s1.trim();
  if (s1.length() == 0) { server.send(400, "text/plain", "Informe a rede Wi-Fi principal."); return; }
  if (s1 != cfg_ssid1) cfg_pass1 = "";               // trocou a rede: senha antiga nao vale
  cfg_ssid1 = s1;
  if (server.arg("p1").length()) cfg_pass1 = server.arg("p1");
  String s2 = server.arg("s2"); s2.trim();
  if (s2 != cfg_ssid2) cfg_pass2 = "";
  cfg_ssid2 = s2;
  if (server.arg("p2").length()) cfg_pass2 = server.arg("p2");
  String sv = server.arg("sv"); sv.trim();
  if (sv.length()) cfg_server = sv;
  int pt = server.arg("sp").toInt(); if (pt > 0 && pt < 65536) cfg_port = pt;
  salvarConfig();
  server.send(200, "text/html",
    "<body style='font-family:Arial;background:#080a0f;color:#1a4fd6;display:flex;"
    "align-items:center;justify-content:center;height:100vh;margin:0'>"
    "<h2>Salvo. Reiniciando...</h2></body>");
  delay(1500); ESP.restart();
}

// ══════════════════════════════════════════
//  BOTAO BOOT: segurar 6 s com o ESP ligado = apagar tudo e abrir portal
// ══════════════════════════════════════════
void tickBotao() {
  static unsigned long t0 = 0;
  if (digitalRead(PIN_BOOT) == LOW) {
    if (!t0) t0 = millis();
    if (millis() - t0 > 6000) {
      Serial.println("[BTN] Reset de fabrica.");
      for (int i = 0; i < 10; i++) { led(i % 2); delay(80); }
      apagarConfig(); delay(300); ESP.restart();
    }
  } else t0 = 0;
}

// ══════════════════════════════════════════
//  WATCHDOG (compativel com core 2.x e 3.x)
// ══════════════════════════════════════════
void iniciarWatchdog() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t c = { .timeout_ms = WDT_TIMEOUT_S * 1000, .idle_core_mask = 0, .trigger_panic = true };
  if (esp_task_wdt_reconfigure(&c) != ESP_OK) esp_task_wdt_init(&c);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);
}

// ══════════════════════════════════════════
//  SETUP / LOOP
// ══════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[VA01] Boot %s  (reset: %d)\n", FW_VERSION, (int)esp_reset_reason());

  if (PIN_LED >= 0) { pinMode(PIN_LED, OUTPUT); led(false); }
  pinMode(PIN_BOOT, INPUT_PULLUP);

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SINAL, ADC_11db);   // ate ~3,1 V; o pino fica <= 2,4 V mesmo em falha

  iniciarWatchdog();

  // No ESP32 o MAC so e valido depois de inicializar o driver Wi-Fi
  WiFi.mode(WIFI_STA);
  delay(100);
  macAddr = WiFi.macAddress();
  macAddr.replace(":", "");
  macAddr.toUpperCase();
  Serial.println("[MAC] " + macAddr);

  carregarConfig();
  ultimoMv = lerPinoMv(&ultimoSpread);
  Serial.printf("[ADC] Primeira leitura: %.1f mV no pino (~%.2f V no transmissor)\n",
    ultimoMv, ultimoMv * 5.0f / 1000.0f);

  conectarWifi();

  server.on("/",       handleRoot);
  server.on("/api",    handleApi);
  server.on("/salvar", HTTP_POST, handleSalvar);
  server.begin();

  conectarMQTT();
  t_envio = millis();
  Serial.println("[VA01] Pronto. ID=" + (registrado ? sensorId : String("pendente")));
}

void loop() {
  esp_task_wdt_reset();
  server.handleClient();
  tickBotao();
  tickWifi();
  tickLeitura();
  tickMQTT();
  tickLED();
  delay(2);
}
