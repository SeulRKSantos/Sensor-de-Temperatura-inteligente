/*
 * ============================================================
 *  TESTE SIMPLES — PT100 + MAX31865 + ESP32
 *  Apenas leitura no Serial Monitor
 * ============================================================
 *  OBJETIVO:
 *   Validar que o sensor PT100 está corretamente ligado
 *   ao módulo MAX31865 e que o ESP32 está se comunicando.
 *
 *  COMO USAR:
 *   1. Instale a biblioteca: "Adafruit MAX31865" no Arduino IDE
 *      (Ferramentas → Gerenciar Bibliotecas → buscar MAX31865)
 *   2. Selecione a placa: "ESP32 Dev Module"
 *   3. Selecione a porta COM correta
 *   4. Faça upload deste código
 *   5. Abra o Serial Monitor em 115200 baud
 *   6. Você verá a temperatura a cada 1 segundo
 * ============================================================
 *  PINAGEM ESP32 ↔ MAX31865:
 *   MAX31865    →    ESP32
 *   ─────────        ─────
 *   VIN         →    3.3V
 *   GND         →    GND
 *   CLK         →    GPIO 18  (SCK)
 *   SDO         →    GPIO 19  (MISO)
 *   SDI         →    GPIO 23  (MOSI)
 *   CS          →    GPIO 5
 * ============================================================
 */

#include <Adafruit_MAX31865.h>

// ============================================================
// CONFIGURAÇÃO DOS PINOS SPI
// ============================================================
// Adafruit_MAX31865(CS, MOSI, MISO, SCK) — SPI por software
Adafruit_MAX31865 sensor = Adafruit_MAX31865(5, 23, 19, 18);

// ============================================================
// CONFIGURAÇÃO DO SENSOR
// ============================================================
// Resistor de referência no módulo:
//   - 430.0  para PT100 (padrão Adafruit)
//   - 4300.0 para PT1000
#define RREF      430.0

// Resistência nominal do sensor a 0°C:
//   - 100.0  para PT100
//   - 1000.0 para PT1000
#define RNOMINAL  100.0

// ============================================================
// SETUP — executa uma vez ao ligar
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("============================================");
  Serial.println("  TESTE PT100 + MAX31865 + ESP32");
  Serial.println("============================================");

  // Inicializa o sensor em modo 3 fios
  // Use MAX31865_2WIRE / MAX31865_3WIRE / MAX31865_4WIRE
  sensor.begin(MAX31865_3WIRE);

  Serial.println("[OK] MAX31865 inicializado em modo 3 fios.");
  Serial.println("[OK] Iniciando leituras...");
  Serial.println();
  Serial.println("Tempo(s) | Resistência(Ω) | Temperatura(°C) | Status");
  Serial.println("---------|----------------|-----------------|--------");
}

// ============================================================
// LOOP — executa repetidamente
// ============================================================
void loop() {
  // Lê o RTD bruto (valor de 0 a 32767)
  uint16_t rtd = sensor.readRTD();

  // Converte para resistência em ohms
  float resistencia = rtd;
  resistencia /= 32768;
  resistencia *= RREF;

  // Converte para temperatura em Celsius
  float temperatura = sensor.temperature(RNOMINAL, RREF);

  // Verifica falhas
  uint8_t falha = sensor.readFault();

  // Imprime tempo
  Serial.printf("%8lu | ", millis() / 1000);

  // Imprime resistência e temperatura
  Serial.printf("%13.2f | ", resistencia);
  Serial.printf("%14.2f | ", temperatura);

  // Imprime status
  if (falha) {
    Serial.print("FALHA (0x");
    Serial.print(falha, HEX);
    Serial.print(") - ");

    if (falha & MAX31865_FAULT_HIGHTHRESH) {
      Serial.println("RTD acima do limite alto");
    } else if (falha & MAX31865_FAULT_LOWTHRESH) {
      Serial.println("RTD abaixo do limite baixo");
    } else if (falha & MAX31865_FAULT_REFINLOW) {
      Serial.println("REFIN- > 0.85 x VBIAS");
    } else if (falha & MAX31865_FAULT_REFINHIGH) {
      Serial.println("REFIN- < 0.85 x VBIAS (verifique fios!)");
    } else if (falha & MAX31865_FAULT_RTDINLOW) {
      Serial.println("RTDIN- < 0.85 x VBIAS (verifique fios!)");
    } else if (falha & MAX31865_FAULT_OVUV) {
      Serial.println("Sobretensão / Subtensão");
    } else {
      Serial.println("Falha desconhecida");
    }

    sensor.clearFault();
  } else {
    Serial.println("OK");
  }

  delay(1000); // lê a cada 1 segundo
}
