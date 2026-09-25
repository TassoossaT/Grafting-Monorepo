# Rampas curvas e espirais: criação e edição

- Status: pesquisa consolidada em 2026-09-25; decisões do dono aplicadas no TASK-333 (PR #334)
- Relacionado: `construction-elements-online-research.md` (escadas e rampas em geral), issue #303 (contrato de edição por tipo)

## Veredito

1. **Planta e altura são separadas.** A forma em planta é editada livremente; a altura vem só das duas pontas, e o meio é recalculado com uma inclinação constante pelo comprimento em planta. Nenhuma referência guarda altura por ponto de controle.
2. **A espiral é paramétrica:** centro, raio, ângulo inicial, voltas, altura inicial, subida e sentido. O plano é um arco circular exato, nunca uma curva automática por pontos.
3. **A criação é de um nível ao outro.** A altura final vem do piso onde a rampa termina, ou de uma subida fixa.
4. **Cálculo em Rust, gerenciamento em TS.** A hélice e a inclinação são comandos do lote de curvas (`helix`, `grade`), usando o `kurbo` que já está no motor. O TS cuida de tipos, papéis, alças e ferramentas.
5. **Não existe biblioteca pronta que cubra criação e edição.** A geometria é pouca matemática sobre o `kurbo`; o esforço está no tipo e na interação.

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

## O que foi aplicado (TASK-333)

- **Rust, `grafting-graph-core::bezier_ramp`:**
  - `helix`: `kurbo::Arc` cortado em cúbicas, com altura linear no ângulo.
  - `grade`: redistribui as alturas de uma cadeia pelo comprimento em planta, medido com `ParamCurveArclen`, sem tocar a planta.
  - Os dois estão expostos como comandos `helix` e `grade` do lote de curvas.
- **TS, espinha da plataforma inclinada:** declara `planOnly`. O gesto de ponto mantém a altura do próprio ponto e não encaixa em outras redes; a altura só muda de propósito, no modo de elevação. A cada regeneração, `gradeSlopeSpans` recalcula a cadeia entre as pontas.
- **Ferramenta Espiral:** clique no centro usa o raio do painel; arrastar do centro define o raio e o ponto de partida. Há também *Inverter sentido*. O plano vem do comando `helix`.
- **Ferramenta Rampa curva:** pontos em planta, fechada com Enter ou clicando de novo no último ponto. A altura final vem do piso do último clique, ou da subida do painel. Pontas numa borda de piso são soldadas.
- **Mensagens:** informam a inclinação resultante.

## Pendente

- **Espiral com alças paramétricas:** anel do raio, ponta que soma voltas, topo, *Flip* numa espiral já criada, e o parâmetro travado. Hoje a espiral criada é editada como rampa curva, por pontos em planta, e deixa de ser uma hélice exata depois de editada. Depende dos componentes visuais da #318 e de guardar os parâmetros.
- **Mover um piso soldado** leva a ponta da rampa junto, mas o meio só volta à inclinação constante na próxima edição da rampa.
- **Inclinação máxima, e virar escada acima dela:** valor e comportamento a decidir.
- **Degraus:** ainda sem parâmetro.

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
- kurbo Arc: https://docs.rs/kurbo/0.13.1/kurbo/struct.Arc.html
- kurbo ParamCurveArclen: https://docs.rs/kurbo/0.13.1/kurbo/trait.ParamCurveArclen.html
