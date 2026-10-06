# Contrato de criação e edição de estruturas — #303

Contrato consolidado em 2026-10-06, após os refinamentos filhos de #303 e as decisões do dono para #349, #350 e #315. Este documento descreve a interação; `GRAFTING_MASTER_SOURCE.md` e as definições dos tipos continuam canônicos para arquitetura e comportamento executável.

## Regras comuns

- O tipo declara suas capacidades, escopo e reações. Ferramentas genéricas despacham essas declarações.
- Criação mostra preview; confirmação produz uma transação que inclui geometria, vínculos e reações. Desfazer opera sobre essa transação.
- Editar estruturas existentes exige alças. Os pontos do grafo e o corpo não são atalhos de edição.
- Espinhas têm uma faixa contínua selecionável acompanhando a curva, independente do debug, e alças com identidade separada dos nós. A faixa é uma malha de alça confirmada, não um preview: usa a identidade de edição do trecho, ganha destaque ao selecionar e permite arrastar a curvatura. Âncoras e controles de largura permanecem disponíveis.
- Os losangos dos vértices e do meio dos trechos coexistem com a faixa. Selecionar um trecho de rua ou um vértice expõe a alça de criação **+**, que inicia uma nova rua naquele ponto, com a cota da espinha selecionada. O preview e a confirmação usam o fluxo de construção existente; o grafo só ganha a ramificação ao confirmar e desfazer restaura a rua original. A capacidade é declarada por `branchCreation` no tipo e encaminhada pelo hook `startFrom` da ferramenta. Controles de tangente não são exibidos automaticamente.
- Na edição de ruas, arrastar uma ponta até outra ponta ou até o meio de um trecho permite conectar cotas diferentes: o encaixe usa a posição do cursor na altura da rua de destino. A junção só ocorre quando os trechos incidentes conseguem vencer esse desnível dentro do limite de inclinação declarado pelo tipo. Cruzamentos sem esse gesto continuam separados em alturas diferentes.
- Desconectar, apagar trecho e fechar são alças contextuais da espinha selecionada. Remover ponto usa Delete; largura tem alças de trecho e de extremidade.
- O painel lateral contém parâmetros do tipo. O painel genérico “Editar estrutura existente” foi removido.

## Tabela final desta etapa

| Tipo ou ferramenta | Criação e preview | Edição após criação | Escopo e auxiliares |
|---|---|---|---|
| Rua | Espinha por pontos ou traçado; preview da curva e da formação | Âncoras, meio do trecho, largura e largura no fim; ações contextuais | Contrato estrutural [#315](../research/vtt-road-structural-edit-contract.md); régua, encaixe e medidas da #317 |
| Rampa curva e espiral | Modos próprios de desenho sobre a espinha; preview de percurso e inclinação | Espinha, largura e ações comuns; alças do tipo para pontas, elevação, raio e voltas quando declaradas | Regras do tipo preservam cotas e vínculos de extremidade; sem ações pelo painel antigo |
| Rampa reta | Traçado entre extremos; preview da plataforma inclinada | Alças de forma e dos extremos declaradas pelo tipo | Vínculos com pisos; régua e medidas |
| Parede | Ferramenta com modos Reta e Curva; arraste cria contorno com preview | Curva, pés, topos, altura do trecho e alças do conjunto | Contornos usam o mesmo construtor e resolução de colunas; #310 e #349 |
| Muro | Ferramenta Muros no menu principal; pincel livre com parâmetros próprios | As mesmas alças da parede | Mesmo tipo de estrutura da parede; correção do traçado pelo pincel; #316 e #349 |
| Torre | Ferramenta própria que carimba contorno circular | Somente as alças da parede, incluindo contorno curvo | Mesmo tipo da parede; tamanho inicial por preset; #349 |
| Plataforma | Contorno retangular, circular, poligonal ou livre; preview do contorno | Alças do conjunto, lados, cantos e altura declaradas pelo tipo | Uma cota por face; vínculos e transporte do que sustenta |
| Telhado | Criação sobre plataforma; preview da cobertura | Alças e detalhes da receita de telhado, incluindo extensão e lucarna | Comportamento refinado na #311; depende de sua base |
| Abertura | Gesto restrito ao perímetro da parede; preview no hospedeiro | Alças de posição e formato, cantos e lados; Delete | Contrato do hospedeiro e fusão da #313 |
| Terreno | Ferramenta própria de escultura; preview do pincel | Pincel e regeneração estrutural existentes | A edição de terreno em andamento permanece com o dono; não é expandida nesta entrega |
| Demolir | Seleção direta com destaque somente da face apontada; arraste acumula faces | Sem raio; confirmação ao soltar; alças de edição ficam ocultas | Não expande para nuvem, gesto de criação ou faces hospedadas. Limpa elementos órfãos, preserva vértices, arestas e espinhas ainda usados por faces sobreviventes; reações e desfazer atômico; #291. Terreno usa a escavação da ferramenta Remover no contorno da face selecionada. |

A definição do tipo pode declarar `demolish(context)` para substituir a remoção padrão. O contexto contém a face apontada, o grafo, as faces que permanecerão e as operações `removeFace`, `replace` e `execute`, dentro da mesma transação. As duas variantes de terreno declaram `demolishTerrainRegion` em `organic-structure.ts`, que pede a ação `terrain-dig` ao dispatcher da composição. Essa ação usa `digTerrain`, a mesma função chamada por Terreno → Remover, com os parâmetros padrão de escultura, as amostras do cursor na face e o contorno dessa face. A substituição é realizada pelo executor existente e não recebe uma segunda reação de remoção genérica. O gesto inteiro continua sendo um único desfazer. Alterações futuras na ação de Remover devem acontecer em `digTerrain` para atingir ambos os caminhos.

## Partes do refinamento e destino

Pesquisa de interação: #309. Paredes: #310 e #349. Telhados: #311 e #312. Aberturas: #313. Curvas e espinhas: #314, #332 e #350. Ruas: #315. Pincel: #316 e ferramenta Muros da #349. Auxiliares: #317. Apresentação: #318 e #350. Não há parte desta etapa sem destino definido.

Materiais, assets e simulação de trânsito estão explicitamente fora do trabalho. Novas modalidades de geração de pontes, pilares e túneis também não são acrescentadas pelo refinamento estrutural da rua.
