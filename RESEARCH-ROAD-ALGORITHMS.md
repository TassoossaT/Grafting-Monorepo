# Análise verificada: fragmentação do desenho e geração de ruas

Data: 2026-09-23. Continuação de #324/#328 e da worktree TASK-320-BEZIER-CREATE-EDIT.
Esta rodada executou pesquisa e reproduções reais-WASM. Não alterou o algoritmo de produção.

## Conclusão

A primeira intervenção deve ser no ajuste do desenho livre, antes de alterar o gerador de malhas. O ajuste atual já distingue amostras e cúbicas, mas promove amostras com erro alto a âncoras e pode representar o ruído como muitos trechos. Não é correto afirmar que cada evento do mouse vira sempre uma âncora.

O editor visual é outra frente: a integração atual exige handlePresentation=spine-points e id com prefixo spine:. Isso exclui as paredes deliberadamente no código, embora exista infraestrutura genérica de curvas e gestos. Remover esses filtros sem conectar resolução de alvos e commit de contorno não basta.

## Reprodução numérica executada

Via graft_task_test e sessionFixture (WASM real), comando fit, coordenadas XYZ.

Curva base: x=20t, y=0, z=4 sin(pi t), t entre 0 e 1.
Com 21, 81 e 161 amostras e tolerância 0,12: sempre 4 cúbicas / 5 âncoras.

Curva com ruído controlado: z=4 sin(pi t)+0,15 sin(32 pi t).
Esta é a MESMA curva contínua nas três densidades abaixo:

| Amostras | Tolerância | Cúbicas | Repetição idêntica |
|---|---|---|---|
| 81 | 0,12 | 33 | Sim |
| 161 | 0,12 | 33 | Sim |
| 321 | 0,12 | 33 | Sim |
| 81 | 0,20 | 31 | Sim |
| 161 | 0,20 | 31 | Sim |
| 321 | 0,20 | 31 | Sim |

O caso demonstra fragmentação por conteúdo oscilatório e determinismo para entrada igual. NÃO demonstra aleatoriedade nem dependência inevitável da taxa do mouse. Não é uma reprodução visual do gesto do usuário. Ainda falta investigar picking/projeção/câmera com amostras reais.

Um teste exploratório anterior amarrou o ruído ao índice da amostra e produziu 16/62/123 cúbicas para 21/81/161 amostras. Como esse teste muda a frequência espacial do ruído junto com a densidade, não serve para alegar instabilidade sob reamostragem. A tabela acima controla esse fator.

### Caminho local

- path-stroke-tool.ts::draft envia amostras brutas ao fit com tolerância 0,12; preview usa os cúbicos resultantes.
- bezier.rs::fit_path deduplica XZ, começa com extremos, interpola por automatic_path e insere amostras de maior erro até satisfazer seu critério.
- planBezierRoad transforma extremos de cada cúbica ajustada em nós persistidos. Não confundir esses nós com amostras da malha.
- fit_gesture contém simplificação para detectar cantos, mas retorna ao fit_path quando não há cortes. Simplesmente ativá-lo não equivale a pré-filtrar todo o desenho.
- sample/ribbon possuem outra função: tesselação da curva. Alterar sua precisão não remove as âncoras já criadas.

## Godot Road Generator — recorte confirmado

Revisão: 980bc04c9f95a5c49b787f0a7a64a458156d5b9b.
[Arquivo inspecionado](https://github.com/TheDuckCow/godot-road-generator/blob/980bc04c9f95a5c49b787f0a7a64a458156d5b9b/addons/road-generator/nodes/road_segment.gd).
[Licença MIT, Moo-Ack! Productions](https://github.com/TheDuckCow/godot-road-generator/blob/980bc04c9f95a5c49b787f0a7a64a458156d5b9b/LICENSE).

- check_rebuild, linhas 206–241: valida extremos/container, liga referências de segmentos e reconstrói quando is_dirty.
- _update_curve, linhas 742–781: define a curva por dois RoadPoints e controles derivados de posição/orientação/magnitude; density configura bake_interval.
- _build_geo, linhas 907–936: calcula quantidade de seções pela extensão e densidade, com opção low_poly.
- _rebuild, linhas 710–739: atualiza curva, geometria e dados derivados.

Reaproveitar o padrão de autoria separada da resolução da malha e de segmento sujo. Não portar Node3D, Curve3D, SurfaceTool ou tráfego. Essas funções não oferecem um ajuste de desenho livre pronto. Não comprovam que todo movimento invalida somente dois trechos em qualquer rede.

## Road Architect — recorte confirmado

Revisão: ae6c383c8ab380626c87e07f8c793e46cf9f289f.
[Arquivo SplineC.cs](https://github.com/FritzsHero/RoadArchitect/blob/ae6c383c8ab380626c87e07f8c793e46cf9f289f/Scripts/Spline/SplineC.cs).
[Licença MIT, MicroGSD LLC](https://github.com/FritzsHero/RoadArchitect/blob/ae6c383c8ab380626c87e07f8c793e46cf9f289f/LICENSE.md).

- Setup, a partir da linha 90: coleta SplineN, ordena e prepara nós/comprimento.
- SetupSplineLength, a partir da linha 392: calcula parâmetros e depois cachedPoints, separados dos nós.
- RoadDefCalcs, a partir da linha 542: constrói cache de distância/parâmetros usando roadDefinition.
- GetSplineValue, linha 785: avalia posições/tangentes e trata extremos.

Reaproveitar a distinção entre nós, cache de avaliação e resolução da estrada. Não copiar Unity GameObjects nem presumir atualização local da malha: isso não foi demonstrado pelos trechos inspecionados. O cache por parâmetro não deve ser apresentado como espaçamento de arco matematicamente exato.

## Comparação e decisões de reaproveitamento

| Componente | Situação local | Direção |
|---|---|---|
| Autoria versus tesselação | Já há curvas e samples separados | Preservar; corrigir seleção das âncoras no ajuste |
| Faixa e offsets | Rust bezier_surface já fornece ribbons, joins e union | Não substituir sem reprodução de defeito de faixa |
| Invalidação de segmento | Godot expõe dirty/rebuild | Comparar dependências reais antes de otimizar reconstrução VTT |
| Ajuste livre robusto | Ajuste interpolante local sensível ao ruído | Avaliar aproximação de cúbicas e orçamento explícito de erro |
| Editor compartilhado | CurveEdge já distingue spine/contour; beginCurveGesture já despacha commits | Extrair resolução de seleção/preview; conectar as ferramentas de parede |

## Recorte proposto para aplicação

1. Preservar estas curvas sintéticas como casos de comparação. Acrescentar gesto real capturado com zoom, largura e plano de projeção declarados.
2. Comparar aproximação de cúbicas com simplificação seguida do ajuste atual, ambos em Rust. Medir erro do resultado FINAL contra o traço original; não basta medir a polilinha simplificada.
3. Avaliar âncoras, erro, extremidades, continuidade, curvas S/U, laços e degeneraçōes; separar garantia da linha central da validade de uma rua larga.
4. Só promover um candidato após comparação. Não impor teto arbitrário de oito trechos nem aumentar tolerância automaticamente até caber: isso pode apagar desenho intencional.
5. Na interação, manter pontos/espinha visíveis enquanto a ferramenta está ativa e expor o manipulador do alvo ativo também durante autoria. Um gizmo ativo por vez não significa esconder todos os pontos.
6. Generalizar o adaptador de alvos: ponto do rascunho, âncora persistida ou controle de CurveEdge. A sessão de interação é compartilhada; o commit continua respeitando spine/contour.
7. Conectar paredes: wall-shared.ts usa fitPath de features/edit-construction/topology/stroke-fitting.ts, diferente do caminho Rust das ruas. Auditar/migrar a matemática reutilizável ao Rust, sem criar uma terceira implementação JS.
8. Não migrar o armazenamento de todas as paredes para CurveHandles apenas para mostrar o gizmo. Já existe contourCurve/curveEdgesOf e commit de contorno. A mudança estrutural seria maior e não está justificada por esta pesquisa.

## Candidato específico de ajuste livre

[fit-curve](https://github.com/soswow/fit-curve) implementa o ajuste de cúbicas de Schneider e declara suporte 2D/3D. É candidato à dissecação por tratar diretamente o problema de aproximar um traço, diferente dos geradores viários acima. Nesta rodada foi verificada a apresentação do projeto, não feita auditoria do algoritmo/licença completa nem benchmark contra o Rust. Não instalar nem portar antes de fixar revisão, verificar a métrica de erro, licença e comparar os mesmos casos. O código de produção geométrica permanece em Rust.

## Limites e correção da pesquisa delegada

A chamada de pesquisa delegada expirou, mas posteriormente escreveu um relatório. A revisão identificou caminhos/versões não verificados, funções antigas atribuídas à revisão atual, promessa não demonstrada de atualização local, números arbitrários e proposta desnecessária de unificar armazenamento de paredes. Esse conteúdo foi substituído por este relatório conferido nas fontes primárias; não usar o rascunho como evidência.

Nenhum gerador foi instalado, código de terceiros copiado ou regra arquitetural alterada. Não houve validação visual nesta rodada. A fragmentação sintética foi reproduzida; a correção de produção ainda não foi aplicada.

## Próxima tarefa pronta para execução

Comparar fit_path atual com um ajuste aproximante de cúbicas em Rust sobre o conjunto acima, documentando curva resultante e erro final. Em paralelo de planejamento, desenhar a sessão genérica de autoria/edição usando CurveEdge, preservando commits de rua e parede. Esta pesquisa substitui a ideia de resolver o problema apenas ajustando tolerância ou adicionando mais gizmos.
