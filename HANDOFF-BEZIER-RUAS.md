# Passagem de contexto — editor Bézier e geração de ruas

## Autorização persistente do dono para continuidade da task

O dono reiterou autorização para todas as edições necessárias ao trabalho solicitado dentro desta task/worktree, incluindo alterações de código, contratos/API, baselines, testes e documentação. Não pedir novamente autorização equivalente para mudanças já abrangidas pelo objetivo. Explicar decisões e alterações de comportamento sem transformar essa explicação em uma nova aprovação rotineira. Edições diretas na worktree foram explicitamente autorizadas; Git e verificações seguem pelo ia-graft.

Essa preferência registra a autorização do usuário; não desativa nem contorna controles técnicos da plataforma. Se uma ferramenta rejeitar uma ação, distinguir o bloqueio automático de uma falta de autorização do usuário e relatar o motivo real. Não afirmar que uma frase específica garante desbloqueio. Merge continua humano conforme a regra do repositório.

## Pesquisa posterior: fragmentação e integração incompleta

O usuário rejeitou a entrega parcial: manipulador apenas ao selecionar pontos de rua, ausente na autoria e nas paredes; desenho livre produz muitos trechos pequenos. A pesquisa verificada está em [RESEARCH-ROAD-ALGORITHMS.md](RESEARCH-ROAD-ALGORITHMS.md), com commits/fontes de Godot Road Generator e Road Architect, funções dissecadas e reproduções reais-WASM. Curva suave: 4 cúbicas; mesma curva com oscilação de amplitude 0,15: 33 cúbicas, independentemente de 81/161/321 amostras. Entradas iguais deram saídas iguais. Aumentar tolerância de 0,12 para 0,20 reduziu só para 31. Não chamar isso de correção já aplicada. Próximo recorte: comparar ajuste aproximante de cúbicas com o interpolante atual e generalizar a sessão de autoria/edição para alvos spine/contour/rascunho. Não impor teto arbitrário, migrar paredes em massa ou prometer que tesselação resolve seleção de âncoras.

## Implementação atual — substitui as pendências históricas abaixo

O usuário aprovou recalcular a curva ao mover âncoras de ruas criadas Por pontos e autorizou a integração visual e a extensão da API. Implementado o TransformControls oficial do Three.js 0.182.0, isolado no backend render-3d, exposto por View.setPointManipulator e conectado à seleção/edição da espinha no VTT. Clicar numa âncora mostra o gizmo; setas e plano XZ movem a âncora mantendo altura. A prévia da espinha acompanha o gesto; a malha completa da rua é regenerada na confirmação. Esc cancela. Seleção, desfazer/refazer e troca de ferramenta atualizam/limpam o helper.

Novas ruas Por pontos persistem mode=automatic e reinterpolam usando o Rust existente; desenho livre e curvas antigas livres não são migrados. Teste real-WASM confirma o caso (-10,0,0), (0,0,4), (10,0,0) com ponto central movido para (1,0,6), incluindo undo/redo.

Verificado: VTT 477 testes; render-3d 74 testes, incluindo raycasting do helper oficial, release final, captura, Esc, cleanup e isolamento visual; check/build VTT; baseline público atualizado e api-check; docs de ambos; signatures e graph:extract/check. A primeira tentativa Nx falhou ao materializar cache por privilégio Windows 1314; os targets passaram com --skip-nx-cache --excludeTaskDependencies após build direto das dependências existentes. graph:generate/check depende de .ai/state/tasks ausente; o Graph IR de código foi gerado e validado por graph:extract/check.

Prévia de produção reiniciada na worktree: http://127.0.0.1:4513/table/bezier-unificado, PID observado 20540. HTTP 200 e bundle servido contendo a nova política confirmados. Porta 4512 é outro ambiente. O agente não teve navegador conectado: isso NÃO é aceite visual; o usuário deve abrir, selecionar a ferramenta de rua e clicar numa âncora. Não declarar que toda a estabilidade foi resolvida. A dissecação Godot/Road Architect e melhorias de malha continuam pendentes.

Arquivos centrais novos: packages/render-3d/src/backend/three/point-manipulator.ts e tests/point-manipulator.test.mjs. Integração: contracts/view, backend/contract/create-backend, engine/create-engine; VTT scene-render-port, adapter, runtime, use-construction-pointer. Autoria: PathBrushEffect.curveMode até planBezierRoad. A biblioteca Three já existente é importada como dependência; nenhum código externo foi copiado ou nova dependência instalada.

## Avanço posterior ao planejamento — ler primeiro

O usuário autorizou avançar no que fosse possível antes de transferir para outro agente. Foi executado um diagnóstico com WASM real, documentado em [DIAGNOSTICO-BEZIER-RUAS.md](DIAGNOSTICO-BEZIER-RUAS.md), incluindo script reproduzível e resultados. A criação por pontos grava trechos como `free`; mover uma âncora não reinterpola pelos pontos atuais. A escolha entre reinterpolar e preservar tangentes foi perguntada ao usuário e permanece pendente no momento desta atualização. Os 11 testes focados passaram novamente. O navegador não está disponível e a pesquisa delegada de algoritmos expirou sem entregar arquivo. Nenhum código de produto mudou; as frentes ainda não estão concluídas. Este diagnóstico atualiza o retrato inicial abaixo.

Atualizado em 2026-09-23. Documento autossuficiente para continuar a worktree `TASK-320-BEZIER-CREATE-EDIT` com um ou mais agentes.

## Como usar

O usuário pediu este arquivo local para transferir contexto e finalizar o trabalho em outra sessão. As issues foram criadas antes dessa clarificação e foram aceitas como referência; não é necessário criar outro backlog. Este documento não declara a implementação pronta e não autoriza iniciar código nesta rodada de preparação.

Leia o estado e as decisões abaixo; escolha uma frente e receba a solicitação de execução do usuário. Antes de mudanças perceptíveis, explique a proposta e resolva as decisões abertas pertinentes. Preserve a implementação útil existente, investigando as falhas antes de substituir algoritmos.

Este documento é um retrato para handoff, não substitui AGENTS.md, GRAFTING_MASTER_SOURCE.md nem decisões arquiteturais. Revalide tudo que depende do estado do repositório.

## Índice das frentes

| Frente | Referência | Depende de | Resultado |
|---|---|---|---|
| baseline | [#325 — Ruas: reproduzir instabilidade e especificar a interação visual de referência](https://github.com/TassoossaT/Grafting-Monorepo/issues/325) | Nenhuma | Ver entregáveis detalhados abaixo |
| gizmo | [#326 — Bézier: integrar manipuladores visuais do Three.js pelo backend render-3d](https://github.com/TassoossaT/Grafting-Monorepo/issues/326) | baseline | Ver entregáveis detalhados abaixo |
| curves | [#327 — Bézier: auditar conversão centrípeta existente e continuidade durante edição](https://github.com/TassoossaT/Grafting-Monorepo/issues/327) | baseline | Ver entregáveis detalhados abaixo |
| dissection | [#328 — Ruas: dissecar Godot Road Generator e Road Architect para reaproveitamento seletivo](https://github.com/TassoossaT/Grafting-Monorepo/issues/328) | Nenhuma | Ver entregáveis detalhados abaixo |
| workflow | [#329 — Ruas: consolidar desenho livre e por pontos no editor visual unificado](https://github.com/TassoossaT/Grafting-Monorepo/issues/329) | baseline, gizmo, curves | Ver entregáveis detalhados abaixo |
| geometry | [#330 — Ruas: estabilizar geração e atualização de trechos com algoritmos selecionados](https://github.com/TassoossaT/Grafting-Monorepo/issues/330) | baseline, curves, dissection | Ver entregáveis detalhados abaixo |
| acceptance | [#331 — Ruas: validar estabilidade e aceite visual do editor e gerador integrados](https://github.com/TassoossaT/Grafting-Monorepo/issues/331) | workflow, geometry | Ver entregáveis detalhados abaixo |

## Organização para um ou vários agentes

Com um agente: baseline → dissection → curves → gizmo → workflow → geometry → acceptance. Pesquisa pode antecipar trabalho independente; implementação depende das decisões e entregas indicadas.

Com vários agentes:
- Coordenador: mantém decisões, atribui arquivos, integra contratos, verifica a versão real e conduz o aceite final.
- Pesquisa: baseline e dissection podem ocorrer simultaneamente em leitura; compartilhar reproduções e dossiê.
- Renderização: gizmo, com propriedade dos contratos/backend render-3d. Combinar previamente com o responsável pela integração VTT.
- Geometria: curves e depois geometry, com propriedade da matemática Rust. Evitar dois agentes editando os mesmos módulos/contratos.
- Integração VTT: workflow após contrato do gizmo e política de curva definidos; coordena runtime/dispatcher com renderização.
- Validação: acceptance após integração; pode preparar cenários antes.

Não abrir worktrees da mesma branch para simular isolamento. Na worktree compartilhada, definir proprietário exclusivo de cada arquivo; mudanças concorrentes em runtime, comandos e contratos exigem serialização. Só o coordenador executa commit/test/done enquanto houver outros escritores. Pesquisa pode ser paralela; compartilhamento de arquivos exige coordenação explícita. Não iniciar agentes automaticamente por ler este plano.

## Prompt para retomar com outro agente

> Continue a worktree TASK-320-BEZIER-CREATE-EDIT usando este documento. Sua frente é [baseline/gizmo/curves/dissection/workflow/geometry/acceptance]. Leia primeiro AGENTS.md e o contexto do ia-graft; revalide HEAD, alterações locais e PR #323. Informe o que já está implementado, o que falta e o que pretende alterar. Resolva comigo decisões de interação ainda abertas antes de implementá-las. Respeite as dependências e a propriedade de arquivos combinada. Não reintroduza Pen Tool, não duplique matemática Rust em JS e não confunda marcadores próprios com a integração visual pedida do Three.js. Registre evidências, testes, limitações e próximos passos. Não faça merge nem encerre a entrega sem validação visual.


## Objetivo e autorização desta rodada

Preparar uma base executável por outros agentes para aplicar a experiência visual do editor oficial de splines do Three.js à espinha Bézier e melhorar a estabilidade da geração/edição de ruas por reaproveitamento seletivo de algoritmos.

**Esta rodada é somente preparação do handoff local. As issues já criadas ficam como referência aceita pelo usuário. Não autoriza novas alterações de produto, instalações, migrações, reversões ou merge.** O usuário rejeitou a experiência atual e pediu discussão antes de novas implementações. Uma futura solicitação explícita para executar uma task delimita a autorização daquela execução.

## Decisões do usuário

- Uma única ferramenta de rua para criar e editar; sem ferramentas separadas “construir” e “editar”.
- Desenho livre por arraste como forma principal; criação por cliques também disponível para trechos controlados.
- Edição por pontos diretamente na cena, com indicadores visuais e manipuladores de movimento como na referência oficial do Three.js.
- Pen Tool, criação de tangentes por clique-arraste e uma experiência de editor vetorial não são a direção desejada.
- A espinha e a rua gerada devem se manter coerentes durante o fluxo de criação/edição.
- Prioridade: previsibilidade e estabilidade. Não acrescentar heurísticas inteligentes, snapping novo, correção automática do desenho ou novos recursos para encobrir falhas.
- Dissecar código e adaptar componentes pequenos é desejado. Não portar motores/ferramentas completos.
- Não extrapolar estas decisões de rua para paredes, contornos fechados, largura variável ou todas as perguntas da #314.

## Base verificada em 2026-09-23

- Issue de implementação anterior: #320. PR aberto: #323, base master, branch `task/TASK-320-BEZIER-CREATE-EDIT`.
- Worktree: `.worktrees/TASK-320-BEZIER-CREATE-EDIT`; HEAD observado `415c625f`, limpo. Revalidar na retomada.
- Implementado: desenho livre ajustado em Rust; modo por pontos; marcadores próprios de âncora/inserção; mover/inserir/remover pontos; transações e cancelamento; filtro de controles e revisões monotônicas na troca de apresentação.
- **Não implementado:** integração dos manipuladores visuais do exemplo oficial do Three.js. A implementação anterior substituiu essa expectativa por controles próprios.
- O usuário relata instabilidade e falta de indicadores/edição visível. Ainda não há reprodução que isole se a origem é picking, gesto, interpolação, malha, conexão, ambiente ou uma combinação. Não afirmar diagnóstico.
- Houve 475 testes VTT, check, build, docs e Graph IR aprovados. CI do PR observado com 1 check aprovado. Isso não constitui aceite de usabilidade.
- Não houve validação visual automatizada: nenhum navegador disponível. A prévia usada foi `http://127.0.0.1:4513/table/bezier-unificado`, em worktree, diferente do ambiente principal/porta 4512. Revalidar processo e versão; não confundir uma página antiga com a entrega.
- A troca de modo atualmente cancela o rascunho. Misturar livre e cliques no mesmo rascunho foi sugerido, mas não está implementado nem confirmado como requisito desta entrega.
- **Correção da pesquisa anterior:** `automatic_path` em `libs/graph/core/src/bezier.rs` JÁ converte uma cadeia centrípeta para cúbicas Bézier, usando nós calculados em XZ, e rejeita coincidência adjacente em XZ. O modo por pontos chama o comando `automatic`. Não abrir uma implementação duplicada de Catmull–Rom; investigar continuidade da política após mover/inserir/remover e diferença entre XZ e distância XYZ.

## Mapa de entrada no código

| Área | Arquivos e pontos de entrada |
|---|---|
| Ferramenta unificada | `apps/vtt/src/composition/tabletop/tools/paths/path-brush-tool.ts` → `path-points-tool.ts` / `pathPointsTool` |
| Captura livre | `apps/vtt/src/composition/tabletop/tools/paths/path-stroke-tool.ts` / `pathStrokeTool` |
| Gesto e integração | `apps/vtt/src/composition/tabletop/tools/core/curve-edit-gesture.ts`; `use-construction-pointer.ts` |
| Controles e cena | `apps/vtt/src/composition/tabletop/tabletop-runtime.ts` / `#syncBezierHandles`, `setConstructionHandlePresentation`; `apps/vtt/src/adapters/rendering/render-3d-scene-adapter.ts` / `pick` |
| Renderização genérica | `packages/render-3d/src/backend/contract.ts`; `backend/three/create-backend.ts`; `contracts/view.ts`; `camera/orbit.ts` |
| Edição da espinha | `apps/vtt/src/features/edit-construction/spine/spine-edit-plan.ts`, `spine-actions.ts`; `orchestration/spine-edit.ts` |
| Geração da rua | `apps/vtt/src/features/edit-construction/structure-types/path/bezier-road-plan.ts` / `planBezierRoad`, `bezierChains`; `bezier-road-edit.ts` / `regeneratePathSpine`; `path-cloud-mutation.ts` |
| Autoridade geométrica | `libs/graph/core/src/bezier.rs` / `automatic_path`, `fit_path`; `bezier_commands.rs`; `bezier_surface.rs` / ribbons e joins; `bezier_network.rs` / conexões e interseções |
| Evidência existente | `apps/vtt/test/curve-pen-session.test.mjs` (nome histórico, testes do fluxo por pontos), `platform-pointer.test.mjs`, `tabletop-runtime.test.mjs`; `docs/architecture/bezier-pen-integration.md` (descreve a implementação, não aceite do usuário) |

## Referências e limites do reaproveitamento

1. [Exemplo oficial Three.js](https://threejs.org/examples/webgl_geometry_spline_editor.html) e [código](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_geometry_spline_editor.html): referência mandatória de seleção/manipulação visual. A demo combina helpers, picking e TransformControls; não é um gerador de ruas nem um editor Bézier pronto. Seu painel de comparação de curvas, posições aleatórias e limites de demonstração não viram requisitos do produto.
2. [TransformControls](https://threejs.org/docs/pages/TransformControls.html): avaliar adaptação dentro do backend Three existente, sem expor tipos vendor ou criar um segundo controlador de câmera.
3. [Godot Road Generator](https://github.com/TheDuckCow/godot-road-generator): primeira fonte para dissecação da organização de pontos/segmentos e construção de malha. Entrada verificada: `addons/road-generator/nodes`, `procgen`, `plugin.gd`. MIT. Não foi feito benchmark ou auditoria completa dos algoritmos. A [documentação admite limitações de conexões entre containers](https://github.com/TheDuckCow/godot-road-generator/wiki/A-getting-started-tutorial).
4. [Road Architect](https://github.com/FritzsHero/RoadArchitect): fonte secundária MIT para comparar geração e junções. Entradas verificadas em `Scripts`: `Spline/`, `RoadCalcs1.cs`, `RoadCalcs2.cs`, `RoadConstructorBufferMaker.cs`, `Intersections.cs`. Existência de arquivo não prova adequação; registrar funções/linhas após leitura.
5. [EasyRoads3D — Road Tools](https://www.easyroads3d.com/tutorials/road_tools.php): referência visual/comportamental para controle da forma, resolução e limites. Não copiar implementação proprietária sem autorização/licença aplicável.
6. [Yuksel et al.: parametrização Catmull–Rom](https://www.cemyuksel.com/research/catmullrom_param/): referência matemática para conversão centrípeta/Bézier. A propriedade de ausência de cúspides/auto-interseções é local a segmentos sob as hipóteses estudadas; não garante bordas, cruzamentos ou estabilidade do mouse.

Fixar commit/tag e licença de cada trecho efetivamente avaliado antes de adaptá-lo. Registrar autor, origem, mudanças, atribuição necessária e dependências descartadas.

## Fronteiras obrigatórias

- Geometria, interpolação, offset, amostragem, consultas e algoritmos reutilizáveis permanecem no Rust `grafting-graph-core`.
- Capacidade de manipulação visual reutilizável pertence a `packages/render-3d`. Three.js somente no backend proprietário; API pública usa tipos Grafting.
- VTT define gestos, cores, tamanhos, modo de rua, seleção e feedback. Não colocar vocabulário de rua no pacote genérico.
- Não manter spline JS e grafo Rust como autoridades concorrentes. Proxies de renderização são descartáveis e refletem estado/preview.
- Um dono do gesto: manipulação de ponto não pode também acionar câmera, desenho ou seleção concorrente. Cancelamento restaura câmera e captura.
- Uma transação por alteração confirmada; nenhuma por hover, seleção, clique sem delta ou cancelamento. Última amostra de release participa.
- Não prometer estabilidade com base apenas em quantidade de testes ou em instalar uma biblioteca.

## Execução e coordenação entre agentes

As subtasks abaixo são planejamento, não implementação realizada. Cada uma deve produzir um handoff com entradas, evidências, arquivos tocados, limitações e próxima dependência. Pesquisa pode ocorrer em paralelo; edições sobre arquivos compartilhados devem ter dono único.

Enquanto #323 estiver aberto, continuação dependente da base existente permanece na MESMA branch/worktree e no MESMO PR, conforme AGENTS.md; não empilhar PRs nem abrir worktrees concorrentes dessa branch. Após eventual merge humano, reavaliar a base e criar tasks pelo ia-graft. Nunca fazer merge por agente.

Ao retomar: ler este refinamento + subtask, executar `graft_context` ou resume, verificar status de #323/HEAD e AGENTS locais. Usar ia-graft para Git, issues, deps e verificações. Falhas anteriores de delegate/ambiente não autorizam por si só contornar política; verificar autorizações vigentes.

## Critério global de aceite

- Indicadores de ponto, hover, seleção e manipulador realmente visíveis e operáveis na cena VTT, com evidência visual na versão correta.
- Criar pelos dois modos e editar a mesma espinha; a rua gerada corresponde à curva apresentada.
- Reproduções de instabilidade documentadas antes/depois, incluindo zoom/câmera, pontos próximos, curvas apertadas e conexão.
- Erros/entradas inválidas têm comportamento explícito, sem salto silencioso, malha inválida persistida ou commit de preview antigo.
- Testes de matemática, interação, integração real-WASM e navegador cobrem riscos diferentes. Registrar navegador/hardware e medidas de desempenho; não inventar números.
- Check/test/build/docs e API baselines aplicáveis aprovados; validação visual e aceite do usuário registrados. Se não houver navegador, deixar validação visual pendente, sem declarar a experiência concluída.

## Decisões ainda abertas

Plano de arraste XZ vs terreno vs eixos XYZ; comportamento de altura; estilo/tamanho do gizmo em diferentes zooms; política da interpolação após edição; revisão de XZ versus XYZ; limiar e feedback para geometrias inválidas; preservação do rascunho ao trocar modo; níveis de atualização visual da rua durante arraste. Resolver com evidência e apresentar mudanças perceptíveis antes de aplicá-las. As perguntas não bloqueiam a pesquisa e o diagnóstico.

# Detalhamento executável das frentes

## Frente baseline — Ruas: reproduzir instabilidade e especificar a interação visual de referência

Referência: [#325](https://github.com/TassoossaT/Grafting-Monorepo/issues/325). Dependências: nenhuma.

### Objetivo

Transformar “não está estável” e “faltam os indicadores/editor do Three.js” em reproduções verificáveis e um contrato visual de uso. Não presumir que a causa é a interpolação.

### Entradas

`path-points-tool.ts`, `path-stroke-tool.ts`, `use-construction-pointer.ts`, `curve-edit-gesture.ts`, runtime/picking e testes indicados em #324. Comparar a cena VTT com o exemplo oficial Three.js, sem instalar ou portar o gerador inteiro.

### Trabalho e entregáveis

- Verificar rota, porta, branch, build e persistência da cena que o usuário está vendo. Registrar o que é ambiente antigo versus defeito reproduzido.
- Criar matriz: gesto → esperado → observado → reprodução mínima → camada suspeita → evidência. Separar picking, projeção do ponteiro, câmera, curva, malha, topologia e custo.
- Casos: linha, S, curva apertada/U, pontos muito próximos/duplicados, espaçamentos desiguais, rua curta/larga, terreno inclinado, zoom/câmera, múltiplas ruas e encontro em níveis diferentes.
- Descrever visualmente ponto normal/hover/selecionado, gizmo de movimento, espinha e prévia da rua. Explicar criação livre, criação por cliques e edição na mesma ferramenta.
- Apresentar escolha de restrição de arraste (plano/eixos/terreno) e tratamento de altura com vantagens e limites. Registrar decisões pendentes; não escolhê-las silenciosamente.
- Registrar amostras de ponteiro e curva para reprodução determinística, sem capturar dados pessoais. Medir custo de picking, cálculo e render separadamente numa cena declarada.
- Registrar baseline visual (capturas ou vídeo), navegador/zoom/hardware, versão e passos. Se navegador indisponível, preparar roteiro manual e marcar evidência visual pendente.

### Aceite

- [ ] Cada falha alegada está reproduzida ou explicitamente marcada não reproduzida.
- [ ] Referência visual e diferença em relação ao estado atual estão claras para alguém sem o histórico.
- [ ] Contrato de manipulação proposto é revisável antes de implementação.
- [ ] Dados/cenas mínimos podem ser reutilizados pelas demais tasks.
- [ ] Nenhum algoritmo foi trocado com base apenas em hipótese.

### Handoff

Entregar links das evidências, coordenadas/cenas sintéticas, tabela de hipóteses, decisões obtidas/pendentes e arquivos exatos investigados. Dependências: nenhuma além de #324.

## Frente gizmo — Bézier: integrar manipuladores visuais do Three.js pelo backend render-3d

Referência: [#326](https://github.com/TassoossaT/Grafting-Monorepo/issues/326). Dependências: baseline.

### Objetivo

Aplicar à espinha Bézier a experiência de manipulação visual solicitada pelo usuário. Marcadores próprios isolados não substituem esta entrega.

### Inspeção de referência

Fixar revisão/licença MIT do exemplo `examples/webgl_geometry_spline_editor.html` e do addon `TransformControls`. Avaliar helpers, seleção, attach/detach, `getHelper`, `objectChange` e arbitragem de arraste/câmera. Não copiar a criação de pontos aleatórios, painel lil-gui, loop global, três curvas comparativas ou restrição artificial de quatro pontos da demo.

### Implementação prevista, após autorização

- Capability genérica no render-3d com tipos Grafting: alvo/posição, restrição, estado visual e eventos início/prévia/fim/cancelamento. API a desenhar após inventário do contrato atual.
- Three.js/TransformControls e seus tipos somente em `src/backend/three`, atrás do contrato proprietário. Avaliar addon já distribuído com a versão instalada; não instalar outra cópia do Three.
- Ponto/proxy do gizmo não é grafo autoritativo. Movimento gera intenção/prévia para o consumidor; sem persistir um segundo spline JS.
- Integrar seleção e controles visuais na cena VTT real, sem novo renderer, cena paralela ou outro dono de câmera.
- Um único dono do pointer/capture. Suspender câmera durante manipulação e restaurá-la em todos os términos: release, Esc, pointercancel, lost capture, troca de ferramenta, troca de mesa e dispose.
- Hover/seleção distinguíveis; área de clique utilizável nos zooms acordados; centro lógico do ponto não depende da superfície do marcador.
- Invalidar apenas o necessário; não introduzir loop de renderização independente. Recursos/listeners têm lifecycle e cleanup verificáveis.
- VTT fornece aparência e política; pacote não conhece rua, parede ou terreno.

### Aceite

- [ ] Manipulador visível e utilizável em pontos da espinha na tela do VTT, com evidência.
- [ ] Arraste não movimenta câmera nem inicia desenho simultaneamente; seleção sem deslocamento não cria transação.
- [ ] Ponto fica na posição indicada pelo gesto/restrição escolhida, sem salto ao selecionar.
- [ ] Troca de ferramenta, desfazer/refazer e remoção do alvo não deixam gizmo órfão.
- [ ] Isolamento backend, contratos/API baseline, testes de lifecycle e invalidation aprovados.
- [ ] Não declarar a integração pronta com teste unitário de controlador apenas.

Entradas locais: backend contract/create-backend, contracts/view, camera/orbit, adapter de rendering, runtime e dispatcher de #324. Handoff: contrato público, mapeamento trecho original → adaptação, atribuição, demonstração visual e limites.

## Frente curves — Bézier: auditar conversão centrípeta existente e continuidade durante edição

Referência: [#327](https://github.com/TassoossaT/Grafting-Monorepo/issues/327). Dependências: baseline.

### Objetivo

Garantir uma política geométrica previsível para desenhar e editar por pontos, preservando Bézier como representação. **automatic_path já é centrípeta em XZ; não reimplementar como novidade.**

### Inspeção e decisões

- Ler `bezier.rs::automatic_path`, comando `automatic`, `fit_path` e fluxo de persistência de handles em `planBezierRoad`, `spine-edit-plan.ts` e `spine-actions.ts`.
- Traçar quais caminhos usam conversão centrípeta, fitting livre e controles explícitos após commit. Verificar se mover/inserir/remover mantém a política esperada e se metadados de autoria/modo são preservados. Não presumir a causa.
- Comparar XZ atual com parametrização XYZ da referência em exemplos inclinados. Explicitar coordenadas repetidas em XZ com Y distinto, extremidades e fechamento.
- Propor o que deve acontecer ao mover ponto: preservar controles explícitos ou recalcular vizinhança da cadeia interpolada. A decisão afeta forma e dados antigos, portanto documentar antes de mudar.
- Usar a pesquisa de Yuksel como referência matemática, sem estender sua garantia local a cruzamentos, bordas offset ou curvas globais.

### Implementação prevista, somente onde a análise justificar

Correções/extensões em Rust, com adaptação mínima do port e baseline público se necessário. Conversões não devem alterar ruas antigas só por carregá-las. Caso precise nova política/metadado, descrever compatibilidade e migração reversível; nenhuma migração nesta fase de refinamento.

### Aceite

- [ ] Os pontos explícitos permanecem nos locais escolhidos; curva finita e extremidades corretas.
- [ ] Casos de coincidência e trechos degenerados produzem resultado/erro declarado, nunca NaN ou preview antigo confirmado.
- [ ] Testes com espaçamento desigual, S, U, altura e loop quando suportado; verificar conversão Bézier e continuidade relevante.
- [ ] Inserir por subdivisão exata preserva a forma; remover ponto tem contrato explícito de mudança local.
- [ ] Fitting livre e interpolação por cliques não são tratados como o mesmo algoritmo.
- [ ] Sem autoridade matemática paralela em JS; Rust/API/WASM e regressões de dados existentes verificados.

Handoff: relatório confirmado versus hipótese, decisão de política, casos numéricos reproduzíveis, alterações necessárias e limites da garantia matemática.

## Frente dissection — Ruas: dissecar Godot Road Generator e Road Architect para reaproveitamento seletivo

Referência: [#328](https://github.com/TassoossaT/Grafting-Monorepo/issues/328). Dependências: nenhuma.

### Objetivo

Produzir um dossiê técnico de componentes reaproveitáveis, não portar ferramentas inteiras. Executar pesquisa/leitura antes de escolher algoritmos para produção.

### Fontes e escopo

- Principal: Godot Road Generator, diretório `addons/road-generator`, especialmente `nodes/`, `procgen/` e `plugin.gd`. Fixar commit/tag e licença.
- Secundária: Road Architect, `Scripts/Spline/`, `RoadCalcs1.cs`, `RoadCalcs2.cs`, `RoadConstructorBufferMaker.cs`, `Intersections.cs`.
- EasyRoads3D apenas como referência de comportamento/limitações, sem copiar código proprietário.
- Entradas são diretórios/arquivos verificados em #324; funções internas e robustez ainda precisam de leitura. Não repetir afirmações de pesquisa delegada sem verificar fonte primária.

### Dossiê obrigatório

Para cada componente candidato, registrar:
1. URL permalink, commit, arquivo, função e licença/atribuição.
2. Entradas, saídas, invariantes, casos degenerados e premissas de coordenadas.
3. Dependências do motor/editor versus algoritmo isolável.
4. O que já existe no Rust/VTT; reaproveitar, adaptar, usar apenas como referência ou descartar, com motivo.
5. Custo/complexidade e comportamento de atualização observado no código, sem inventar benchmarks.
6. Testes/casos disponíveis e quais precisam ser criados na adaptação.
7. Destino proposto: Rust para cálculo; render-3d para manipulação/visual; VTT para política/orquestração.

Investigar separadamente amostragem longitudinal, orientação das seções, faixa/bordas, joins, triangulação, conexão/topologia e atualização por trecho. Priorizar problemas reproduzidos na task de baseline. Não assumir que código MIT significa “estável” ou que exportar GLB preserva autoria/editabilidade da espinha.

### Aceite

- [ ] Pelo menos um recorte pequeno de geração de trecho e um de atualização/conexão foram analisados com evidência de código.
- [ ] Matriz compara candidatos com `bezier_surface.rs`, `bezier_network.rs` e geração atual.
- [ ] Limitações conhecidas documentadas, inclusive conexões entre containers no Godot.
- [ ] Plano mínimo de adaptação revisável: benefício ligado a falha reproduzida, custos e riscos.
- [ ] Nenhuma biblioteca instalada ou código de produto alterado por esta task de pesquisa.

Pode ocorrer em paralelo ao diagnóstico visual, sem editar arquivos compartilhados. Se um experimento for necessário, propor escopo isolado em architecture-studio /lab; não criar spike nem protótipo automaticamente.

## Frente workflow — Ruas: consolidar desenho livre e por pontos no editor visual unificado

Referência: [#329](https://github.com/TassoossaT/Grafting-Monorepo/issues/329). Dependências: baseline, gizmo, curves.

### Objetivo

Conectar os controles visuais e a política geométrica definidos nas tasks anteriores à ferramenta de rua existente, mantendo as duas formas de criação.

### Fluxo esperado

- Mesma ferramenta: Desenho livre (arrastar e soltar) e Por pontos (cliques, preview, confirmação).
- Usar os pontos da espinha e o manipulador visual aprovado para editar a mesma rua gerada.
- Não reintroduzir caneta de tangentes/pen-tool como modo por pontos.
- Manter indicadores de início/fim, alvo selecionado e preview compreensíveis. O usuário deve saber quando está desenhando, movendo ou inserindo.
- Arbitragem entre gizmo, ponto, corpo da rua, terreno e câmera explícita. Nenhuma edição inadvertida do corpo, inclusão acidental ou mudança de alvo durante o arraste.
- Captura livre convertida em Rust sem inventar limpeza inteligente. Cliques preservados conforme contrato da interpolação.
- Confirmar política de mudança de modo antes de alterá-la: hoje cancela; mistura de modos no mesmo rascunho não está aprovada.
- Definir como conectar novos trechos a uma rua existente sem conflitar com selecionar/mover sua extremidade. Essa disputa de gesto precisa de decisão demonstrável, não heurística implícita.
- Prévia nunca altera estado confirmado; cada operação válida cria um undo; erro/cancelamento deixa estado anterior. Última amostra participa e release duplicado não duplica operação.

### Entradas

`path-brush-tool.ts`, `path-points-tool.ts`, `path-stroke-tool.ts`, `curve-edit-gesture.ts`, `use-construction-pointer.ts`, painel de parâmetros, runtime/adapters e contratos das tasks predecessoras. Aproveitar testes e transações existentes, sem reset geral.

### Aceite

- [ ] Criar nos dois modos, selecionar, mover, inserir, remover e desfazer/refazer funciona na mesma ferramenta visível.
- [ ] Espinha mostrada corresponde à geometria confirmada e à rua.
- [ ] Hover/clique/cancelamento/formulários não disparam comandos indevidos.
- [ ] Câmera e pointer capture recuperados em todas as saídas.
- [ ] Ferramentas de parede, contorno e outras curvas não perdem controles.
- [ ] Roteiro visual da baseline repetido, além de real-WASM e testes de dispatcher.
- [ ] Sem alegar aceite apenas por HTTP 200 ou cobertura automatizada.

Handoff: tabela final de gestos, decisões, diferenças do fluxo anterior, vídeo/capturas e limites conhecidos. Alterações de malha além do necessário para conectar este fluxo pertencem à task de geração.

## Frente geometry — Ruas: estabilizar geração e atualização de trechos com algoritmos selecionados

Referência: [#330](https://github.com/TassoossaT/Grafting-Monorepo/issues/330). Dependências: baseline, curves, dissection.

### Objetivo

Aplicar somente os recortes justificados pelo dossiê e pelas reproduções, para que a rua gerada permaneça coerente com a espinha durante edição. Não substituir o gerador inteiro.

### Entradas e fronteiras

Rust: `bezier_surface.rs`, `bezier_network.rs`, comandos Bézier. VTT: `bezier-road-plan.ts`, `bezier-road-edit.ts`, `path-cloud-mutation.ts`, `path-cloud-scope.ts` e planejador de contorno. Cálculos novos genéricos vão ao Rust; composição e tipos de rua ficam no VTT.

### Trabalho previsto

- Mapear caminho afetado por uma alteração e confirmar onde ocorre reconstrução excessiva. Usar invalidação/localidade sem invalidar dependências reais de junções.
- Reutilizar/adaptar o menor algoritmo selecionado para amostragem, orientação de seções, faixa/joins ou triangulação, conforme falha comprovada.
- Separar validade da linha central, validade da faixa com largura e conectividade. Uma curva regular pode produzir uma faixa inválida.
- Para trecho curto/largo, retorno apertado, sobreposição e degeneração: declarar limites e feedback; não esconder defeito com largura alterada, suavização ou ponto deslocado automaticamente.
- Manter IDs/seleção e atributos que não foram editados. Cruzamentos existentes e níveis separados precisam de regressão; não ampliar para sistema viário/tráfego novo.
- Prévia leve e confirmação usam a mesma geometria autoritativa. Se atualização visual completa durante arraste não for viável, apresentar comportamento e custo antes de escolher substituto.
- Preservar transação/rollback; não deixar malha parcial após falha, nem aceitar o último preview válido quando o estado final é inválido.
- Registrar fonte e licença de cada trecho adaptado. Algoritmo estudado mas não reutilizado deve aparecer como descartado, com motivo.

### Aceite

- [ ] Casos da baseline não produzem falhas silenciosas de malha/espinha.
- [ ] Extremos de trechos conectados coincidem dentro da tolerância declarada; ligações em níveis diferentes não se fundem indevidamente.
- [ ] Vizinhos não afetados não mudam forma/IDs; região de reconstrução medida e explicada.
- [ ] Perfis/larguras/atributos compatíveis preservados; entradas inválidas têm erro explícito.
- [ ] Comparação antes/depois mede trabalho geométrico e latência em cena documentada; metas definidas com a baseline, sem prometer desempenho universal.
- [ ] Rust, WASM, transações, API baseline e testes de regressão relevantes aprovados.

Handoff: fonte/função adaptada → destino, decisões, fixtures, números medidos e limitações restantes.

## Frente acceptance — Ruas: validar estabilidade e aceite visual do editor e gerador integrados

Referência: [#331](https://github.com/TassoossaT/Grafting-Monorepo/issues/331). Dependências: workflow, geometry.

### Objetivo

Validar a experiência solicitada na tela, além dos contratos técnicos. Não repetir a conclusão anterior de “pronto” com base somente em testes.

### Matriz obrigatória

1. Visualização inicial de rua existente: pontos, seleção, hover e gizmo visíveis na versão correta.
2. Criar linha/S por desenho livre e percurso controlado por cliques.
3. Arrastar ponto perto/longe da câmera, com zoom e diferentes orientações; sem salto inicial ou troca de alvo.
4. Inserir, mover e remover ponto; extremos e último trecho; verificar erro previsto em junção.
5. Curva apertada, pontos próximos/iguais, espaçamento desigual, trecho curto/largo, altura e encontro entre ruas.
6. Cancelar com Esc/pointercancel/perda de captura; trocar ferramenta/mesa; desfazer/refazer e recarregar.
7. Mouse sobre inputs/selects; seleção sem movimento; release final sem evento intermediário; operação repetida.
8. Coerência entre preview e resultado, malha e espinha; câmera livre quando termina o gesto.
9. Regressão de controles das outras ferramentas.

### Evidência e verificações

- Fixar commit, rota, build e cena; incluir navegador/hardware, coordenadas e passos reproduzíveis.
- Capturas/vídeos antes/depois das falhas originais e checklist de comportamento observado.
- Medir frame/latência/custo separadamente da correção; avaliar contra orçamento acordado na baseline.
- Testes matemáticos e integração real-WASM, lifecycle/render, dispatcher e browser conforme camadas alteradas.
- VTT check/test/build/docs-generate/docs-check; render-3d e Rust testes/api-check se alterados; Graph IR/signatures conforme AGENTS. Rodar via ia-graft.
- Se navegador/provedor indisponível, registrar bloqueio de evidência visual e entregar roteiro para validação humana. Não marcar esta task concluída apenas por HTTP 200.

### Aceite

- [ ] Todos os cenários têm resultado e evidência ou pendência explícita.
- [ ] O usuário consegue reconhecer o editor visual que pediu, não apenas um novo nome no painel.
- [ ] As instabilidades reproduzidas foram resolvidas ou têm limites acordados.
- [ ] Ambiente de teste corresponde à entrega do PR e instruções de abertura são inequívocas.
- [ ] Aceite visual do usuário registrado antes de encerrar o refinamento.
- [ ] PR descreve o comportamento final e riscos; merge permanece humano.

Handoff final: instruções curtas de uso, links de evidências, commit validado, checks, limitações e pendências. Não expandir para modos inteligentes, tráfego ou reforma de outras ferramentas.
## Estado que o próximo agente deve devolver

- Frente concluída ou parcialmente concluída e evidências correspondentes.
- HEAD inicial/final, arquivos alterados e comandos de verificação com resultados reais.
- Decisões confirmadas pelo usuário versus propostas ainda abertas.
- Fontes externas efetivamente adaptadas, commit/licença e atribuição.
- Limitações conhecidas, falhas reproduzidas restantes e instruções para abrir a versão correta.
- Próxima frente desbloqueada e conflitos de propriedade de arquivos, se houver.

## Conclusão da worktree

Finalizar significa integrar a interação visual e os algoritmos justificados, verificar o fluxo real e atualizar o mesmo PR enquanto estiver aberto. Não significa descartar a worktree agora. A limpeza só ocorre após merge humano, via ia-graft.

O resultado anterior de testes é histórico. Não reutilizá-lo como resultado das próximas alterações. Se faltar navegador, evidência visual ou decisão de produto necessária, registrar a pendência claramente e não declarar experiência validada.

Esta rodada de preparação altera apenas este documento. Não foram implementados gizmos, algoritmos ou mudanças de interação durante sua criação.


## Centralizacao implementada - 23/09/2026

- InterpretStroke no graph-core Rust centraliza o ajuste Bezier antes implementado em TypeScript na parede. Rua e parede agora consomem esse comando; grid e arcos legados preservam seus caminhos existentes.
- Rua por desenho livre usa max(0, radius - bedWidth / 2) como margem de correcao. Preview e confirmacao usam a mesma interpretacao; o construtor recebe curvas autoradas sem novo fitting. A aparencia do preview permanece.
- A margem limita desvio das amostras XZ: nao garante ausencia de lacos, validade da malha ou contencao de toda a largura no pincel. Quadrado/hexagono usam alcance escalar, sem contencao poligonal exata. Limite de 4096 observacoes, validacao de numeros finitos e preservacao de retornos colineares.
- Passaram: 478 testes VTT, 106 testes unitarios graph-core, check TypeScript, builds WASM/VTT e graph-core:api-check. Baseline publica atualizada. Regressao real-WASM usa 161 amostras tremidas, exige menos de 10 espinhas e compara preview/confirmacao/curva salva (com precisao f32 do grafo).
- Pendente: aceite visual, curvas apertadas/largas/cruzamentos e integracao posterior dos gizmos de parede. Centralizar fitting nao conclui toda a interacao compartilhada.


## Correcao de altura - 23/09/2026

- Gizmo da espinha agora expoe X/Y/Z. O gesto recebe XYZ diretamente do manipulador; o arrasto comum no plano continua preservando Y do ponto selecionado.
- InterpretStroke ajusta os controles verticais por minimos quadrados e verifica erro vertical separado (0.025 unidades), independentemente da margem lateral do pincel. Assim extremos em Y=0 nao apagam uma elevacao intermediaria.
- Testes adicionados: elevar ancora pelo mesmo gesto usado pelo gizmo, mover horizontalmente sem perder altura, criar e persistir uma colina com extremos baixos e verificar altura da superficie gerada. Nao implementa nova projecao automatica sobre terreno ao arrastar: preserva altura autorada e amostrada.
- Validacao: 480 testes VTT, 107 testes Rust, check TypeScript e builds passaram. Foi necessario reconstruir render-3d por artefatos locais desatualizados. Aceite visual continua pendente.
