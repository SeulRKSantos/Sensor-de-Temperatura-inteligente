# Painel de administração

Menu **Administração → Painel de administração** (só usuários `admin`). Toda ação fica no log do
sistema com o usuário que fez. Exclusões pedem a palavra `EXCLUIR` digitada.

## Abas

- **Visão geral:** disco livre do servidor, tamanho do InfluxDB (com a retenção do bucket), do MariaDB
  (por tabela) e dos arquivos guardados; sensores online, na lixeira, erros e avisos das últimas 24 h,
  e-mails dos últimos 7 dias e leituras por dia dos últimos 30 dias.
- **Sensores:** para cada sensor, última leitura, leituras e cobertura nas últimas 24 h (recebidas ÷
  esperadas pelo intervalo de envio), desde quando há histórico e e-mails dos últimos 30 dias.
  - **Lixeira:** o "Excluir" do painel do sensor e o botão "Lixeira" daqui só escondem o sensor. As
    leituras e novos registros dele passam a ser descartados (o log avisa no máximo uma vez por hora)
    e a config retida no broker é limpa. **Restaurar** devolve tudo e reenvia o ID ao dispositivo.
  - **Excluir definitivamente** (só a partir da lixeira, ou sozinho depois de 30 dias): apaga o
    cadastro, a calibração, os alertas e o histórico de e-mails; se marcado, também todas as leituras
    do sensor no InfluxDB. O ID nunca é reaproveitado (tabela `retired_sensor_ids`), para um sensor
    novo não herdar o histórico de um antigo.
- **Leituras:** apaga do InfluxDB um período, de um sensor ou de todos. "Calcular" mostra antes
  quantas leituras serão apagadas. Datas no horário de Brasília; o fim é inclusivo.
- **Arquivos:**
  - *Relatórios gerados*: cópia de todo relatório que o TH-GUARD gera (anexos dos e-mails diário,
    semanal e mensal, CSV e Excel baixados), em `backend/data/relatorios/AAAA-MM/`.
  - *Backups do MariaDB*: a pasta `BACKUP_HOST_DIR` montada em `/backups`. Só arquivos de backup
    (`.sql`, `.gz`, `.zip`, `.tgz`…) podem ser apagados por aqui.
  - Baixar, apagar selecionados ou apagar os mais antigos que N dias.
- **Firmware:** atualização dos sensores pela rede (hoje só o industrial VA01, a partir da va01-1.2.0).
  - *Firmwares no servidor*: envio do `.bin`. O backend confere se é a imagem do programa do ESP32 e lê
    a marca `THGUARD-FW|model=…|ver=…|` gravada pelo firmware; recusa outro modelo, versão sem OTA e
    a mesma versão com conteúdo diferente. Arquivos em `backend/data/firmware/`.
  - *Atualizar sensores*: escolhe a versão e os sensores. Um sensor por vez; se um falhar, os
    seguintes do mesmo envio são cancelados. Sensores offline, de outro modelo, já na versão ou com
    firmware sem OTA aparecem com o motivo e não podem ser marcados.
  - *Atualização em andamento*: progresso de cada sensor e botão para tirar da fila quem ainda não começou.
  - *Histórico*: quem atualizou, de qual versão para qual, e o resultado (concluído, falhou, cancelado).
  - *Chave pública para o secrets.h*: linhas prontas para o `OTA_PUBKEY` do firmware. A chave privada
    (`backend/data/firmware/ota-assinatura.key`) é criada no primeiro uso e nunca sai do servidor:
    **faça uma cópia dela**. Se ela se perder, os sensores só voltam a aceitar firmware por USB.
  - O upload passa pelo Nginx: o `location /api/` precisa de `client_max_body_size 2m;`.
- **Logs:**
  - *Sistema*: tudo o que o backend escreve no console (MQTT, e-mails, agendador, erros) mais logins
    (inclusive os recusados) e ações de administração, na tabela `system_log`. Filtro por nível,
    categoria e texto.
  - *E-mails enviados*: a tabela `email_history`, com filtro por sensor e tipo.
  - *Containers*: últimas linhas do `docker logs` dos containers `thguard-*` (somente leitura).
- **Retenção:** limpeza automática diária às 03:30 do log do sistema (padrão 90 dias), do histórico
  de e-mails (365 dias), dos relatórios guardados (0 = nunca) e da lixeira (30 dias).

## Instalação (docker-compose.override.yml)

O `docker-compose.override.yml` é lido automaticamente junto com o `docker-compose.yml` e adiciona:

- `dockerproxy` (`tecnativa/docker-socket-proxy`): o backend lê a lista de containers e os logs por
  ele, sem receber o socket do Docker. Só `GET`/`HEAD` em `/containers`; `POST` (start, stop, exec)
  é recusado. Fica na rede interna `adminproxy`, sem porta publicada.
- a pasta de backups em `/backups` no backend (`BACKUP_HOST_DIR` no `.env`; padrão `./mariadb/backups`);
- limite de 10 MB × 5 arquivos para os logs de todos os containers.

Variáveis do backend: `DOCKER_API` (vazio desliga a aba Containers), `DOCKER_LOG_PREFIXES`
(padrão `thguard-`), `BACKUP_DIR`, `REPORTS_DIR` (padrão `data/relatorios`), `DATA_DIR` e
`ADMIN_DISKS`: discos mostrados na Visão geral, no formato `Nome=/caminho;Nome=/caminho` (caminhos
dentro do container). Para medir um disco que o backend não usa, monte uma pasta vazia dele só
para leitura; o painel lê apenas o tamanho do disco.

A retenção das leituras é do próprio InfluxDB (o bucket foi criado com 30 dias). Para mudar:

```bash
docker exec thguard-influxdb influx bucket list
docker exec thguard-influxdb influx bucket update --id <ID> --retention 365d
```
