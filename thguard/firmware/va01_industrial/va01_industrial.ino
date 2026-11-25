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
//    <- thguard/<id>/cmd            restart | reset_id | set_config | identify | read_now | ota
//    -> thguard/<id>/ota            {"job","state","progress","msg","version"}  (atualizacao pela rede)
//
//  Atualizacao pela rede (OTA): o painel envia o comando "ota"; o ESP baixa o .bin
//  do servidor por HTTP, confere o SHA-256 e a ASSINATURA (chave publica OTA_PUBKEY
//  no secrets.h; a chave privada fica so no servidor) e grava na outra particao.
//  Depois de reiniciar, a versao nova so e confirmada quando conecta ao broker; se
//  nao conectar em 5 min (ou travar antes), o ESP volta sozinho para a versao anterior.
//
//  Sinalizacao: LED verde (GPIO25) e LED vermelho (GPIO26), tabela abaixo,
//  alem do LED azul da placa (GPIO2) e do Serial (115200).
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
#include <HTTPClient.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>
#include <mbedtls/pk.h>
#include <mbedtls/base64.h>
#include "secrets.h"

#ifndef OTA_PUBKEY
#error "Falta OTA_PUBKEY no secrets.h: copie a chave publica em Painel de administracao > Firmware (veja secrets.h.example)"
#endif

#define FW_VERSION "va01-1.2.0"
#define MODEL      "VA01"
// Marca lida pelo servidor no upload do .bin: impede gravar firmware de outro modelo
const char FW_MARK[] = "THGUARD-FW|model=" MODEL "|ver=" FW_VERSION "|";

// ══════════════════════════════════════════
//  HARDWARE
// ══════════════════════════════════════════
#define PIN_SINAL      34   // ADC1_CH6 — funciona com Wi-Fi ligado. Somente entrada.
#define PIN_BOOT       0    // botao BOOT da placa: segurar 6 s = apagar config
#define PIN_LED        2    // LED azul onboard (DevKit V1). -1 se a placa nao tiver.
#define LED_ATIVO_ALTO 1
#define PIN_LED_VERDE    25 // GPIO25 -> 330 ohm -> LED verde -> GND. -1 = sem LED
#define PIN_LED_VERMELHO 26 // GPIO26 -> 330 ohm -> LED vermelho -> GND. -1 = sem LED

// Limites de leitura vistos pelo ESP (mV no PINO, ja com o offset de -16 mV do ADC).
// A conversao para graus continua no servidor; estes limites so acendem os LEDs.
#define FALHA_LEITURA_MV 2116  // 10,5 V no transmissor (/5 +16): upscale = PT100 aberto
#define SATURADO_MV      2900  // perto do maximo do ADC: sinal fora da faixa
#define THERMA_OFF_MV    166   // 0,75 V no transmissor: indicador Therma desligado
#define THERMA_ON_MV     176   // volta a "ligado" acima de 0,80 V (histerese, igual ao painel)
#define LEITURAS_FALHA   3     // leituras seguidas (1/s) para entrar ou sair da falha
#define ID_TIMEOUT_MS    60000UL // conectado ao broker e sem ID por 60 s = falha do servidor
#define TESTE_LEDS_MS    2000UL  // "ligando": os dois LEDs acesos ao ligar

// Atualizacao pela rede
#define OTA_VERIFY_MS    300000UL  // versao nova tem 5 min para conectar ao broker
#define OTA_STALL_MS     20000UL   // download parado por 20 s = erro

// Estados dos LEDs (declarados aqui em cima por causa dos prototipos gerados pelo Arduino)
enum EstadoLed { L_LIGANDO, L_OTA, L_IDENTIFICAR, L_CONFIG, L_FALHA_WIFI, L_FALHA_SERVIDOR,
                 L_FALHA_LEITURA, L_INICIANDO, L_THERMA_OFF, L_NORMAL };
const char* NOME_ESTADO[] = { "ligando", "atualizando firmware", "identificar", "modo de configuracao", "falha no Wi-Fi",
  "falha com o servidor", "falha de leitura", "iniciando", "Therma desligado", "operando" };


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

// Diagnostico usado pelos LEDs
bool   jaConectouWifi = false, wifiFalhou = false;
bool   jaConectouMqtt = false, mqttFalhou = false;
unsigned long t_mqttOk = 0;          // quando o broker conectou (para o timeout do ID)
// Atualizacao pela rede
struct PedidoOta { bool pendente = false; long job = 0; String versao, sha, assinatura, url; uint32_t tamanho = 0; } ota;
bool   otaEmAndamento = false;
bool   otaVerificar   = false;      // rodando versao nova ainda nao confirmada
long   otaJobBoot     = 0;          // job salvo antes de reiniciar (NVS)
String otaAlvoBoot;                 // versao esperada depois do reinicio
String TOPIC_OTA;

bool   testeLeds = true;                // "ligando" ate o fim do teste dos LEDs no setup
bool   falhaLeitura = false, thermaOff = false;
int    contFalha = 0, contOk = 0;

// ══════════════════════════════════════════
//  LED azul da placa (sinalizacao original, mantida)
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
//  LEDS VERDE E VERMELHO
//  Uma indicacao por vez; vale a de maior prioridade (de cima para baixo).
//  Ciclo de 3 s: piscada curta = 150 ms aceso / 150 ms apagado.
//
//   Estado                        Verde                    Vermelho
//   ligando (2 s)                 aceso                    aceso
//   atualizando firmware          pisca rapido, alternando com o vermelho
//   identificar (painel, 15 s)    pisca muito rapido       apagado
//   modo de configuracao          piscada longa, alternando com o vermelho
//   falha no Wi-Fi                apagado                  2 piscadas curtas
//   falha com o servidor (MQTT)   apagado                  3 piscadas curtas
//   falha de leitura              apagado                  piscada longa (1 s)
//   iniciando                     piscada longa (1 s)      apagado
//   Therma desligado              1 piscada curta / 3 s    apagado
//   operando normal               aceso fixo               apagado
//   apagando a config (BOOT 6 s)  pisca rapido junto com o vermelho
// ══════════════════════════════════════════
void ledsRG(bool verde, bool vermelho) {
  if (PIN_LED_VERDE    >= 0) digitalWrite(PIN_LED_VERDE,    verde    ? HIGH : LOW);
  if (PIN_LED_VERMELHO >= 0) digitalWrite(PIN_LED_VERMELHO, vermelho ? HIGH : LOW);
}

bool piscadas(unsigned long m, int n) {        // n piscadas curtas a cada 3 s
  unsigned long f = m % 3000UL;
  return f < (unsigned long)n * 300UL && (f % 300UL) < 150UL;
}

EstadoLed estadoAtual() {
  unsigned long m = millis();
  bool wifiOk = WiFi.status() == WL_CONNECTED;
  if (testeLeds) return L_LIGANDO;
  if (otaEmAndamento) return L_OTA;
  if (identifyAte && m < identifyAte) return L_IDENTIFICAR;
  if (modoPortal && !wifiOk && (cfg_ssid1.length() == 0 || WiFi.softAPgetStationNum() > 0)) return L_CONFIG;
  if (!wifiOk) return (wifiFalhou || jaConectouWifi) ? L_FALHA_WIFI : L_INICIANDO;
  if (!mqtt.connected()) return (mqttFalhou || jaConectouMqtt) ? L_FALHA_SERVIDOR : L_INICIANDO;
  if (!registrado && m - t_mqttOk > ID_TIMEOUT_MS) return L_FALHA_SERVIDOR;
  if (falhaLeitura) return L_FALHA_LEITURA;
  if (!registrado) return L_INICIANDO;
  if (thermaOff) return L_THERMA_OFF;
  return L_NORMAL;
}

void tickLeds() {
  static int anterior = -1;
  unsigned long m = millis();
  EstadoLed e = estadoAtual();
  if ((int)e != anterior) { Serial.printf("[LED] %s\n", NOME_ESTADO[e]); anterior = e; }
  bool longa = (m / 1000UL) % 2 == 0;
  switch (e) {
    case L_LIGANDO:        ledsRG(true, true); break;
    case L_OTA:            { bool f = (m / 250UL) % 2; ledsRG(f, !f); } break;
    case L_IDENTIFICAR:    ledsRG((m / 60UL) % 2, false); break;
    case L_CONFIG:         ledsRG(longa, !longa); break;
    case L_FALHA_WIFI:     ledsRG(false, piscadas(m, 2)); break;
    case L_FALHA_SERVIDOR: ledsRG(false, piscadas(m, 3)); break;
    case L_FALHA_LEITURA:  ledsRG(false, longa); break;
    case L_INICIANDO:      ledsRG(longa, false); break;
    case L_THERMA_OFF:     ledsRG(piscadas(m, 1), false); break;
    default:               ledsRG(true, false); break;
  }
}

// Falha e Therma desligado so mudam depois de LEITURAS_FALHA leituras seguidas
void avaliarLeitura(float mv) {
  bool ruim = isnan(mv) || mv >= FALHA_LEITURA_MV || mv >= SATURADO_MV;
  if (ruim) { contOk = 0; if (++contFalha >= LEITURAS_FALHA && !falhaLeitura) { falhaLeitura = true; Serial.printf("[ADC] Falha de leitura: %.1f mV no pino\n", mv); } }
  else      { contFalha = 0; if (++contOk >= LEITURAS_FALHA && falhaLeitura) { falhaLeitura = false; Serial.println("[ADC] Leitura normalizada"); } }
  if (!isnan(mv)) {
    if (!thermaOff && mv < THERMA_OFF_MV) thermaOff = true;
    else if (thermaOff && mv > THERMA_ON_MV) thermaOff = false;
  }
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
  otaJobBoot  = prefs.getLong("otajob", 0);
  otaAlvoBoot = prefs.getString("otaver", "");
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

void salvarJobOta(long job, const String& versao) {
  prefs.begin("va01", false);
  if (job) { prefs.putLong("otajob", job); prefs.putString("otaver", versao); }
  else     { prefs.remove("otajob"); prefs.remove("otaver"); }
  prefs.end();
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
  avaliarLeitura(mv);
  if (nJanela < MAX_LEITURAS_JAN) { somaMv += mv; somaSpread += sp; nJanela++; }
}

// ══════════════════════════════════════════
//  TOPICOS
// ══════════════════════════════════════════
void configurarTopicos() {
  TOPIC_DATA   = "thguard/" + sensorId + "/data";
  TOPIC_STATUS = "thguard/" + sensorId + "/status";
  TOPIC_CMD    = "thguard/" + sensorId + "/cmd";
  TOPIC_OTA    = "thguard/" + sensorId + "/ota";
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
    delay(250); Serial.print("."); esp_task_wdt_reset(); tickLeds();
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
    jaConectouWifi = true; wifiFalhou = false;
    fecharPortal();
  } else {
    Serial.println("[WIFI] Falhou. Abrindo portal e tentando de novo a cada 60 s.");
    wifiFalhou = true;
    abrirPortal();
  }
}

// Em campo, apos queda de energia o roteador pode subir depois do ESP.
// Por isso o portal nao e um estado final: a rede salva continua sendo tentada.
void tickWifi() {
  if (WiFi.status() == WL_CONNECTED) { jaConectouWifi = true; wifiFalhou = false; if (modoPortal) fecharPortal(); return; }
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
  d["ota"]      = 1;                 // aceita atualizacao pela rede
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
//  ATUALIZACAO PELA REDE (OTA)
// ══════════════════════════════════════════
void publicarOta(long job, const char* estado, int progresso = -1, const String& msg = "") {
  Serial.printf("[OTA] job %ld: %s %s%s\n", job, estado, progresso >= 0 ? (String(progresso) + "%").c_str() : "", msg.c_str());
  if (!mqtt.connected() || !registrado || !job) return;
  JsonDocument d;
  d["job"] = job; d["state"] = estado; d["version"] = FW_VERSION;
  if (progresso >= 0) d["progress"] = progresso;
  if (msg.length()) d["msg"] = msg;
  char buf[256]; serializeJson(d, buf, sizeof(buf));
  mqtt.publish(TOPIC_OTA.c_str(), buf);
}

// Chamada quando o broker conecta: confirma a versao nova e informa o resultado do job
void confirmarOta() {
  if (otaVerificar) {
    esp_ota_mark_app_valid_cancel_rollback();
    otaVerificar = false;
    Serial.println("[OTA] Versao " FW_VERSION " confirmada (conectou ao broker).");
  }
  if (otaJobBoot && registrado && mqtt.connected()) {
    if (otaAlvoBoot == FW_VERSION) publicarOta(otaJobBoot, "done");
    else publicarOta(otaJobBoot, "rolled_back", -1, "a versao nova nao iniciou; voltou para " FW_VERSION);
    otaJobBoot = 0; otaAlvoBoot = ""; salvarJobOta(0, "");
  }
}

// Versao nova que nao conecta ao broker em 5 min volta para a anterior
void tickVerificacaoOta() {
  if (otaVerificar && millis() > OTA_VERIFY_MS) {
    Serial.println("[OTA] Versao nova nao conectou ao broker em 5 min. Voltando para a anterior...");
    delay(200);
    esp_ota_mark_app_invalid_rollback_and_reboot();
  }
}

String hexDe(const uint8_t* b, size_t n) {
  static const char* h = "0123456789abcdef"; String s; s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) { s += h[b[i] >> 4]; s += h[b[i] & 15]; }
  return s;
}

// Confere a assinatura ECDSA P-256 (DER, base64) do SHA-256 com a chave publica do secrets.h
bool assinaturaValida(const uint8_t hash[32], const String& b64) {
  uint8_t sig[160]; size_t slen = 0;
  if (mbedtls_base64_decode(sig, sizeof(sig), &slen, (const uint8_t*)b64.c_str(), b64.length()) != 0) return false;
  mbedtls_pk_context pk; mbedtls_pk_init(&pk);
  const char* pem = OTA_PUBKEY;
  bool ok = mbedtls_pk_parse_public_key(&pk, (const uint8_t*)pem, strlen(pem) + 1) == 0 &&
            mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, hash, 32, sig, slen) == 0;
  mbedtls_pk_free(&pk);
  return ok;
}

// Executa o pedido de OTA (no loop, fora do callback do MQTT)
void executarOta() {
  if (!ota.pendente) return;
  ota.pendente = false;
  otaEmAndamento = true;
  long job = ota.job;
  auto falhar = [&](const String& msg) {
    if (Update.isRunning()) Update.abort();
    publicarOta(job, "error", -1, msg);
    otaEmAndamento = false;
  };

  publicarDados();                                 // nao perde as leituras da janela atual
  HTTPClient http;
  WiFiClient cli;
  http.setTimeout(15000);
  if (!http.begin(cli, ota.url)) { falhar("URL invalida"); return; }
  int code = http.GET();
  if (code != 200) { http.end(); falhar("download respondeu HTTP " + String(code)); return; }
  int total = http.getSize();
  if (total <= 0 || (uint32_t)total != ota.tamanho) { http.end(); falhar("tamanho diferente do esperado"); return; }
  if (!Update.begin(total, U_FLASH)) { http.end(); falhar(String("sem espaco: ") + Update.errorString()); return; }

  mbedtls_sha256_context sha; mbedtls_sha256_init(&sha); mbedtls_sha256_starts(&sha, 0);
  WiFiClient* st = http.getStreamPtr();
  static uint8_t buf[2048];
  int lido = 0, ultimoPct = -1;
  unsigned long tDado = millis();
  publicarOta(job, "downloading", 0);
  while (lido < total) {
    esp_task_wdt_reset(); tickLeds(); mqtt.loop();
    size_t disp = st->available();
    if (!disp) {
      if (!http.connected() || millis() - tDado > OTA_STALL_MS) { http.end(); mbedtls_sha256_free(&sha); falhar("download interrompido"); return; }
      delay(5); continue;
    }
    int n = st->readBytes(buf, min(disp, sizeof(buf)));
    if (n <= 0) continue;
    tDado = millis();
    mbedtls_sha256_update(&sha, buf, n);
    if (Update.write(buf, n) != (size_t)n) { http.end(); mbedtls_sha256_free(&sha); falhar(String("erro ao gravar: ") + Update.errorString()); return; }
    lido += n;
    int pct = (int)((int64_t)lido * 100 / total);
    if (pct / 10 != ultimoPct / 10) { ultimoPct = pct; publicarOta(job, "downloading", pct); }
  }
  http.end();
  uint8_t hash[32];
  mbedtls_sha256_finish(&sha, hash); mbedtls_sha256_free(&sha);
  if (!hexDe(hash, 32).equalsIgnoreCase(ota.sha)) { falhar("SHA-256 nao confere (arquivo corrompido)"); return; }
  if (!assinaturaValida(hash, ota.assinatura)) { falhar("assinatura invalida: firmware recusado"); return; }
  if (!Update.end()) { falhar(String("imagem invalida: ") + Update.errorString()); return; }

  salvarJobOta(job, ota.versao);
  publicarOta(job, "rebooting", 100, "reiniciando em " + ota.versao);
  for (int i = 0; i < 20; i++) { mqtt.loop(); delay(50); }
  mqtt.disconnect(); delay(300);
  ESP.restart();
}

void pedidoOta(JsonDocument& d) {
  long job = d["job"] | 0L;
  const char* ver = d["version"] | "";
  const char* sha = d["sha256"] | "";
  const char* sig = d["sig"] | "";
  const char* path = d["path"] | "";
  const char* url = d["url"] | "";
  uint32_t tam = d["size"] | 0;
  int port = d["port"] | 80;
  if (!job) return;
  if (!*ver || strlen(sha) != 64 || !*sig || !tam || (!*path && !*url)) { publicarOta(job, "error", -1, "comando incompleto"); return; }
  if (String(ver) == FW_VERSION) { publicarOta(job, "error", -1, "o sensor ja esta nessa versao"); return; }
  if (otaEmAndamento || ota.pendente) { publicarOta(job, "error", -1, "outra atualizacao em andamento"); return; }
  ota.job = job; ota.versao = ver; ota.sha = sha; ota.assinatura = sig; ota.tamanho = tam;
  // Sem URL completa, baixa do mesmo servidor do broker (porta do painel)
  ota.url = *url ? String(url) : "http://" + cfg_server + ":" + String(port) + path;
  ota.pendente = true;
  publicarOta(job, "accepted", -1, "de " FW_VERSION " para " + ota.versao);
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
    confirmarOta();
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
      Serial.println("[CMD] identify: LED verde piscando por 15 s");
      identifyAte = millis() + 15000;
    }
    if (act == "ota") { pedidoOta(d); return; }
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
    mqttFalhou = true;
    return;
  }
  Serial.println("OK");
  jaConectouMqtt = true; mqttFalhou = false; t_mqttOk = millis();
  TOPIC_CONFIG = "thguard/" + macAddr + "/config";
  mqtt.subscribe(TOPIC_CONFIG.c_str());
  if (registrado) {
    configurarTopicos();
    mqtt.subscribe(TOPIC_CMD.c_str());
    publicarStatus();
    confirmarOta();
  } else {
    confirmarOta();                                 // broker ok: versao nova confirmada
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
<div class="row"><span>Indicacao dos LEDs</span><span>%LED%</span></div>
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
  p.replace("%LED%", NOME_ESTADO[estadoAtual()]);
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
      for (int i = 0; i < 10; i++) { led(i % 2); ledsRG(i % 2, i % 2); delay(80); }
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
  Serial.println(FW_MARK);

  if (PIN_LED >= 0) { pinMode(PIN_LED, OUTPUT); led(false); }
  if (PIN_LED_VERDE    >= 0) pinMode(PIN_LED_VERDE, OUTPUT);
  if (PIN_LED_VERMELHO >= 0) pinMode(PIN_LED_VERMELHO, OUTPUT);
  tickLeds();                                     // "ligando": os dois acesos
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
  {
    esp_ota_img_states_t est;
    const esp_partition_t* run = esp_ota_get_running_partition();
    if (esp_ota_get_state_partition(run, &est) == ESP_OK && est == ESP_OTA_IMG_PENDING_VERIFY) {
      otaVerificar = true;
      Serial.println("[OTA] Primeira inicializacao da versao nova: aguardando o broker para confirmar.");
    }
    Serial.printf("[OTA] Particao em uso: %s\n", run ? run->label : "?");
  }
  while (millis() < TESTE_LEDS_MS) { delay(50); esp_task_wdt_reset(); }   // teste dos LEDs
  testeLeds = false;
  ultimoMv = lerPinoMv(&ultimoSpread);
  avaliarLeitura(ultimoMv);
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

// Com o rollback ligado no core, o Arduino marcaria a versao como valida logo no
// boot. Retornando true, quem confirma e o confirmarOta() (depois do broker).
extern "C" bool verifyRollbackLater() { return true; }

void loop() {
  esp_task_wdt_reset();
  server.handleClient();
  tickBotao();
  tickWifi();
  tickLeitura();
  tickMQTT();
  executarOta();
  tickVerificacaoOta();
  tickLED();
  tickLeds();
  delay(2);
}
