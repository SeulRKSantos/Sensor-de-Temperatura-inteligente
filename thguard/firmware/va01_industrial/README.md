# VA01 — Firmware industrial TH-GUARD (ESP32)

Firmware do sensor industrial VA01 (PT100 → TxIsoRail 0–10 V → ESP32). Implantação do lado do servidor: [`docs/INDUSTRIAL.md`](../../docs/INDUSTRIAL.md).
Compila sem erros no core **esp32 3.0.7** (testado). O watchdog tem os dois caminhos para o core 2.x, mas essa versão não foi testada.

## Ligação

| De | Para | Observação |
|---|---|---|
| TxIsoRail borne 11 (+) | Módulo 0–25 V, VCC (bloco de parafusos) | saída 0–10 V do transmissor |
| TxIsoRail borne 12 (−) | Módulo 0–25 V, GND (bloco de parafusos) | |
| Módulo, pino **S** | ESP32 **GPIO34** | ADC1, funciona com o Wi-Fi ligado |
| Módulo, pino **−** | ESP32 **GND** | |
| Módulo, pino **+** | não ligar | |
| Capacitor 100 nF | entre GPIO34 e GND | pendente; reduz o ruído |
| ESP32 **GPIO25** | resistor 330 Ω → **LED verde** (+) → GND | perna longa do LED no resistor |
| ESP32 **GPIO26** | resistor 330 Ω → **LED vermelho** (+) → GND | perna longa do LED no resistor |

Para montar sem um dos LEDs, mude `PIN_LED_VERDE` ou `PIN_LED_VERMELHO` para `-1` no início do `.ino`.

## Indicação dos LEDs (a partir da va01-1.1.0)

Aparece uma indicação por vez: com mais de uma condição ao mesmo tempo, vale a que está mais
acima na tabela. As piscadas curtas duram 150 ms e cada grupo se repete a cada 3 s.

| Estado | LED verde | LED vermelho |
|---|---|---|
| **Ligando** (primeiros 2 s, testa os LEDs) | aceso | aceso |
| Identificar (botão do painel, 15 s) | pisca muito rápido | apagado |
| **Modo de configuração** (portal aberto sem rede salva, ou alguém conectado nele) | piscada longa | piscada longa, alternando com o verde |
| **Falha no Wi-Fi** (a rede salva não conecta ou caiu) | apagado | **2 piscadas curtas** |
| **Falha de comunicação com o servidor** (broker MQTT fora, ou 60 s sem receber o ID) | apagado | **3 piscadas curtas** |
| **Falha de leitura** (transmissor acima de 10,5 V, PT100 aberto, ou sinal fora da faixa do ADC) | apagado | **piscada longa** (1 s / 1 s) |
| **Iniciando** (conectando ao Wi-Fi e ao servidor, aguardando o ID) | **piscada longa** (1 s / 1 s) | apagado |
| Indicador Therma desligado (abaixo de 0,75 V; não é falha) | 1 piscada curta a cada 3 s | apagado |
| **Operando normal** | **aceso fixo** | apagado |
| Apagando a configuração (BOOT segurado por 6 s) | pisca rápido | pisca rápido |

A falha de leitura e o Therma desligado só mudam depois de 3 leituras seguidas (3 s), para não piscar
por ruído. Os limites ficam no início do `.ino` (`FALHA_LEITURA_MV`, `THERMA_OFF_MV`...) e servem só
para os LEDs: a temperatura, a falha e o "Therma desligado" que aparecem no painel continuam sendo
calculados no servidor. O estado atual também aparece no portal web (**Indicação dos LEDs**) e no
Serial (`[LED] ...`).

O **LED azul da placa** (GPIO2) continua com a sinalização original:

| LED azul | Significado |
|---|---|
| pisca lento (1 s) | sem Wi-Fi, portal de configuração aberto |
| 2 piscadas curtas a cada 2 s | Wi-Fi ok, sem conexão com o MQTT |
| pisca rápido | aguardando o servidor atribuir o ID |
| apagado, piscada curta a cada envio | operando normalmente |
| pisca muito rápido por 15 s | comando "identificar" enviado pelo painel |

Segurar o botão **BOOT** por 6 s com o ESP ligado apaga a configuração e abre o portal.

## O que mudou na va01-1.1.0

- LEDs verde (GPIO25) e vermelho (GPIO26) com a tabela de indicação acima.
- Portal web mostra a indicação atual dos LEDs.
- Leitura, protocolo MQTT e configuração iguais à va01-1.0.0.

## O que mudou em relação ao `VA01_teste_leitura`

- Mesma leitura validada: 64 amostras, 500 µs, média aparada 25/25, `analogReadMilliVolts`, 11 dB.
- O ESP **envia mV do pino** (média do intervalo). A conversão para °C fica no servidor:
  faixa (0–150 °C), offset −16 mV, fator 5:1, ganho, falha upscale > 10,5 V e
  área morta < 0,75 V (indicador Therma desligado).
  Tudo editável no painel, sem regravar o ESP.
- Wi-Fi principal + reserva, portal `VA01-Setup-XXXX` (http://192.168.4.1) com login.
  Se a rede cair (ex.: o MikroTik volta depois do ESP numa queda de energia), o ESP abre o portal
  **e continua tentando a rede salva a cada 60 s**.
- MQTT com usuário/senha via `secrets.h` (o broker exige autenticação).
- Watchdog de 60 s.
- Servidor padrão `10.10.0.208` (alterável no portal ou pelo painel).

## Protocolo

Igual ao TH-GUARD, com `"kind":"industrial"`:

```
-> thguard/register        {"mac":"B4E62D...","kind":"industrial","model":"VA01","fw":"va01-1.1.0"}
<- thguard/<MAC>/config    {"sensor_id":"ind-001","interval":5}           (retained)
-> thguard/ind-001/data    {"mv":412.3,"spread":2.1,"n":5,"ts":123456}
-> thguard/ind-001/status  {"ip","ssid","rssi","uptime","mac","kind","model","fw","interval"}
<- thguard/ind-001/cmd     {"action":"restart" | "reset_eeprom" | "identify" | "read_now" | "set_config", ...}
```

`reset_eeprom` (botão "Apagar ID no ESP" do painel) apaga o ID salvo e força novo registro;
o firmware também aceita `reset_id`. `set_config` aceita `ssid1`, `pass1`, `ssid2`, `pass2`, `serverIp`, `serverPort` e `interval` (2–300 s).

> **Importante:** o servidor precisa estar com o backend que suporta sensores industriais
> (seção **Industrial** no menu do painel). Um backend anterior registraria o VA01 como
> sensor DHT (`sensor-NNN`) e descartaria as leituras.

## Gravar (notebook)

Bibliotecas: **PubSubClient** e **ArduinoJson** (v7).

```bash
arduino-cli lib install PubSubClient ArduinoJson
cd Sensor-de-Temperatura-inteligente/thguard/firmware/va01_industrial
cp secrets.h.example secrets.h
nano secrets.h
arduino-cli compile --fqbn esp32:esp32:esp32 .
arduino-cli upload -p /dev/ttyACM0 --fqbn esp32:esp32:esp32 .
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200
```

O `secrets.h` está no `.gitignore` e não vai para o repositório.
