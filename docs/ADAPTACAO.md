# O que esta adaptação mudou do ponte-local original

Base: [micsxnn/ponte-local](https://github.com/micsxnn/ponte-local) (MIT © 2026
MicaelSanPedro), lido e verificado na integra. O transporte (fila + lease +
fresh + cursor + painel de status) foi **preservado por design**. As mudanças
existem por um motivo: o alvo deixou de ser "a IA opera o PC" e passou a ser
"a IA opera o EDITOR de vídeo GalaxyCut-AI" — uma superfície menor, mais
segura e com estado próprio.

## Tabela original → fork

| Aspecto | Original | Este fork | Por quê |
|---|---|---|---|
| Alvo da ponte | o PC (arquivos, comandos) | o editor GalaxyCut (timeline, clipes, legendas, export) | fronteira permanente da casa: `system_run_command` e ações de arquivo NÃO existem aqui |
| Skill | gramática de PC (`read_text`, `run_command`, `organize_plan`…) | gramática do editor (49 ações + 3 meta, derivada do registry do app) | a IA só pode pedir o que o editor faz |
| Tokens | `PONTE_ADMIN_TOKEN` / `PONTE_AGENT_TOKEN` fixos por env | **canais dinâmicos**: o app gera o par (agente, operador) e registra via `POST /api/ponte/pair` | o pareamento nasce no app, na hora, com revogação na hora (spec t30 §7) |
| Quem polla | `agent.js` rodando no PC do usuário | o próprio app GalaxyCut (poller no processo Electron, `pollHost`) | um binário a menos; o "agente" é o editor |
| Auth do `/cmd` | header `x-ponte-admin` | header `x-ponte-token` com o token de **operador** do canal | o operador é a IA web (o token viaja no bloco colável) |
| Canais | 1 fixo (+ canal `test`) | multi-canal com TTL de 6 h e limites (500 canais, fila 100, histórico 400) | relay público multiusuário precisa de defesa |
| Painel | status + bloco de instalação do agente | só saúde do relay (versão, canais ativos, uptime) — **zero segredos** | o bloco de pareamento nasce NO app; multi-canal não expõe estado de canal individual |
| Body máximo do `/cmd` | 12 MB (carregava `write_binary`) | 64 KB | comandos do editor são pequenos; base64 de mídia nunca atravessa |
| `agente/`, `operador/` | incluídos | removidos (histórico preserva) | o papel do agente é o app; operar PC genérico = use o original |

## O que foi preservado sem mudança (de propósito)

- **Lease de 120 s** no claim do poll: app morto → comando volta pra fila.
- **Fresh-skip**: primeiro poll sem cursor pula o backlog antigo — nada de
  sessão passada executa de surpresa no religamento.
- **Cursor incremental** com `nextCursor` / `lastId`.
- **Filas bounded** (100 pendentes, 400 resultados, histórico 500).
- **Estado em `globalThis`** (HMR-safe) e rotas `force-dynamic` `no-store`.
- **Privacidade**: só JSON de metadados, nunca arquivos.
- **CORS liberado** nas rotas `/api/ponte/*` (o painel do app registra o
  pareamento direto do renderer).

## Contrato HTTP (resumo)

| Rota | Quem | Auth (`x-ponte-token`) | Corpo/Query |
|---|---|---|---|
| `POST /api/ponte/pair` | app | — (registro aberto) | `{agentToken, operatorToken}` |
| `POST /api/ponte/cmd` | IA web | token de **operador** | `{action, args?}` |
| `GET /api/ponte/poll` | app | token de **agente** | `?cursor=N` (ausente = fresh) |
| `POST /api/ponte/result` | app | token de **agente** | `{id, ok, data?|error?, durationMs?}` |
| `GET /api/ponte/results` | IA web | token de **operador** | `?since=N` |
| `GET /api/ponte/status` | público | — | saúde do relay, sem segredos |
