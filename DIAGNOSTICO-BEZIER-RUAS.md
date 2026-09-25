# Diagnóstico executado — editor Bézier e ruas

> Atualização: o usuário aprovou reinterpolação. A correção da autoria e a integração do TransformControls foram implementadas depois deste diagnóstico. Consulte a seção inicial do HANDOFF-BEZIER-RUAS.md para estado e verificações atuais. Os resultados abaixo descrevem a base anterior e servem como reprodução do comportamento corrigido.

Data: 2026-09-23. Base: `415c625f`, worktree `TASK-320-BEZIER-CREATE-EDIT`, PR #323 aberto.
Este relatório registra trabalho executado depois do plano inicial. Nenhuma alteração de produto foi feita nesta rodada.

## Resultado principal: criar e mover usam políticas diferentes

Reprodução executada pelo ia-graft com a sessão WASM real:
1. Selecionar o modo Por pontos, largura 0,6.
2. Criar âncoras XYZ (-10,0,0), (0,0,4), (10,0,0) e confirmar.
3. Mover a âncora intermediária para (1,0,6).
4. Resolver os cúbicos persistidos e comparar com uma nova chamada `automatic` sobre os três pontos atualizados.

Resultado observado:
- modos dos dois trechos antes: `free, free`;
- modos depois: `free, free`;
- âncora movida corretamente para `[1,0,6]`;
- maior diferença absoluta em uma coordenada dos controles em relação à reinterpolação: `0.666666666666667`;
- criação e edição confirmaram sucesso, sem erro.

A diferença não é tolerância numérica: a criação calcula uma cadeia centrípeta e depois armazena cúbicas livres. A edição preserva vetores relativos de controle em vez de recalcular a interpolação. Isso confirma uma diferença em relação ao comportamento esperado de um editor de spline por pontos; não prova sozinho a origem de todas as reclamações de estabilidade.

### Caminho confirmado no código

- `apps/vtt/src/composition/tabletop/tools/paths/path-points-tool.ts:19`: função curves usa comando automatic, mas devolve apenas curves.
- `apps/vtt/src/features/edit-construction/structure-types/path/bezier-road-plan.ts:74`: cúbicas fornecidas entram pelo comando sample; fitted.handles é persistido.
- `libs/graph/core/src/bezier_commands.rs:256`: handles derivados recebem HandleMode::Free por padrão.
- `apps/vtt/src/features/edit-construction/spine/spine-edit-plan.ts:110`: recalcula apenas arestas cujo mode já é automatic.
- `libs/graph/core/src/bezier.rs:89`: resolve soma vetores de controle relativos às âncoras atuais.

### Decisão solicitada ao usuário nesta rodada

Decisão confirmada pelo usuário: **recalcular pelos pontos, como no Three.js**. Aplicar às novas ruas criadas no modo Por pontos; preservar desenho livre e dados antigos. Implementação em andamento; conferir o estado final no handoff antes de assumir que já foi aplicada.

Caso o usuário escolha recalcular:
- rastrear a política de autoria desde a criação até o grafo; não alterar globalmente o retorno de sample para automatic;
- separar autoria por pontos de desenho livre; não converter curvas livres antigas ao carregá-las;
- preservar bandOffsets, endBandOffsets e surfaceType;
- verificar subdivisão exata: inserir ponto deve inicialmente preservar a forma, e decidir qual política vale no movimento posterior;
- testar remoção, extremidades, cadeia com junção e coexistência de trechos livres/automáticos;
- conferir se o recálculo por componente atual muda vizinhos além do esperado antes de ampliá-lo;
- usar o caso numérico acima como teste de integração de comportamento, além dos testes existentes.

## Integração do manipulador: detalhes descobertos

Versão declarada localmente: three e @types/three 0.182.0.

No backend atual:
- `create-backend.ts:291`: draw resolve a câmera da superfície; renderiza num buffer compartilhado e copia para o canvas de apresentação.
- `create-backend.ts:82`: a chave da câmera contém projeção e dimensões. Resize pode substituir a instância; o manipulador deve receber a câmera atualizada.
- `create-backend.ts:337`: pick usa uma câmera temporária, não a instância persistente da superfície.
- `backend/contract.ts`: não há contrato atual de manipulador.
- `camera/orbit.ts` e `render-3d-scene-adapter.ts:460`: a aplicação usa attachOrbit próprio, não OrbitControls da demo.

Consequências para a implementação proposta:
1. Manipulador pertence à visualização/superfície, não a um singleton global de cena. Não deve aparecer em outras views ao compartilhar o buffer.
2. O alvo é um proxy pertencente à cena Three, ligado à posição de uma âncora Grafting; não se exporta Object3D.
3. O elemento de entrada é o da apresentação correta, não automaticamente o canvas WebGL interno.
4. Atualizar a câmera do manipulador quando ela for substituída; resize/projeção deve ter regressão.
5. Escolher um único dono dos eventos; coordenar gizmo, ferramenta e câmera. Não conectar ouvintes concorrentes sem contrato de captura.
6. Eventos alteram preview; somente término válido confirma uma transação. Cancelamento restaura o proxy e os controles.
7. Mudanças do helper devem invalidar a view pelo agendamento existente; sem requestAnimationFrame adicional.
8. Destruir view/alvo, perder contexto ou cancelar gesto exige cleanup testável.
9. Aparência e restrição de movimento vêm do consumidor; não introduzir política de rua no pacote.

Fonte de API verificada na versão r182: [TransformControls.js](https://github.com/mrdoob/three.js/blob/r182/examples/jsm/controls/TransformControls.js). A classe requer alvo na cena, expõe camera/getHelper e eventos de mudança; connect instala ouvintes e modifica touchAction, enquanto disconnect restaura auto. A adaptação precisa preservar o valor anterior da aplicação. A licença/revisão exata de qualquer trecho copiado ainda deve ser registrada.

Não foi implementado um contrato público nesta rodada: os nomes e assinaturas precisam ser revisados com o desenho da arbitragem e a política de movimento.

## Geometria de faixa: fatos locais

`libs/graph/core/src/bezier_surface.rs` já possui:
- ribbon/ribbon_profile: faixa com offsets e amostragem;
- ribbon_profile_at: parâmetros explícitos ordenados, permitindo reaproveitar seções;
- validação de offsets finitos/ordenados e parâmetros válidos;
- tangente unilateral para controles colapsados em extremidades;
- rejeição de tangente estacionária sem direção XZ;
- union_ribbons para união planar.

O próprio contrato documenta que offsets brutos podem sobrepor em curvas apertadas. Não atribuir à interpolação centrípeta garantia sobre a validade da faixa. Antes de portar algoritmos externos, comparar esses recursos existentes com a falha reproduzida.

## Verificações executadas

Comando via graft_task_test:
`node --experimental-strip-types --test apps/vtt/test/curve-pen-session.test.mjs`

Resultado nesta rodada: **11 testes passaram, 0 falhas**, duração reportada 468,2764 ms. Cobre criação, cancelamento, rollback, movimento com amostra final, inserção, remoção, corpo da rua, desenho livre e undo. Não comprova visual, estabilidade do mouse real ou desempenho.

A reprodução numérica adicional também executou com sucesso via graft_task_test, sem gravar cena do usuário ou alterar código.

## Limitações reais e tarefas ainda abertas

- Consulta cua.getState retornou apps=[] e browsers=[]. Não houve inspeção visual, gravação ou reprodução por mouse. Baseline visual permanece pendente.
- Pesquisa delegada via graft_delegate_research para RESEARCH-ROAD-ALGORITHMS.md expirou após 120 s. O arquivo não existia quando verificado. Não houve dossiê verificável de Godot/Road Architect nesta rodada; não declarar #328 concluída.
- A criação de gizmos não foi iniciada: falta fechar o contrato de gesto/restrição e validar no navegador.
- Nenhuma issue/PR foi encerrada ou marcada como concluída.

## Próxima retomada sugerida

1. Ler a resposta do usuário sobre reinterpolação; atualizar a decisão no handoff.
2. Reproduzir o caso acima e acrescentar regressão apropriada quando a política estiver definida.
3. Implementar apenas a preservação dessa política de autoria, se autorizada, sem migrar todas as curvas.
4. Integrar o manipulador pela superfície/view, com arbitragem de câmera e lifecycle.
5. Retomar a dissecação externa com resultados verificáveis, depois ligar qualquer adaptação a uma falha concreta.
6. Validar visualmente na build da worktree antes de encerrar.

## Script da reprodução (diagnóstico, não teste de aceitação)

Executar pela ferramenta de verificação ia-graft, na raiz desta worktree, com Node em modo module e experimental-strip-types. Não usar os resultados históricos como se fossem da próxima revisão.

```javascript
const {sessionFixture}=await import('./apps/vtt/test/platform-session-fixture.mjs');const {pathBrushTool:t}=await import('./apps/vtt/src/composition/tabletop/tools/paths/path-brush-tool.ts');const f=sessionFixture();f.runtime.showPreview=()=>{};f.runtime.clearPreview=()=>{};f.runtime.getFootprintCoverage=()=>[];f.ctx.reportSelection=()=>{};const p={...t.defaultParams(),creationMode:'points',bedWidth:0.6};const s=(x,z)=>({point:{x,y:0,z}});const g=(a,b)=>({start:a,current:b,samples:[a,b]});try{for(const a of [s(-10,0),s(0,4),s(10,0)]){t.onPointerDown(f.ctx,a,p);t.onPointerUp(f.ctx,g(a,a),p);}t.onKeyDown(f.ctx,'Enter',p);const before=f.runtime.getGraphSnapshot().edges.filter(e=>e.curve);const a={...s(0,4),nodeId:before[0].endNodeId};const b=s(1,6);t.onPointerDown(f.ctx,a,p);t.onPointerUp(f.ctx,g(a,b),p);const snapshot=f.runtime.getGraphSnapshot();const es=snapshot.edges.filter(e=>e.curve);const nodes=new Map(snapshot.nodes.map(n=>[n.id,[n.position.x,n.position.y,n.position.z]]));const actual=f.runtime.curveBatch({tolerance:0.025,commands:es.map(e=>({kind:'resolve',handles:e.curve,start:nodes.get(e.startNodeId),end:nodes.get(e.endNodeId)}))}).map(r=>r.curves[0]);const expected=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:'automatic',points:[[-10,0,0],[1,0,6],[10,0,0]]} ]})[0].curves;const maxDelta=Math.max(...actual.flatMap((c,i)=>c.points.flatMap((v,j)=>v.map((x,k)=>Math.abs(x-expected[i].points[j][k])))));console.log(JSON.stringify({modesBefore:before.map(e=>e.curve.mode),modesAfter:es.map(e=>e.curve.mode),movedPoint:nodes.get(a.nodeId),maxControlCoordinateDifferenceFromReinterpolation:maxDelta,feedback:f.calls.feedback}));}finally{t.onCancel(f.ctx);f.session.free();}
```
