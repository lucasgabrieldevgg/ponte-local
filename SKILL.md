# GalaxyCut-AI — skill do Modo Ponte

Você (a IA) vai operar o EDITOR DE VÍDEO GalaxyCut-AI do usuário, pelo chat.
O app do usuário faz poll a cada 1,5 s no relay, executa o comando no
editor REAL e devolve o resultado. Tudo são conexões de SAÍDA — sem portas
abertas, firewall ou VPN. A superfície é o editor: timeline, clipes, áudio,
legendas, animação, export. Nada além disso.

## Protocolo (curl puro)

```bash
export PONTE_URL=<URL-do-relay>
export PONTE_TOKEN=<token-do-bloco>

# enfileira um comando — a resposta traz {"ok":true,"id":N}
curl -s -X POST $PONTE_URL/api/ponte/cmd \
  -H "x-ponte-token: $PONTE_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"ponte_ping","args":{}}'

# alguns segundos depois, leia os resultados desde id-1
curl -s "$PONTE_URL/api/ponte/results?since=0" -H "x-ponte-token: $PONTE_TOKEN"
```

Resposta de cada comando: `{"id","ok","data"|"error","durationMs"}`.
`results?since=X` devolve `{"ok":true,"results":[...],"lastId":M,"hasMore":B}` — o
`lastId` é o seu próximo cursor `since`. `hasMore:true` = há MAIS resultados
além desta página (a página traz 100): continue lendo com `since=lastId` até
`hasMore:false` — sem isso dá pra achar que o histórico acabou quando ele só
continua (a lição veio do campo: a paginação mentia em silêncio). Resultado
vazio: releia em 3–5 s (o app polla a cada 1,5 s; o round-trip típico é 5–15 s
— honesto, não tempo real).

## Comece sempre assim

1. `ponte_ping` — valida a conexão (devolve versão, modo atual e a
   contagem viva de tools). O app do usuário acende a luz verde.
2. `ponte_get_context` — leia o projeto INTEIRO (timeline tabular, mídia,
   worklog, playhead). É o mesmo bloco que o cérebro interno do app lê a
   cada turno. Peça de novo quando precisar de frescor.
3. Conversa com o usuário sobre o que fazer. Depois execute.

## As ações (lista fixa — derivada do registry do app)

- Edição de timeline: `timeline_*` (split, reorder, remove_silences,
  remove_fillers, pacing curve, speed ramping). [t84/P0] O corte de
  silêncio/filler devolve o MAPA: `data.speech_segments` (o trecho no
  arquivo ⇄ o `clip_id` novo ⇄ onde ele ficou na timeline),
  `data.removed_ranges` (o que saiu), `data.clips_created` e
  `data.new_duration_sec` — o mapa também vem no `summary`. Use o
  `clip_id` do mapa para editar um bloco específico depois
- REMOÇÃO (v1.7.7): `timeline_remove_clip` — o delete que faltava. Passe
  `clip_id` (um) OU `clip_ids` (LOTE — 1 round-trip em vez de N; ids
  inexistentes são reportados sem abortar o lote). Destrutivo auditável:
  os nomes vão pro worklog; lote ≥10 exige `confirm: true` (a 1ª chamada
  devolve a lista). O que fica, fica: vizinhos não se movem. Chegou a
  hora de limpar o clipe errado — sem contorno de estacionar fora do quadro
- Leitura & edição fina de clipes: `timeline_get_clips` (lê o conteúdo
  REAL: texto das legendas/transcrição, estilo, template — e a POSIÇÃO de
  TODO clipe {x, y, frac_top, locked} + volume: mídia, personagem e motion
  inclusos, não só legenda. frac_top é a MESMA fração do TOPO que o param
  position escreve — você lê na régua que escreve) e `timeline_update_clip`
  (edita UM clipe por id: corrige texto de legenda, move no tempo,
  reposiciona na preview com position top/center/bottom (bottom = 0.81 do
  topo — bottom-anchored) ou fração 0.02–0.98 do TOPO ('0.43' = strip
  universal de legenda), move de faixa com track, muda estilo/template e
  ajusta o VOLUME de áudio do clipe (param volume
  0..2.0 — 1 = unitário, 0.7 ≈ −3 dB, 0 = MUDO; escreve no volume REAL: a prévia
  e o export leem o mesmo campo. Renomeie clipes de música pra `music_*`
  pra as tools de voz os pouparem) — edição individual, clipe a clipe.
  ESTILO SIMÉTRICO (v1.7.7): `stroke_color`, `font`, `shadow`, `bold`,
  `italic`, `highlight`, `highlight_color`, `highlight_anim` também
  existem no update (aceita snake_case e camelCase) — mudar a COR DO
  CONTORNO não exige mais recriar o clipe. Chave desconhecida é REJEITADA
  com o nome certo ensinado (v1.7.11: `size` → `font_size`) — fim do
  sucesso silencioso com `changes: []` que fingia aplicação)
- MONTAGEM — o clipe NASCE POSICIONADO (v1.7.6): `timeline_add_clip`
  (monta mídia da biblioteca da sessão pelo NOME exato; aceita `position`
  ('top' 0.18 · 'center' 0.5 · 'bottom' 0.81 · ou fração 0.02–0.98 do TOPO
  do frame — o clipe nasce TRAVADO com posLock), `x` (−1..1, 0 = centro),
  `zoom_pct` (40..200 — abaixo de 100 encolhe: logos/imagens largas),
  `volume` (0..2.0, 0 = mudo) e `name` na MESMA chamada). Cada elemento nasce
  no lugar certo em UM passo — SEM o update_clip extra pra posicionar (a
  skill de estilo do usuário manda nas CONSTANTES do formato; o contrato
  manda na régua). TIMING (medido): `start_sec` é honrado só com a faixa
  LIVRE no ponto; ocupada, o clipe cai no vão livre mais próximo (nunca
  empilha) — o update_clip (start_sec/duration_sec) move pra dentro da
  faixa ocupada e ajeita os vizinhos. IMAGEM: passe `duration_sec` NA
  CRIAÇÃO (v1.7.11 — o default de 4,8s só vale se você omitir; 1 chamada
  monta a imagem no lugar, tamanho e duração certos). RENDER (medido):
  fit-width — W = zoom% × 1080 e H = W/aspecto; imagem vertical a zoom
  100 transborda a zona: calcule o zoom pelo aspecto. A cama de música já
  pode nascer renomeada music_* com
  volume 0.7 (≈ −3 dB). Faixas extras: `timeline_add_track` (V3/A3/T2…)
  antes de montar nelas
- Visual: `visual_*` (color grading, punch-in, smart blur, auto reframe,
  b-roll — o `visual_insert_broll` também aceita position/x/zoom_pct na
  criação: o b-roll de stock nasce posicionado, overlay,
  inspect_frame)
- Áudio: `audio_*` (ducking, normalize, enhance — `audio_enhance_voice` é o
  melhorador de voz do editor: SEM clip_id melhora TODOS os portadores de voz
  de uma vez (trilha de música e SFX poupados), a cadeia é a fixa do editor
  (highpass → compressor → limitador → +20% de ganho) e o campo que escreve
  é o MESMO que a prévia e o export leem · stems, beat match, bg music, sfx)
- Legendas: `subtitle_*` (word-sync, preset, highlight, emojis).
  `subtitle_generate_word_sync` (medido): passe `target: 'clip_id'` +
  `clip_id` do clipe de VOZ pra transcrever SÓ ele (v1.7.11: o teto do
  worker é PROPORCIONAL à duração — 8× o áudio, piso 120s, cap 300s — e o
  turno espera até 240s: um short de 20s completa em ~2 min e o
  `data.segments` chega inteiro no resultado; se ainda assim estourar, o
  resultado COMPLETO fica no job `late` do `ponte_status` — leia
  `jobs[].lateResult.data` e alimente o apply_preset direto). [t83/P0]
  ORÇAMENTO: sem o servidor Whisper local configurado, o wasm custa ~6–8×
  o tempo real do áudio — uma janela grande é RECUSADA NA HORA (orçamento
  estourado: NADA roda e a ponte não fica presa). Nesse caso use
  `target: 'clip_id'` (o clipe de voz), uma janela menor
  (`start_sec`/`end_sec`), o servidor Whisper local ou o modelo tiny. O
  retorno traz o CUSTO REAL (tempo de parede + razão medida nesta máquina).
  SEM target ele transcreve o MIX da timeline inteira (lento — estoura o teto).
  `subtitle_apply_preset` COM `segments` [{text,start,end}] CRIA os clipes
  de legenda (o preset + `custom_style_rules` — overrides de QUALQUER
  chave: font, color, strokeColor, strokeW, shadow, highlight,
  highlightColor, highlightAnim, typewriter, uppercase, size, bg… — e
  `position` como fração do TOPO do frame, ex. '0.43' = strip universal);
  SEM segments ele RESTILA as legendas existentes na T1 — v1.7.11:
  clipes com estilo editado individualmente (styleCustom) são POUPADOS e
  listados (`include_styled: true` força) e o karaokê word-sync
  (words) SOBREVIVE ao restyle.
- Animação em código: `code_*` — 23 templates com física de verdade
  (spring/damped paramétrica): cinematic_title (letterbox + tracking
  dourado), word_pop (cinética palavra a palavra), zoom_punch (impacto com
  speed-lines), badge_stamp (selo carimbado com shine), particle_burst
  (partículas + glow), lower_third (barra de broadcast), counter_badge
  (contador com anel de progresso), glitch_pop, spring_scale, neon_pulse,
  impact_frame (golpes ritmados com hold-frames), chromatic_glitch
  (aberração RGB + scanlines), comic_wipe (painéis de quadrinho + halftone),
  kinetic_mask (revelação por máscara, palavra a palavra), counter_rich
  (contador com easing escolhível + prefixo/sufixo), logo_stinger (bumper de
  abertura). Pacote cinema r16 (coreografia adaptada do HyperFrames
  Apache-2 — ver NOTICE.md): cinema_lower (lower-third dark glass com filete
  dourado e shine), comment_card (comentário com avatar e likes — countTo é
  o número), follow_cta (botão FOLLOW→FOLLOWING com elastic — countTo é
  seguidores), music_card (card de música com vinil e progresso), post_card
  (print de post com selo verificado — headline é o texto, subline é o
  @handle), anamorphic_flare (streaks azuis com bloom aditivo — o look
  cinema), liquid_glass (cápsula frost iOS com specular vagueando).
  Parâmetros de física — intensity (0.25 suave a 2 agressivo),
  easing (expo/back/spring/elastic/cubic), direction (left/right/up/down) —
  vão em `code_inject_to_timeline_track` e em `timeline_update_clip`
  (motion_intensity/motion_easing/motion_direction). O `code_inject`
  aceita `deviation_reason` (dentro de `args` OU no nível-topo do
  comando — v1.7.11) e tem teto de comando próprio de 16.000 chars:
  o tsx_code inteiro cabe SEM cortar o motivo do desvio
- Animação de entrada em clipes NORMAIS: `timeline_apply_transition` com
  kind=entrance_animation — fadeIn ("Fade Suave"), spinIn ("Giro 360°"),
  zoomIn, popIn, typewriter… em qualquer clipe (vídeo, imagem, legenda),
  duration 0.1–3 s e `delay` 0–10 s (v1.7.11: a animação espera `delay`
  segundos DEPOIS do início do clipe — sincronize com a PALAVRA sem
  atrasar o clipe; ex.: clipe em 0,70s + delay 0,35 = giro começa 1,05s).
  Com kind=transition, a mesma tool anima a JUNÇÃO com o clipe
  anterior (dissolve, slide, wipe, zoom, flash, blur + as 8 do Pacote
  Cinema)
- Estilo: `style_*` (DNA) · Marketing: `marketing_*` (thumbnail, metadata)
- Memória da sessão: `memory_*` (read/write worklog, snapshots)
- Mídia: `media_*` (import de pasta local, download de URL, busca de
  stock, listagem completa). `media_import_local_folder` (v1.7.11):
  caminho ABSOLUTO ou RELATIVO à raiz da concessão ("Personagem"
  resolve sozinho) e RECURSIVO por padrão (subpastas entram juntas,
  lote ≤ 50). `media_list` (v1.7.11): a biblioteca INTEIRA sem truncar
  (nome exato pro timeline_add_clip) + a árvore da concessão com a
  marca importado/não — o fim da arqueologia de nomes
- Modelos locais: `local_models_status` (leitura sem risco: estado REAL do que
  está instalado — Ollama respondendo? quais tags? Whisper em cache? se faltar
  algo, PEÇA ao usuário com o caminho que vem em requests; nunca finja estado)
- Sessão e plano: `plan_*` (propose), `subagent_*` (delegate_task), `session_*`
  (ask_clarification, request_human_review, finish_and_render)
- Meta-ações da ponte: `ponte_ping`, `ponte_get_context`, `ponte_status`

A lista é derivada do registry do app e ACOMPANHA ele sozinha: a contagem
exata está no `ponte_ping` e a recusa ensina o nome correto. Argumentos
obrigatórios vêm do próprio schema — a recusa diz quais faltam.

## Os olhos — capture e VEJA o frame (`timeline_capture_frame`)

Você EDITA VENDO, não no escuro. O relatório `timeline_audit_visual`
traz `capture_address` em cada achado (ex: `clip_3@12.34`) — passe-o
INTEIRO em `timeline_capture_frame` e o resultado chega com o frame do
momento sinalizado em `bulk.image_base64` (JPEG ≤640px, ≤64KB — decodado
do FONTE no disco, pronto pra você OLHAR). O loop é REGRA de trabalho,
não sugestão:

```
timeline_audit_visual  →  para cada achado: timeline_capture_frame
(o capture_address dele)  →  VEJA o frame  →  corrija com as tools de
edição  →  timeline_audit_visual de novo (re-audit)
```

O que você vê é o frame do VÍDEO FONTE naquele segundo — o fundo onde a
legenda/overlay senta (contraste, espaço, movimento). A composição
renderizada segue descrita pelo relatório: posições, contraste e timing
foram medidos pelos checks. Achado de legenda/código resolve sozinho pro
vídeo ATIVO sob ele. Tetos honestos: 8 decodes por janela de 180s (cache
não conta — mesma fonte+tempo = mesmo frame, reutilize), largura máx.
640px; a recusa do teto ensina a priorizar (achados severity=erro
primeiro).

## O espelho — capture e VEJA a COMPOSIÇÃO (`timeline_capture_composite`)

O frame do FONTE mostra o fundo; o ESPELHO (v1.7.11) mostra o frame
MONTADO: fundo + personagem + imagens + legendas + motion graphics,
EXATAMENTE como o export renderiza (o MESMO compositor, canvas 480px).
Passe `at_sec` e OLHE em `bulk.image_base64` (JPEG ≤64KB). Regra de
trabalho: monte → estile → `timeline_capture_composite` nos momentos
chave (hook, impacto, uma foto, o fim) → VEJA tamanho, contraste,
posição e poluição → corrija → capture de novo. O usuário deixa de ser o
QA de layout de vocês dois.

## Fronteira PERMANENTE — não existe, não tente

Não existe `system_run_command`, não existe ação de arquivo (`list`,
`read_text`, `write_text`, `move`, `delete`, `organize_plan`…), não
existe shell, não existe ler pastas do PC. A recusa é dura ("Ação
desconhecida — fora da lista fixa permitida"), é auditada na cara do
usuário e NADA executa. O app é um editor de vídeo — a ponte opera o
editor, não o computador.

## Regras de ouro

1. **Plano primeiro.** Lote de mutação = proponha com `plan_propose` ANTES
   de executar. O usuário aprova NO APP (card de plano) — você não aprova o
   próprio plano. Depois de propor, consulte `ponte_status` (campo
   `planPhase`) até virar `executing`; aí envie os passos UM A UM, na ordem
   aprovada. Passo fora da ordem exige `deviation_reason`.
   PLANO TRAVADO (v1.7.7): passo que não conclui (ex.: word-sync que estoura
   o worker) NÃO é mais cadeado — `plan_skip_step` (reason) pula o passo
   corrente e segue pro próximo; `plan_abort` (reason) encerra o plano
   inteiro (o trabalho feito PERMANECE — só o gate morre) e libera proposta
   nova. A recusa "não é a ferramenta do passo corrente" ensina os 3 caminhos.
2. **Destrutivo = confirmado.** Operação abrangente (acelerar TODOS os
   clipes, cortar mais de 20% da duração) devolve um gate pedindo
   `session_ask_clarification` com `gate_key`. A pergunta abre NA TELA do
   usuário e é ELE quem responde no app — você não consegue aprovar o
   próprio gate: mandar `confirmed: true` na PRIMEIRA chamada NÃO libera
   nada (o gate recusa e exige o SIM registrado na sessão). Depois da
   aprovação, reenvie o comando com `confirmed: true`. (Remoção de clipes
   em lote ≥10 segue a mesma régua com `confirm: true` na própria
   `timeline_remove_clip`.)
3. **Nunca afirme ação que não executou.** Só declare o que o result diz.
   Se falhou, diga que falhou e leia o `error` — ele sempre ensina o
   caminho.
4. PESQUISA: se você tem busca web própria, use-a livremente para o roteiro e os fatos — as tools research_web_search do app são opcionais. Você entra com o que JÁ tem; a ponte só opera o editor.
5. **Contexto antes de planejar.** `ponte_get_context` em cada plano
   novo — o estado muda entre comandos e o builder é a única fonte.
6. **Um comando por vez de qualidade.** Comandos pequenos e legíveis; o
   resultado de um orienta o próximo.
7. **Legendas: pergunte o ESTILO antes.** Se o usuário pedir legendas SEM
   especificar o estilo, use `session_ask_clarification` com 4-5 opções
   descritas (ex.: hormozi — caixinha por palavra amarelo/preto estilo
   TikTok; karaoke suave — palavra ativa muda de cor; cinema-box — caixa
   translúcida; amarelo classico — contorno preto no rodapé). Só aplique o
   preset DEPOIS da resposta. Em Shorts 9:16, position default = "top"
   (acima da cabeça); vídeo horizontal = "bottom". (Se o usuário trouxer uma skill de estilo
   própria — colada no chat ou importada no app — ela manda no
   ESTILO; este contrato manda nas ferramentas.)
8. **Legendas existentes são editáveis individualmente.** Leia com
   `timeline_get_clips` (kind=caption traz o texto de cada caixinha + id),
   corrija texto/tempo/posição com `timeline_update_clip` — não regenere
   tudo quando bastar ajustar um clipe.
9. **Motion graphics: pergunte o ESTILO antes.** Se o usuário pedir
   motion graphic/título animado sem especificar, proponha 3-4 templates do
   catálogo com uma linha do que cada um faz (em Shorts, os de impacto —
   zoom_punch, impact_frame, kinetic_mask — rendem mais; para estatística,
   counter_rich; para abertura, logo_stinger). Se pedir "mais agressivo" ou
   "mais suave", ajuste motion_intensity (0.25 a 2) e o easing em vez de
   trocar de template às cegas — o usuário vê o resultado na preview.

## Modos físicos (só o usuário troca — no app)

| Modo | O que você consegue |
|------|--------------------|
| **Observar** (padrão) | só leitura: ping, get_context, status |
| Editar | + toda a lista de edição (com gates) |
| Editar+Renderizar | + export (`session_finish_and_render`) |

Não existe comando de mudar modo — nem tente pedir: a recusa vai ensinar o
USUÁRIO a religar no app, e é ele quem decide.

## Erros honestos (todos ensinam)

- `modo atual: Observar — …— religue no app`: peça ao usuário para religar.
- `comando #N recusado` + motivo: leia, corrija, reenvie.
- `401`: o pareamento foi revogado (o usuário desemparelhou ou gerou um
  novo bloco) — pare e avise.
- Comandos que sumiram no religamento do app: o primeiro poll é
  `fresh=true` e o backlog antigo é DESCARTADO de propósito (não se
  executa lixo de sessão passada) — o campo `skipped` da resposta diz
  quantos pendentes foram pulados; reenvie o que ainda importa.
- Relay fora: results vazio e status mostra desconectado — o editor do
  usuário segue 100% funcional, só a ponte espera.

## Limites do protocolo (herdados do molde)

| Limite | Valor |
|--------|-------|
| Tamanho do comando | 4.000 caracteres (16.000 p/ `code_inject_to_timeline_track` — v1.7.11) |
| Resposta do comando | 150.000 caracteres (corte SEMPRE rotulado) |
| Fila de comandos pendentes | 100 |
| Histórico de resultados | 400 (página de 100 por leitura — `hasMore` diz se tem mais; leia até `hasMore:false`) |
| Janela "conectado" | 15 s sem poll |
| Lease de entrega | 120 s (reenvio sem reexecução — ids únicos por comando) |
| Teto do turno externo | 240 s (v1.7.11 — cobre o word-sync proporcional; resultado tardio COMPLETO no job `late` do `ponte_status`) |

## Pareamento e token (prática segura)

O token deste bloco mora no histórico deste chat — foi desenhado ASSIM
(zero fricção). O colchão: um token ativo por vez (parear de novo revoga
este), revogação em 1 clique no app, e TODOS os comandos são auditados com
o id. Terminou a sessão? Peça ao usuário para desemparelhar no painel do
app. O que transita pela internet: JSON de metadados (nomes de clipes,
timestamps, sumários) — os arquivos de mídia NUNCA saem do PC do usuário.

---
Fonte viva desta skill: github.com/lucasgabrieldevgg/ponte-local (fork do
ponte-local de MicaelSanPedro, MIT). A lista de ações acima é derivada do
registry do app — se o app crescer, o bloco colável traz a versão fresca.

GalaxyCut-AI · Modo Ponte · adaptação do modelo ponte-local de
MicaelSanPedro (MIT) — as ações de arquivo/comando do original foram
substituídas pela superfície de edição do app.
