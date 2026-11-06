# VA01 — Firmware industrial TH-GUARD (ESP32)

Firmware do sensor industrial VA01 (PT100 → TxIsoRail 0–10 V → ESP32). Implantação do lado do servidor: [`docs/INDUSTRIAL.md`](../../docs/INDUSTRIAL.md).
Compila sem erros no core **esp32 3.0.7** (testado). O watchdog tem os dois caminhos para o core 2.x, mas essa versão não foi testada.

## Ligação (sem mudanças em relação ao teste validado)

| De | Para | Observação |
|---|---|---|
| TxIsoRail borne 11 (+) | Módulo 0–25 V, VCC (bloco de parafusos) | saída 0–10 V do transmissor |
| TxIsoRail borne 12 (−) | Módulo 0–25 V, GND (bloco de parafusos) | |
| Módulo, pino **S** | ESP32 **GPIO34** | ADC1, funciona com o Wi-Fi ligado |
| Módulo, pino **−** | ESP32 **GND** | |
| Módulo, pino **+** | não ligar | |
| Capacitor 100 nF | entre GPIO34 e GND | pendente; reduz o ruído |

Sem display e sem LEDs externos. O **LED azul da placa** (GPIO2) mostra o estado:

| LED | Significado |
|---|---|
| pisca lento (1 s) | sem Wi-Fi, portal de configuração aberto |
| 2 piscadas curtas a cada 2 s | Wi-Fi ok, sem conexão com o MQTT |
| pisca rápido | aguardando o servidor atribuir o ID |
| apagado, piscada curta a cada envio | operando normalmente |
| pisca muito rápido por 15 s | comando "identificar" enviado pelo painel |

Segurar o botão **BOOT** por 6 s com o ESP ligado apaga a configuração e abre o portal.

## O que mudou em relação ao `VA01_teste_leitura`

- Mesma leitura validada: 64 amostras, 500 µs, média aparada 25/25, `analogReadMilliVolts`, 11 dB.
- O ESP **envia mV do pino** (média do intervalo). A conversão para °C fica no servidor:
  faixa (0–150 °C), offset −16 mV, fator 5:1, ganho, falha upscale > 10,5 V.
  Tudo editável no painel, sem regravar o ESP.
- Wi-Fi principal + reserva, portal `VA01-Setup-XXXX` (http://192.168.4.1) com login.
  Se a rede cair (ex.: o MikroTik volta depois do ESP numa queda de energia), o ESP abre o portal
  **e continua tentando a rede salva a cada 60 s**.
- MQTT com usuário/senha (o broker de produção exige; o doc do VA01 dizia "sem autenticação").
- Watchdog de 60 s.
- Servidor padrão `10.10.0.208` (IP cabeado; o `.209` é o Wi-Fi do servidor).

## Protocolo

Igual ao TH-GUARD, com `"kind":"industrial"`:

```
-> thguard/register        {"mac":"B4E62D...","kind":"industrial","model":"VA01","fw":"va01-1.0.0"}
<- thguard/<MAC>/config    {"sensor_id":"ind-001","interval":5}           (retained)
-> thguard/ind-001/data    {"mv":412.3,"spread":2.1,"n":5,"ts":123456}
-> thguard/ind-001/status  {"ip","ssid","rssi","uptime","mac","kind","model","fw","interval"}
<- thguard/ind-001/cmd     {"action":"restart" | "reset_id" | "identify" | "read_now" | "set_config", ...}
```

`set_config` aceita `ssid1`, `pass1`, `ssid2`, `pass2`, `serverIp`, `serverPort` e `interval` (2–300 s).

> **Importante:** grave este firmware só depois que o backend com suporte a sensores industriais
> estiver no ar. O backend atual cria qualquer registro como `sensor-NNN` e espera
> `temperature`/`humidity` nos dados.

## Gravar (notebook)

Bibliotecas: **PubSubClient** e **ArduinoJson** (v7).

```bash
arduino-cli lib install PubSubClient ArduinoJson
cd ~/Projects/Sensor-de-Temperatura-inteligente-com-sistema-Web/thguard/firmware/va01_industrial
cp secrets.h.example secrets.h
nano secrets.h
arduino-cli compile --fqbn esp32:esp32:esp32 .
arduino-cli upload -p /dev/ttyACM0 --fqbn esp32:esp32:esp32 .
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200
```

Confira se `secrets.h` está no `.gitignore` antes do commit.
