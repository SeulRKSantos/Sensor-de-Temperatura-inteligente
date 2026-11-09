# Sensores industriais (VA01)

Medição de temperatura de máquina com PT100, integrada ao TH-GUARD com seção própria no painel.

```
PT100 → TxIsoRail (0–10 V) → módulo divisor 0–25 V (5:1) → ESP32 GPIO34 → MQTT → backend → painel
```

O ESP **não converte para graus**: ele mede a tensão no pino (média aparada de 64 amostras,
uma leitura por segundo) e envia a média do intervalo. A conversão é feita no servidor com a
calibração de cada sensor, editada no painel. Trocar a faixa do transmissor (ex.: de 0–40 °C
para 0–150 °C) não exige regravar o ESP.

Firmware e ligação: [`firmware/va01_industrial/`](../firmware/va01_industrial/README.md).

## Conversão

```
mv_corr = mv + offset_mv
V_tx    = mv_corr / 1000 × divisor × ganho
T       = faixa_min + (V_tx / fundo_escala) × (temperatura_de_relação − faixa_min) + offset_temp
```

| Parâmetro (painel) | Coluna | Padrão | Observação |
|---|---|---|---|
| Temperatura em 0 V | `range_min` | 0 °C | início da faixa do TxConfig |
| **Temperatura de relação** | `range_max` | 150 °C | temperatura que o transmissor entrega em 10 V |
| Fundo de escala | `v_full` | 10 V | TxIsoRail |
| Fator do módulo | `divisor` | 5 | módulo 0–25 V |
| Offset do ADC | `offset_mv` | −16 mV | validado em bancada |
| Ganho | `gain` | 1 | ajuste fino |
| Offset de temperatura | `offset_temp` | 0 °C | o painel calcula a partir de um termômetro de referência |
| Falha upscale acima de | `fault_v` | 10,5 V | PT100 aberto; a temperatura é descartada |
| Área morta: Therma desligado abaixo de | `off_v` | 0,75 V | ver "Área morta" abaixo (0 desativa) |
| Intervalo de envio | `interval_s` | 5 s | reenviado ao ESP pela config retida |

A mesma fórmula está em `backend/src/services/industrial.js` (valor oficial) e em
`frontend/src/lib/industrial.js` (só para a pré-visualização na tela de calibração).
Testes: `backend/test/industrial.test.js`.

## Protocolo MQTT

Mesmo fluxo de registro por MAC dos sensores DHT, com `"kind":"industrial"`:

```
-> thguard/register        {"mac":"B4E62D...","kind":"industrial","model":"VA01","fw":"va01-1.0.0"}
<- thguard/<MAC>/config    {"sensor_id":"ind-001","interval":5}            (retained)
-> thguard/ind-001/data    {"mv":412.3,"spread":2.1,"n":5,"ts":123456}
-> thguard/ind-001/status  {"ip","ssid","rssi","uptime","mac","kind","model","fw","interval"}
<- thguard/ind-001/cmd     {"action":"restart" | "reset_eeprom" | "identify" | "read_now" | "set_config", ...}
```

## Banco e InfluxDB

- `sensors` ganhou `kind` (`thguard` / `industrial`), `model` e `fw`.
- Tabela `industrial_config` (1:1 com o sensor, `ON DELETE CASCADE`).
- As duas mudanças são criadas **no boot do backend** (`db.schema()`, `ALTER ... IF NOT EXISTS`),
  então bancos existentes são atualizados sem rodar SQL. O `init.sql` já cria tudo numa instalação nova.
- A coluna antiga `low_v` (0,05 V) ficou na tabela sem uso; foi substituída por `off_v`.
- InfluxDB: measurement `industrial` com `temperature`, `voltage`, `mv`, `spread`, `fault`
  (0 normal, 1 upscale, 2 indicador desligado) e `off` (1 = indicador Therma desligado).
  Em upscale ou com o indicador desligado o campo `temperature` não é gravado.
  Os DHT continuam no measurement `environment`.

## Área morta (indicador Therma desligado)

Desligar o indicador microprocessado Therma faz parte da operação. Sem o indicador, a entrada
do ESP fica sem sinal e o ADC lê a tensão residual do próprio pino, que seria convertida numa
temperatura falsa. Por isso, com a saída do indicador **abaixo de `off_v` (0,75 V)**:

- a temperatura é descartada (não vai para o InfluxDB nem para os alarmes);
- o painel mostra **DESLIGADO / Indicador Therma desligado** no card e no detalhe;
- o gráfico deixa uma lacuna sombreada "Therma desligado" nesses períodos;
- os CSV (download do painel e anexos dos e-mails) ganham a coluna **Indicador Therma**
  (`Ligado`, `Indicador Therma desligado` ou `... X% do periodo` para janelas parciais);
- o relatório mostra a porcentagem do tempo com o indicador desligado;
- **não** é falha: não dispara "Falha no Sensor" nem mantém alarme ativo.

Para não oscilar no limiar, o sensor só volta a "ligado" acima de `off_v + 0,05 V`.
O limiar é ajustável por sensor em **Configurar → Calibração**.

## Alertas

Temperatura alta/normal (mesma lógica dos DHT: reenvio a cada 30 min enquanto persistir e
normalização só após 3 min abaixo do limite),
**falha no sensor** (upscale) e falha normalizada (confirmadas em 3 leituras seguidas), offline/online e
relatórios diário/semanal/mensal com CSV (temperatura, tensão do transmissor e estado do indicador Therma).

Variáveis extras nos e-mails: `{{voltage}}`, `{{fault}}`, `{{range_min}}`, `{{range_max}}`, `{{tag}}`.

## Atualizar o servidor

O servidor não é um clone git: os arquivos são copiados do notebook.

1. **No servidor**, backup do código e do banco **antes** de copiar:

```bash
cd ~/thguard-plataform/thguard-platform
tar czf ~/thguard-antes-$(date +%Y%m%d).tgz backend/src frontend/src mariadb/init.sql
bash mariadb/backup.sh
```

2. **No notebook**, copie os fontes do repositório:

```bash
cd ~/Projects/Sensor-de-Temperatura-inteligente-com-sistema-Web/thguard
scp -r backend/src  ubtserver@10.10.0.208:~/thguard-plataform/thguard-platform/backend/
scp -r frontend/src ubtserver@10.10.0.208:~/thguard-plataform/thguard-platform/frontend/
scp mariadb/init.sql ubtserver@10.10.0.208:~/thguard-plataform/thguard-platform/mariadb/
```

3. **No servidor**, rebuild e reinício do Nginx (sem o reinício ele continua apontando para
   os containers antigos e o painel responde **502**):

```bash
cd ~/thguard-plataform/thguard-platform
docker compose up -d --build backend frontend
docker restart thguard-nginx
docker logs thguard-backend --tail 30
```

O log deve mostrar `[DB] Schema verificado (sensores industriais).`

Para voltar atrás: extraia o `.tgz` do backup, rode o `docker compose up -d --build` e reinicie o Nginx de novo.
As colunas e a tabela novas podem ficar no banco; o código antigo as ignora.

## Observações

- Excluir um sensor limpa a config retida no broker, mas se o ESP continuar ligado ele volta a
  publicar com o ID salvo e o sensor é recriado. Desligue o ESP antes de excluir.
- Novos sensores industriais entram com alarme em 120 °C; ajuste em **Configurar**.
