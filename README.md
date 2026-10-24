# ponte-local · fork GalaxyCut-AI

> **Conecte a IA que você já usa (Claude, ChatGPT, Gemini…) ao editor de vídeo
> GalaxyCut-AI — ela opera o editor do seu computador pelo chat, com plano
> visível, gates de aprovação e reversão.**

Este repo é o **relay + skill** do Modo Ponte do [GalaxyCut-AI](https://github.com/lucasgabrieldevgg/galaxycut-ai).

## Créditos (a origem de tudo)

Fork adaptado do **[ponte-local](https://github.com/micsxnn/ponte-local)** de
**MicaelSanPedro** (MIT © 2026). O desenho do transporte — relay de fila com
lease de 120 s, fresh-skip no religamento, cursor incremental, painel de
status, e a própria ideia da skill colável — **é dele** e foi preservado.
A LICENSE original acompanha este repo intacta. O que esta adaptação mudou
está documentado em [`docs/ADAPTACAO.md`](docs/ADAPTACAO.md).

## Como funciona (30 segundos)

```
sua IA (chat)                relay (este repo)               GalaxyCut (seu PC)
     │  POST /cmd  ──────────────►│                               │
     │                             │  GET /poll  ──────────────────│  o app polla
     │                             │◄────────────  comandos        │  a cada 1,5 s
     │                             │◄─  POST /result ──────────────│  executa no editor
     │◄── GET /results ────────────│                               │  e devolve
```

Tudo são conexões de **saída** — sem portas abertas, firewall ou VPN.
Nenhum arquivo de mídia sai do seu computador: só JSON de metadados
(nomes de clipes, timestamps, sumários).

## Usando com o app GalaxyCut

1. **Deploy deste relay** (abaixo) — ou use um relay que alguém já deployou.
2. No app: **Modelos & APIs → Ponte (IA externa)** ou painel **Modo Ponte**.
3. Cole a URL do relay → **Conectar e gerar o bloco**.
4. **Copiar bloco** → cole no chat da sua IA. O bloco já vem com a skill
   completa, a URL do relay e o token — nada pra digitar.

A skill que a IA recebe está em [`SKILL.md`](SKILL.md): a gramática é o
**editor de vídeo** (timeline, clipes, legendas, efeitos, export) — uma lista
fixa de ações derivada do registry do app, **sem** ações de arquivo/comando
do sistema (fronteira permanente do GalaxyCut).

## Deploy (qualquer um serve)

### Vercel (1 clique)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flucasgabrieldevgg%2Fponte-local&root-directory=relay&project-name=ponte-relay&repository-name=ponte-local)

### Manual (qualquer Node 20+)

```bash
cd relay
npm install
npm run build && npm start        # produção, porta 3000
# ou: npm run dev                 # desenvolvimento
```

### Self-host é cidadão de primeira classe

O relay é multi-canal e sem estado externo (memória do processo): quantos
apps quiserem parear no SEU relay. Canais sem poll por 6 h expiram sozinhos.
Sem variáveis de ambiente obrigatórias — os tokens de cada pareamento nascem
no app e são registrados via `POST /api/ponte/pair`.

## Verificando (prova re-executável)

```bash
cd relay && npm install && npm run verify
```

Sobe um relay de verdade e fecha o contrato de ponta a ponta: pareamento,
fresh-skip, separação de tokens (§7), lease, revogação por re-pareamento —
13 asserções contra o HTTP real.

## O que NÃO está neste fork

O `agente/` e `operador/` do original (que operam o **PC** — arquivos,
comandos) **não fazem parte desta adaptação**: no GalaxyCut, o papel do
agente é o próprio app (o poller vive no processo Electron). Para operar um
PC genérico pela ponte, use o [original](https://github.com/micsxnn/ponte-local).

## Licença

MIT — © 2026 MicaelSanPedro (original), com adaptação © 2026 Lucas Gabriel
(GalaxyCut-AI). Veja [`LICENSE`](LICENSE).
