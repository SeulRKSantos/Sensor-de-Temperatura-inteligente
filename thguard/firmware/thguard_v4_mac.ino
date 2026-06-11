//  TH-GUARD — Firmware universal com registro por MAC
//  Sem SENSOR_ID fixo — ID atribuído pelo servidor via MAC

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <LittleFS.h>
#include <ESP8266WebServer.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

// CONFIGURAÇÃO DE HARDWARE E PINAGEM

#define DHT_PIN          2
#define DHT_TYPE         DHT22
#define BTN_RESET_PIN    0
#define LED_AMARELO_PIN  14
#define LED_VERMELHO_PIN 13
#define SCREEN_W         128
#define SCREEN_H         64
#define OLED_RESET       -1
#define OLED_ADDR        0x3C
#define SDA_PIN          5
#define SCL_PIN          4

//  MQTT — tópicos fixos 

#define TOPIC_REGISTER  "thguard/register"
#define MQTT_USER       "thguard"
#define MQTT_FINGERPRINT "B3:61:9A:3C:FE:A1:B5:D0:25:E5:BC:EC:D3:0C:F4:3D:08:9B:2B:C9"
#define MQTT_TLS        true
#define MQTT_PORT_PLAIN 1883
#define MQTT_PORT_TLS   8883
#define MQTT_PASS       "***REMOVED***"
#define MQTT_INTERVAL   10000UL
#define REGISTER_TIMEOUT 30000UL   // 30s esperando ID do servidor

// INTERVALOS

#define INTERVALO_SENSOR    2000UL
#define INTERVALO_SLIDE     8000UL
#define INTERVALO_TRANSICAO 12UL
#define INTERVALO_LED       1000UL
#define INTERVALO_NTP       60000UL

//  OBJETOS

Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, OLED_RESET);
DHT dht(DHT_PIN, DHT_TYPE);
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", -10800, 60000);
WiFiClient espClient;
PubSubClient mqtt(espClient);
ESP8266WebServer server(80);


//  ESTADO

float temperaturaAtual = 0.0;
float umidadeAtual     = 0.0;
bool  modoAP           = false;
bool  ledAceso         = false;
bool  registrado       = false;   // true quando tem sensor_id válido

// ID e MAC

String sensorId  = "";   // atribuído pelo servidor
String macAddr   = "";   // MAC do ESP

// Limites recebidos do servidor

float limitTemp  = 25.0;
float limitHumid = 80.0;

// Tópicos dinâmicos (preenchidos após registro)

String TOPIC_DATA   = "";
String TOPIC_STATUS = "";
String TOPIC_CMD    = "";
String TOPIC_CONFIG = "";   // thguard/{MAC}/config — onde recebe o ID

// Config

String cfg_ssid1       = "";
String cfg_pass1       = "";
String cfg_ssid2       = "";
String cfg_pass2       = "";
String cfg_mqtt_server = "192.168.0.102";
int    cfg_mqtt_port   = 1883;

// Timers

unsigned long t_sensor   = 0;
unsigned long t_mqtt     = 0;
unsigned long t_led      = 0;
unsigned long t_ntp      = 0;
unsigned long t_register = 0;   // último envio de register

// Display

const int SEQUENCIA[] = {0, 1, 0, 2};
const int N_SLIDES    = 4;
int  idxSeq       = 0;
int  slideAtual   = 0;
int  slideProximo = 1;
bool emTransicao  = false;
int  xOffset      = 0;
unsigned long t_slide = 0;
unsigned long t_anim  = 0;

//  CONFIG — LittleFS

void carregarConfig() {
  if (!LittleFS.exists("/cfg.txt")) { Serial.println("[CFG] Sem config."); return; }
  File f = LittleFS.open("/cfg.txt", "r");
  if (!f) return;
  cfg_ssid1       = f.readStringUntil('\n'); cfg_ssid1.trim();
  cfg_pass1       = f.readStringUntil('\n'); cfg_pass1.trim();
  cfg_ssid2       = f.readStringUntil('\n'); cfg_ssid2.trim();
  cfg_pass2       = f.readStringUntil('\n'); cfg_pass2.trim();
  cfg_mqtt_server = f.readStringUntil('\n'); cfg_mqtt_server.trim();
  String p        = f.readStringUntil('\n'); p.trim();
  if (p.length() > 0) cfg_mqtt_port = p.toInt();
  String sid = f.readStringUntil('\n'); sid.trim();
  if (sid.length() > 0) { sensorId = sid; registrado = true; }
  f.close();
  Serial.println("[CFG] Carregado. SSID1=" + cfg_ssid1 + " ID=" + sensorId);
}

void salvarConfig() {
  File f = LittleFS.open("/cfg.txt", "w");
  if (!f) return;
  f.println(cfg_ssid1);
  f.println(cfg_pass1);
  f.println(cfg_ssid2);
  f.println(cfg_pass2);
  f.println(cfg_mqtt_server);
  f.println(cfg_mqtt_port);
  f.println(sensorId);   // persiste o ID recebido
  f.close();
  Serial.println("[CFG] Salvo. ID=" + sensorId);
}

//  TÓPICOS DINÂMICOS

void configurarTopicos() {
  TOPIC_DATA   = "thguard/" + sensorId + "/data";
  TOPIC_STATUS = "thguard/" + sensorId + "/status";
  TOPIC_CMD    = "thguard/" + sensorId + "/cmd";
  Serial.println("[MQTT] Tópicos configurados para ID: " + sensorId);
}

//  WIFI

void iniciarAP() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("TH-GUARD-Setup", "12345678");
  modoAP = true;
  Serial.println("[AP] IP: " + WiFi.softAPIP().toString());
}

void conectarWifi() {
  if (cfg_ssid1 == "") { iniciarAP(); return; }
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg_ssid1.c_str(), cfg_pass1.c_str());
  Serial.print("[WIFI] Conectando a " + cfg_ssid1);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) { delay(200); yield(); Serial.print("."); }
  if (WiFi.status() != WL_CONNECTED && cfg_ssid2 != "") {
    Serial.println("\n[WIFI] Tentando backup: " + cfg_ssid2);
    WiFi.begin(cfg_ssid2.c_str(), cfg_pass2.c_str());
    inicio = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) { delay(200); yield(); Serial.print("."); }
  }
  if (WiFi.status() != WL_CONNECTED) { Serial.println("\n[WIFI] Falha."); iniciarAP(); }
  else { modoAP = false; Serial.println("\n[WIFI] Conectado! IP: " + WiFi.localIP().toString()); }
}

//  MQTT CALLBACK

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  String t = String(topic);
  Serial.println("[MQTT] Recebido em " + t + ": " + msg);

  // Recebe ID do servidor via tópico do MAC
  if (t == TOPIC_CONFIG) {
    // Payload: {"sensor_id":"sensor-001"}
    int idx = msg.indexOf("\"sensor_id\":\"");
    if (idx >= 0) {
      int s = idx + 13;
      int e = msg.indexOf("\"", s);
      if (e > s) {
        sensorId   = msg.substring(s, e);
        registrado = true;
        configurarTopicos();
        // Extrai limites opcionais
        int it = msg.indexOf("\"tempLimit\":");
        if (it >= 0) { float v = msg.substring(it + 12).toFloat(); if (v > 0 && v < 100) limitTemp = v; }
        int ih = msg.indexOf("\"humidLimit\":");
        if (ih >= 0) { float v = msg.substring(ih + 13).toFloat(); if (v > 0 && v <= 100) limitHumid = v; }
        Serial.printf("[MQTT] Limites: T=%.1f H=%.1f\n", limitTemp, limitHumid);
        salvarConfig();
        mqtt.subscribe(TOPIC_CMD.c_str());
        Serial.println("[MQTT] ID recebido e salvo: " + sensorId);
        publicarStatus();
      }
    }
    return;
  }

  // Comandos remotos
  if (t == TOPIC_CMD) {
    if (msg.indexOf("\"restart\"") >= 0) { Serial.println("[MQTT] Reiniciando..."); delay(300); ESP.restart(); }
    if (msg.indexOf("\"reset_id\"") >= 0) {
      // Força novo registro apagando o ID salvo
      sensorId = ""; registrado = false;
      salvarConfig();
      Serial.println("[MQTT] ID resetado. Reiniciando...");
      delay(500); ESP.restart();
    }
    if (msg.indexOf("\"set_config\"") >= 0) {
      auto extract = [&](String key) -> String {
        int i = msg.indexOf("\"" + key + "\":\"");
        if (i < 0) return "";
        int s = i + key.length() + 4;
        int e = msg.indexOf("\"", s);
        return e > s ? msg.substring(s, e) : "";
      };
      auto extractNum = [&](String key) -> float {
        int i = msg.indexOf("\"" + key + "\":");
        if (i < 0) return -1;
        return msg.substring(i + key.length() + 3).toFloat();
      };
      String s1 = extract("ssid1");    if (s1 != "") cfg_ssid1 = s1;
      String p1 = extract("pass1");    if (p1 != "") cfg_pass1 = p1;
      String s2 = extract("ssid2");    if (s2 != "") cfg_ssid2 = s2;
      String p2 = extract("pass2");    if (p2 != "") cfg_pass2 = p2;
      String sv = extract("serverIp"); if (sv != "") cfg_mqtt_server = sv;
      float tl = extractNum("tempLimit");
      if (tl > 0 && tl < 100) {
        limitTemp = tl;
        Serial.printf("[CMD] tempLimit atualizado: %.1f\n", limitTemp);
      }
      float hl = extractNum("humidLimit");
      if (hl > 0 && hl <= 100) {
        limitHumid = hl;
        Serial.printf("[CMD] humidLimit atualizado: %.1f\n", limitHumid);
      }
      salvarConfig();
    }
  }
}

//  MQTT PUBLISH

void publicarStatus() {
  if (!mqtt.connected() || !registrado) return;
  char buf[200];
  snprintf(buf, sizeof(buf),
    "{\"ip\":\"%s\",\"ssid\":\"%s\",\"rssi\":%d,\"uptime\":%lu,\"mac\":\"%s\"}",
    WiFi.localIP().toString().c_str(), WiFi.SSID().c_str(),
    WiFi.RSSI(), millis()/1000, macAddr.c_str());
  mqtt.publish(TOPIC_STATUS.c_str(), buf);
}

void publicarDados() {
  if (!mqtt.connected() || !registrado) return;
  if (isnan(temperaturaAtual) || isnan(umidadeAtual)) return;
  char buf[80];
  snprintf(buf, sizeof(buf), "{\"temperature\":%.2f,\"humidity\":%.2f,\"ts\":%lu}",
    temperaturaAtual, umidadeAtual, millis());
  mqtt.publish(TOPIC_DATA.c_str(), buf);
  Serial.println("[MQTT] " + String(buf));
}

void enviarRegister() {
  if (!mqtt.connected()) return;
  char buf[60];
  snprintf(buf, sizeof(buf), "{\"mac\":\"%s\"}", macAddr.c_str());
  mqtt.publish(TOPIC_REGISTER, buf);
  Serial.println("[MQTT] Register enviado: " + String(buf));
  t_register = millis();
}
//  MQTT CONNECT
void conectarMQTT() {
  if (modoAP || WiFi.status() != WL_CONNECTED) return;

  if (MQTT_TLS) {
    // Sincroniza horário via NTP — obrigatório para validação TLS
    configTime(-3 * 3600, 0, "pool.ntp.org", "time.nist.gov");
    Serial.print("[TLS] Aguardando NTP");
    time_t now = time(nullptr);
    int tries = 0;
    while (now < 1000000000UL && tries < 30) {
      delay(300); Serial.print(".");
      now = time(nullptr); tries++;
    }
    Serial.printf(now > 1000000000UL ? " OK\n" : " FALHOU\n");
    Serial.printf("[MEM] Heap livre: %d bytes\n", ESP.getFreeHeap());
    // Recria cliente TLS a cada tentativa para evitar vazamento de memória
    static WiFiClientSecure tlsClient;
    tlsClient.setFingerprint(MQTT_FINGERPRINT);
    Serial.println("[TLS] Fingerprint configurado");
    mqtt.setClient(tlsClient);
    mqtt.setServer(cfg_mqtt_server.c_str(), MQTT_PORT_TLS);
  } else {
    mqtt.setClient(espClient);
    mqtt.setServer(cfg_mqtt_server.c_str(), MQTT_PORT_PLAIN);
  }

  mqtt.setCallback(mqttCallback);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(15);

  String clientId = "thguard-" + macAddr;
  Serial.printf("[MQTT] Conectando %s porta %d%s...\n",
    clientId.c_str(),
    MQTT_TLS ? MQTT_PORT_TLS : MQTT_PORT_PLAIN,
    MQTT_TLS ? " (TLS)" : "");

  if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
    Serial.println(" OK!");
    // Sempre se inscreve no tópico do MAC para receber o ID
    TOPIC_CONFIG = "thguard/" + macAddr + "/config";
    mqtt.subscribe(TOPIC_CONFIG.c_str());
    Serial.println("[MQTT] Inscrito em " + TOPIC_CONFIG);

    if (registrado) {
      configurarTopicos();
      mqtt.subscribe(TOPIC_CMD.c_str());
      publicarStatus();
    } else {
      // Novo sensor — pede registro
      enviarRegister();
    }
  } else {
    Serial.printf(" Falha rc=%d\n", mqtt.state());
  }
}

//  TICKS

void tickSensor() {
  unsigned long agora = millis();
  if (agora - t_sensor < INTERVALO_SENSOR) return;
  t_sensor = agora;
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) { temperaturaAtual = t; umidadeAtual = h; }
  else Serial.println("[DHT] Falha na leitura.");
}

void tickMQTT() {
  unsigned long agora = millis();

  if (!mqtt.connected()) {
    static unsigned long t_retry = 0;
    if (agora - t_retry > 10000) { t_retry = agora; conectarMQTT(); }
    return;
  }

  mqtt.loop();

  // Se não registrado, reenvia register a cada REGISTER_TIMEOUT
  if (!registrado) {
    if (agora - t_register >= REGISTER_TIMEOUT) enviarRegister();
    return;
  }

  // Publica dados periodicamente
  if (agora - t_mqtt >= MQTT_INTERVAL) { t_mqtt = agora; publicarDados(); publicarStatus(); }
}

void tickLED() {
  unsigned long agora = millis();

  // Modo AP ou sem WiFi: amarelo e vermelho alternam (sem rede)
  if (modoAP || WiFi.status() != WL_CONNECTED) {
    if (agora - t_led < 500) return;
    t_led = agora;
    ledAceso = !ledAceso;
    digitalWrite(LED_AMARELO_PIN,  ledAceso ? HIGH : LOW);
    digitalWrite(LED_VERMELHO_PIN, ledAceso ? LOW  : HIGH);
    return;
  }

  // Aguardando registro
  if (!registrado) {
    if (agora - t_led < 200) return;
    t_led = agora;
    ledAceso = !ledAceso;
    digitalWrite(LED_AMARELO_PIN,  ledAceso ? HIGH : LOW);
    digitalWrite(LED_VERMELHO_PIN, ledAceso ? HIGH : LOW);
    return;
  }

  // Normal: verifica se há alerta de temperatura ou umidade
  bool tempValida  = !isnan(temperaturaAtual) && temperaturaAtual > 0 && temperaturaAtual < 999;
  bool humidValida = !isnan(umidadeAtual)     && umidadeAtual     > 0 && umidadeAtual     <= 100;
  bool emAlerta    = (tempValida  && temperaturaAtual >= limitTemp)
                  || (humidValida && umidadeAtual     >= limitHumid);
  // DEBUG — imprime a cada 5s
  static unsigned long t_dbg = 0;
  if (millis() - t_dbg >= 5000) {
    t_dbg = millis();
    Serial.printf("[LED] T=%.1f lim=%.1f H=%.1f lim=%.1f alerta=%d\n",
      temperaturaAtual, limitTemp, umidadeAtual, limitHumid, emAlerta);
  }

  if (emAlerta) {
    if (agora - t_led < 250) return;
    t_led = agora;
    ledAceso = !ledAceso;
    digitalWrite(LED_AMARELO_PIN,  ledAceso ? HIGH : LOW);
    digitalWrite(LED_VERMELHO_PIN, LOW);
  } else {
    if (agora - t_led < 1000) return;
    t_led = agora;
    ledAceso = !ledAceso;
    digitalWrite(LED_AMARELO_PIN,  ledAceso ? HIGH : LOW);
    digitalWrite(LED_VERMELHO_PIN, LOW);
  }
}

void tickNTP() {
  if (modoAP) return;
  unsigned long agora = millis();
  if (agora - t_ntp < INTERVALO_NTP) return;
  t_ntp = agora;
  timeClient.update();
}

//  DISPLAY

void desenharBandeira(int x) {
  display.drawRect(x+1,1,126,62,SSD1306_WHITE);
  display.fillTriangle(x+6,32,x+64,5,x+122,32,SSD1306_WHITE);
  display.fillTriangle(x+6,32,x+64,59,x+122,32,SSD1306_WHITE);
  display.fillCircle(x+64,32,15,SSD1306_BLACK);
  display.drawCircle(x+64,32,15,SSD1306_WHITE);
  display.drawLine(x+50,30,x+78,34,SSD1306_WHITE);
  display.drawLine(x+50,31,x+78,35,SSD1306_WHITE);
}

void desenharSlide(int tipo, int x) {
  if (tipo == 0) {
    display.setTextSize(2); display.setCursor(x+1,16);
    if (isnan(temperaturaAtual)) display.print("---");
    else { display.print(temperaturaAtual,1); display.print("C"); }
    display.setTextSize(1); display.setCursor(x+1,38);
    display.print("H:"); display.print(isnan(umidadeAtual) ? "---" : String(umidadeAtual,1)+"%");
    display.setCursor(x+1,50);
    if (modoAP) display.print("AP: TH-GUARD-Setup");
    else { display.print("IP:"); display.print(WiFi.localIP()); }
  } else if (tipo == 1) {
    display.setTextSize(1); display.setCursor(x+1,16);
    if (!registrado) {
      display.println("Aguardando ID...");
      display.setCursor(x+1,28); display.println("MAC:");
      display.setCursor(x+1,38); display.println(macAddr.substring(0,8));
      display.setCursor(x+1,48); display.println(macAddr.substring(8));
    } else {
      display.println("ID: " + sensorId);
      display.setCursor(x+1,28); display.print("MQTT:");
      display.println(mqtt.connected() ? "OK" : "OFFLINE");
      display.setCursor(x+1,40); display.print("MAC:");
      display.setCursor(x+1,50); display.println(macAddr.substring(0,12));
    }
  } else if (tipo == 2) {
    desenharBandeira(x);
  }
}

void tickDisplay() {
  if (modoAP) {
    static unsigned long t_ap = 0;
    if (millis() - t_ap < 1000) return;
    t_ap = millis();
    display.clearDisplay(); display.setTextSize(1);
    display.setCursor(0,0);  display.println("  MODO CONFIGURACAO");
    display.drawLine(0,10,128,10,SSD1306_WHITE);
    display.setCursor(0,16); display.println("WiFi: TH-GUARD-Setup");
    display.setCursor(0,28); display.println("Senha: 12345678");
    display.setCursor(0,40); display.print("IP: "); display.println(WiFi.softAPIP());
    display.setCursor(0,52); display.println("Acesse via browser");
    display.display(); return;
  }

  unsigned long agora = millis();
  if (!emTransicao && agora - t_slide >= INTERVALO_SLIDE) {
    idxSeq      = (idxSeq+1) % N_SLIDES;
    slideProximo = SEQUENCIA[idxSeq];
    emTransicao  = true; xOffset = 0; t_anim = agora;
  }
  if (emTransicao && agora - t_anim >= INTERVALO_TRANSICAO) {
    t_anim = agora; xOffset -= 4;
    if (xOffset <= -128) { emTransicao = false; slideAtual = slideProximo; xOffset = 0; t_slide = agora; }
  }
  static unsigned long t_redraw = 0;
  if (!emTransicao && agora - t_redraw < 1000) return;
  t_redraw = agora;

  display.clearDisplay(); display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
  display.setCursor(3,1);
  char hdr[22];
  snprintf(hdr, sizeof(hdr), "%02d:%02d:%02d  %s",
    timeClient.getHours(), timeClient.getMinutes(), timeClient.getSeconds(),
    registrado ? "REG" : "...");
  display.print(hdr);
  display.drawLine(0,11,128,11,SSD1306_WHITE);

  if (!emTransicao) desenharSlide(slideAtual, 0);
  else { desenharSlide(slideAtual, xOffset); desenharSlide(slideProximo, xOffset+128); }
  display.display();
}

//  WEB SERVER

const char HTML_CONFIG[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head>
<meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>TH-GUARD Config</title>
<style>
body{font-family:Arial,sans-serif;background:#080a0f;color:#eee;margin:0;padding:20px;}
.box{max-width:420px;margin:auto;background:#0d1117;border-radius:10px;padding:24px;}
h2{color:#1a4fd6;text-align:center;margin:0 0 6px;}
.sub{text-align:center;color:#666;font-size:12px;margin-bottom:20px;}
label{display:block;font-size:12px;color:#aaa;margin:14px 0 4px;text-transform:uppercase;letter-spacing:1px;}
input[type=text],input[type=password],input[type=number]{width:100%;padding:9px 10px;box-sizing:border-box;background:#0f3460;border:1px solid #2a3f6f;border-radius:6px;color:#eee;font-size:14px;}
.btn{display:block;width:100%;padding:11px;margin-top:22px;background:#1a4fd6;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;}
.live{text-align:center;margin-bottom:18px;padding:12px;background:#0f3460;border-radius:8px;}
.tv{font-size:36px;font-weight:700;color:#f5c518;font-family:monospace;}
.hv{font-size:18px;color:#4d7fff;margin-top:4px;}
.status{display:flex;gap:10px;margin-top:10px;justify-content:center;font-size:11px;}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px;}
.ok{background:#1a4fd6;} .err{background:#e03c3c;}
.id-box{background:#0f3460;border:1px solid #2a3f6f;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:13px;color:#4d7fff;margin-top:8px;}
hr{border:none;border-top:1px solid #1a2236;margin:18px 0;}
</style></head><body><div class='box'>
<h2>TH-GUARD</h2>
<div class='sub'>Configuração do Sensor</div>
<div class='live'>
  <div class='tv'>%TEMP%&deg;C</div>
  <div class='hv'>Umidade: %HUMID%%</div>
  <div class='status'>
    <span><span class='dot %WIFI_CLS%'></span>WiFi: %WIFI_ST%</span>
    <span><span class='dot %MQTT_CLS%'></span>MQTT: %MQTT_ST%</span>
  </div>
  <div style='margin-top:10px;font-size:11px;color:#aaa;'>
    MAC: <span style='color:#4d7fff;font-family:monospace;'>%MAC%</span>
  </div>
  <div class='id-box'>ID: %SENSOR_ID%</div>
</div>
<form action='/salvar' method='POST'>
<hr>
<label>WiFi Primário (SSID)</label><input type='text' name='s1' value='%S1%'>
<label>Senha Primária</label><input type='password' name='p1' value='%P1%'>
<label>WiFi Backup (SSID)</label><input type='text' name='s2' value='%S2%'>
<label>Senha Backup</label><input type='password' name='p2' value='%P2%'>
<hr>
<label>IP do Servidor MQTT</label><input type='text' name='ms' value='%MS%'>
<label>Porta MQTT</label><input type='number' name='mp' value='%MP%'>
<button type='submit' class='btn'>SALVAR E REINICIAR</button>
</form>
</div>
<script>
setInterval(()=>{fetch('/api').then(r=>r.json()).then(d=>{
  document.querySelector('.tv').innerHTML=d.t.toFixed(1)+'&deg;C';
  document.querySelector('.hv').innerText='Umidade: '+d.h.toFixed(1)+'%';
}).catch(()=>{});},3000);
</script></body></html>
)rawliteral";

void handleRoot() {
  String page = String(HTML_CONFIG);
  page.replace("%TEMP%",      isnan(temperaturaAtual) ? "--.-" : String(temperaturaAtual,1));
  page.replace("%HUMID%",     isnan(umidadeAtual)     ? "--.-" : String(umidadeAtual,1));
  page.replace("%WIFI_CLS%",  WiFi.status()==WL_CONNECTED ? "ok" : "err");
  page.replace("%WIFI_ST%",   WiFi.status()==WL_CONNECTED ? WiFi.SSID() : "OFFLINE");
  page.replace("%MQTT_CLS%",  mqtt.connected() ? "ok" : "err");
  page.replace("%MQTT_ST%",   mqtt.connected() ? "OK" : "OFFLINE");
  page.replace("%MAC%",       macAddr);
  page.replace("%SENSOR_ID%", registrado ? sensorId : "Aguardando servidor...");
  page.replace("%S1%",        cfg_ssid1);
  page.replace("%P1%",        cfg_pass1);
  page.replace("%S2%",        cfg_ssid2);
  page.replace("%P2%",        cfg_pass2);
  page.replace("%MS%",        cfg_mqtt_server);
  page.replace("%MP%",        String(cfg_mqtt_port));
  server.send(200, "text/html", page);
}

void handleApi() {
  char buf[60];
  snprintf(buf, sizeof(buf), "{\"t\":%.1f,\"h\":%.1f}", temperaturaAtual, umidadeAtual);
  server.send(200, "application/json", buf);
}

void handleSalvar() {
  cfg_ssid1       = server.arg("s1");
  cfg_pass1       = server.arg("p1");
  cfg_ssid2       = server.arg("s2");
  cfg_pass2       = server.arg("p2");
  cfg_mqtt_server = server.arg("ms");
  int p = server.arg("mp").toInt();
  if (p > 0) cfg_mqtt_port = p;
  salvarConfig();
  server.send(200, "text/html",
    "<body style='font-family:Arial;background:#080a0f;color:#1a4fd6;"
    "display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'>"
    "<h2>Salvo! Reiniciando...</h2></body>");
  delay(1500); ESP.restart();
}

void verificarBotao() {
  static unsigned long t_btn = 0;
  static bool pressionado = false;
  if (digitalRead(BTN_RESET_PIN) == LOW) {
    if (!pressionado) { pressionado = true; t_btn = millis(); }
    else if (millis() - t_btn > 4000) {
      LittleFS.remove("/cfg.txt");
      delay(500); ESP.restart();
    }
  } else { pressionado = false; }
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n[TH-GUARD] Boot v4.0 — Registro por MAC");

  pinMode(BTN_RESET_PIN,    INPUT_PULLUP);
  pinMode(LED_AMARELO_PIN,  OUTPUT);
  pinMode(LED_VERMELHO_PIN, OUTPUT);
  digitalWrite(LED_AMARELO_PIN,  LOW);
  digitalWrite(LED_VERMELHO_PIN, LOW);

  Wire.begin(SDA_PIN, SCL_PIN);
  display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  display.setTextColor(SSD1306_WHITE);
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(20,20); display.println("TH-GUARD v4.0");
  display.setCursor(20,34); display.println("Iniciando...");
  display.display();

  LittleFS.begin();

  // Obtém o MAC do ESP
  macAddr = WiFi.macAddress();
  macAddr.replace(":", "");
  macAddr.toUpperCase();
  Serial.println("[MAC] " + macAddr);

  carregarConfig();
  dht.begin();
  conectarWifi();

  if (!modoAP) {
    timeClient.begin();
    timeClient.update();
  }

  server.on("/",       handleRoot);
  server.on("/api",    handleApi);
  server.on("/salvar", HTTP_POST, handleSalvar);
  server.begin();

  conectarMQTT();

  delay(2000);
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) temperaturaAtual = t;
  if (!isnan(h)) umidadeAtual     = h;

  t_slide = millis();
  Serial.println("[TH-GUARD] Pronto. MAC=" + macAddr + " ID=" + (registrado ? sensorId : "pendente"));
}

void loop() {
  server.handleClient();
  verificarBotao();
  tickSensor();
  tickMQTT();
  tickLED();
  tickNTP();
  tickDisplay();
  yield();
}
