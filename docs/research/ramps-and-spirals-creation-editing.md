# Rampas curvas e espirais: criação e edição

- Status: duas rodadas de pesquisa em 2026-09-25 (modelo; depois, controles de criação); decisões do dono aplicadas no TASK-333 (PR #334)
- Relacionado: `construction-elements-online-research.md` (escadas e rampas em geral), issue #303 (contrato de edição por tipo)

## Veredito

1. **Planta e altura são separadas.** A forma em planta é editada livremente; a altura vem só das duas pontas, e o meio é recalculado com uma inclinação constante pelo comprimento em planta. Nenhuma referência guarda altura por ponto de controle.
2. **A espiral é paramétrica:** centro, raio, ângulo inicial, voltas, altura inicial, subida e sentido. O plano é um arco circular exato, nunca uma curva automática por pontos.
3. **A criação é de um nível ao outro.** A altura final vem do piso onde a rampa termina, ou de uma subida fixa.
4. **Cálculo em Rust, gerenciamento em TS.** A hélice e a inclinação são comandos do lote de curvas (`helix`, `grade`), usando o `kurbo` que já está no motor. O TS cuida de tipos, papéis, alças e ferramentas.
5. **Não existe biblioteca pronta que cubra criação e edição.** A geometria é pouca matemática sobre o `kurbo`; o esforço está no tipo e na interação.
6. **A criação usa modos compartilhados**, iguais para qualquer tipo feito sobre espinha: por pontos, reta, arco, ligar pontas e espiral centro-início-fim.
7. **Cada trecho tem um tipo de geometria** (reta, arco ou bezier livre), guardado nas alças e respeitado no `resolve` do Rust. Assim uma reta ou um arco continuam exatos depois de editados.
8. **A estrutura é um marcador declarativo** da posição dos assets. Degraus, pisos de escada e corrimãos são dos assets; não viram parâmetro da estrutura, nem existe limite de inclinação.

## Diagnóstico do modelo anterior (medido no motor real)

- **A espiral não era uma espiral:** era a curva `automatic` passando por 8 pontos por volta. No raio 3 o raio real oscilava entre 2,865 e 3,000 (cerca de 4,5%), e eram 17 pontos para 2 voltas.
- **Altura por ponto:** a bezier interpolava a altura junto com a planta, então mexer na planta mudava a inclinação localmente.
- **Arrastar um ponto o levava à altura do que estava sob o mouse:** um ponto da segunda volta foi de y=2,25 para y=0. O gesto da rua usa a altura do pick, porque a rua segue o terreno.
- **O encaixe da rua valia para qualquer espinha:** um ponto da espiral podia grudar numa rua.
- **Não havia edição de nível da espiral:** raio, voltas e subida só mudavam movendo os pontos um a um.
- **A rampa curva livre ficou sem ferramenta** quando a rampa reta virou trapézio (primeira parte do PR #334).

## Referências

| Ferramenta | Criação | Edição | Lição |
|---|---|---|---|
| Revit, escada espiral | clique no centro e mova para o raio; uma dica mostra os degraus até o nível de destino; anti-horário por padrão | alça circular para o raio; *Flip* inverte o sentido | as voltas saem do nível de destino |
| Revit, rampa | caminho desenhado em planta com retas ou arcos | comprimento derivado dos níveis de base e topo e da inclinação máxima do tipo; comprimento máximo por lance | altura pelos níveis; inclinação é regra do tipo |
| AutoCAD, hélice | raio da base e do topo, altura, voltas ou altura por volta, sentido | alças para início, raios, altura e posição; a propriedade *Constrain* escolhe o que fica fixo (altura, voltas ou altura por volta) | parâmetros com alças e um parâmetro travado |
| Blender, curvas extras | espiral paramétrica: raio, altura, voltas | por parâmetros | hélice paramétrica |
| Cities: Skylines II | modos reto, curva simples e curva complexa; elevação relativa ao início | guias mostram a inclinação; acima do limite, erro "slope too steep" | elevação é um controle separado; retorno da inclinação |
| Planet Zoo / Coaster | caminho em planta; teclas U e J ou arrasto sobem e descem | vira escada acima de certa inclinação; "curved slopes" (tecla V) permite hélice | altura como gesto separado; escada automática por inclinação |
| The Sims 4 | escada puxada de um andar ao outro | "landings" dobram 90° ou 180° e sobem ou descem; sem espiral nativa | criação de andar a andar |
| Tiny Glade | ferramenta de escada nova, desenhada como parede | pouco material técnico público | não usado como fonte de regra |
| Unity-Procedural-Stair-Builder (MIT, C#), HammerForge (Godot) | espiral como arranjo radial com subida por cópia | por inspector | confirmam a hélice paramétrica; nenhum é reaproveitável na stack Rust/TS |

## Padrões comuns

- A altura vem dos níveis de início e destino, não dos pontos.
- Planta e elevação são controles separados; editar a planta recalcula só a inclinação.
- A espiral tem um parâmetro travado, e mudar outro recalcula o restante.
- A inclinação aparece enquanto se desenha; acima do máximo, é erro ou vira escada.
- Inverter o sentido é uma ação explícita.

## Segunda rodada: controles de criação

O primeiro modelo de criação da rampa curva era ruim: o preview ligava os cliques por retas, não havia números enquanto se desenhava, a regra da altura final era invisível, e não havia controle da direção nas pontas.

| Ferramenta | Controle | O que se aproveitou |
|---|---|---|
| Illustrator, Curvature tool | clique os pontos e a curva passa por eles, com preview vivo até o cursor; sem alças nem teclas | modo **por pontos** |
| SketchUp, 2 Point Arc | início, fim, e a barriga puxada perpendicular à corda; aviso de tangência | modo **arco**, e o arrasto do meio de um trecho reto ou em arco (vira o arco pelos 3 pontos) |
| Cities: Skylines II | modos reto, curva simples, curva complexa e contínuo; encaixe em 90°, guias e geometria; inclinação nas guias | modos explícitos e números ao vivo |
| Satisfactory, esteiras | modos Padrão, Reto e Curva, trocados com R; a Curva segue a posição **e a direção** das pontas; 35° de inclinação e 2 m de raio no máximo | modo **ligar pontas** e R para trocar; os limites não foram adotados (decisão 8) |
| Revit, Center-Ends Spiral | centro, início, e girar o cursor no sentido desejado até clicar o fim; *Flip* depois | modo **espiral**, que soma uma volta a cada círculo completo do cursor |
| Planet Coaster | Shift mais movimento do mouse sobe e desce em passos | Shift mais movimento vertical ajusta a subida em passos de 0,25 m |
| Tiny Glade, ferramenta de escada | pontos retos ou curvos; seta dupla na borda para a altura e seta lateral para a largura; reage a paredes, telhados e torres | referência para as alças embutidas da #318 |

## O que foi aplicado (TASK-333)

- **Rust, `grafting-graph-core::bezier_ramp`:**
  - `helix`: `kurbo::Arc` cortado em cúbicas, com altura linear no ângulo.
  - `grade`: redistribui as alturas de uma cadeia pelo comprimento em planta, medido com `ParamCurveArclen`, sem tocar a planta.
  - Os dois estão expostos como comandos `helix` e `grade` do lote de curvas.
- **TS, espinha da plataforma inclinada:** declara `planOnly`. O gesto de ponto mantém a altura do próprio ponto e não encaixa em outras redes; a altura só muda de propósito, no modo de elevação. A cada regeneração, `gradeSlopeSpans` recalcula a cadeia entre as pontas.
- **Tipo de geometria por trecho:** `SpanGeometry` (reta, ou arco com centro e sentido) fica em `CurveHandles.geometry`. `CurveHandles::resolve` no Rust reconstrói o trecho pela forma, e a malha, as fitas, o overlay e o TS passam todos por ele. Dividir um trecho mantém a forma nas duas metades. `helix` e `arcThrough` devolvem trechos de no máximo um quarto de volta, onde uma cúbica fica a cerca de 0,03% do círculo, com as pontas exatamente nos pontos pedidos.
- **Arrastar o meio de um trecho reto ou em arco** o transforma no arco pelos dois extremos e pelo cursor, via `arcThrough`. Um trecho livre continua sendo puxado como cúbica.
- **Soldas desligadas:** numa espinha `planOnly`, arrastar uma ponta não a solda em outro nó nem a transforma em junção, porque as voltas de uma espiral passam umas sobre as outras.
- **Controlador genérico** `tools/core/curve-draft.ts`, com os cinco modos, R para trocar, Backspace, Enter e Esc. A altura inicial vem do que o primeiro clique acertou; a final, do piso do último clique, ou da subida (ajustável com Shift). Os números aparecem ao vivo: comprimento, subida, inclinação e, na espiral, raio e voltas. Todo o cálculo é feito no Rust.
- **Ferramentas:** "Rampa curva" usa os cinco modos; "Espiral" é o mesmo controlador fixo no modo espiral. As duas editam depois pelo editor de espinha compartilhado.

## Pendente

- **Alças de nível da espiral:** anel do raio, *Flip* numa espiral já criada, e somar voltas girando a ponta além de um quarto de volta. Os trechos em arco já mantêm o centro ao serem editados; o resto depende dos componentes visuais da #318.
- **Rua nos modos novos:** o controlador é genérico, mas por enquanto só as rampas o usam. A ferramenta de rua tem desenho, ramificação e encaixe próprios, que ficam para a #324.
- **Continuar tangente a partir da ponta de uma espinha existente** ainda não é um encaixe.
- **Mover um piso soldado** leva a ponta da rampa junto, mas o meio só volta à inclinação constante na próxima edição da rampa.

## Fontes

- Revit, Full-Step Spiral Run: https://help.autodesk.com/view/RVTLT/2024/ENU/?guid=GUID-F521015D-1703-48EA-847D-184E6C277BDB
- RevitCat, Spiral and Curved Revit Stairs: http://revitcat.blogspot.com/2014/01/spiral-and-curved-revit-stairs.html
- Revit, Add a Ramp: https://help.autodesk.com/cloudhelp/2026/ENU/Revit-ArchDesign/files/GUID-3CCCB8E9-2ABB-495D-8B3E-079A4986D65C.htm
- AutoCAD, About Modifying Helixes: https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-2410D64F-DD39-4F41-BABC-6FE557B516D9.htm
- Blender, Add Curve Extra Objects: https://docs.blender.org/manual/en/3.3/addons/add_curve/extra_objects.html
- Cities: Skylines II, Road Tools: https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools
- Planet Zoo, elevated paths and stairs: https://steamcommunity.com/app/703080/discussions/0/1628539187774173761/
- PC Gamer, Sims 4 custom stairs: https://www.pcgamer.com/sims-4-custom-stairs-build/
- PC Gamer, Tiny Glade stairs: https://www.pcgamer.com/games/city-builder/cozy-castle-builder-literally-hits-next-level-as-tiny-glade-announces-stairs-its-biggest-and-most-complicated-change-yet/
- Unity-Procedural-Stair-Builder: https://github.com/GregFrench/Unity-Procedural-Stair-Builder
- HammerForge PR #187: https://github.com/saworbit/hammerforge/pull/187
- Revit, Center-Ends Spiral Run: https://help.autodesk.com/cloudhelp/2019/ENU/Revit-Model/files/GUID-4E05115C-84C9-4930-95FB-E8B91219B1E6.htm
- Satisfactory Wiki, Conveyor Belts: https://satisfactory.wiki.gg/wiki/Conveyor_Belts
- Creativepro, Curvature Tool in Illustrator: https://creativepro.com/curvature-tool-adobe-illustrator/
- SketchUp, Drawing Arcs: https://help.sketchup.com/en/sketchup/drawing-arcs
- CS2 Wiki, Editor: Snapping and Tool Modes: https://cs2.paradoxwikis.com/Editor:_Snapping_and_Tool_Modes
- Planet Coaster, building snap to path/grid: https://steamcommunity.com/app/493340/discussions/0/1368380934282271935/
- 80.lv, Tiny Glade stair tool: https://80.lv/articles/you-can-finally-make-stairs-easily-in-tiny-glade
- kurbo Arc: https://docs.rs/kurbo/0.13.1/kurbo/struct.Arc.html
- kurbo ParamCurveArclen: https://docs.rs/kurbo/0.13.1/kurbo/trait.ParamCurveArclen.html
