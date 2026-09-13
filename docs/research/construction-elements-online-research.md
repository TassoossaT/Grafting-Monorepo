# Construção procedural: telhados, pisos, divisórias, escadas e rampas

## Síntese

Existem boas referências públicas para cada parte de um editor de construção, mas as soluções examinadas atendem a objetivos diferentes. Algumas privilegiam desenho expressivo, outras plantas utilizáveis, outras modelagem paramétrica precisa. Nenhuma das fontes consultadas demonstrou uma biblioteca pronta que reúna todos esses comportamentos e possa ser incorporada diretamente ao modelo de superfícies do Grafting.

Para as issues #232, #233, #234 e #236, a principal conclusão é separar três escolhas: a experiência de edição, o planejamento dos espaços e a geração da geometria. Uma biblioteca de triangulação ajuda a desenhar um piso; não decide onde deve existir uma escada. Um gerador de telhados produz inclinações e encontros; não define sozinho o comportamento de uma construção quando o usuário move uma parede.

As referências mais úteis para a discussão são:

| Necessidade | Referências prioritárias | O que observar |
|---|---|---|
| Desenho direto e adaptação ao contexto | Tiny Glade | Caminhos editáveis, encaixes e transições entre elementos |
| Construção para mapas com vários pavimentos | Dungeon Alchemist | Relação entre cômodos, telhados, escadas e aberturas |
| Controle simples de níveis | Sweet Home 3D | Elevação, altura, espessura e visibilidade por andar |
| Componentes paramétricos | Archipack e FreeCAD | Parâmetros separados, recortes e vínculo com a forma de origem |
| Telhados sobre contornos irregulares | CGAL e CityEngine | Esqueleto de telhado, planos inclinados, beiral e classificação das faces |
| Plantas internas com critérios explícitos | Merrell et al., Infinigen Indoors e Graph2Plan | Cômodos, conexões, restrições e avaliação de alternativas |
| Geração para exploração em jogos | Edgar | Controle de portas, corredores, ramificações e caminhos alternativos |

**Recomendação de investigação, ainda não uma decisão de implementação:** estudar um fluxo assistido no qual o usuário fixa o contorno, os níveis e alguns elementos importantes; os geradores oferecem resultados editáveis. Comparar esse fluxo com geração inteiramente automática e com desenho manual antes de fechar o escopo.

## Escopo e qualidade da evidência

O levantamento cobre ferramentas, documentação de APIs, repositórios dos autores, artigos de pesquisa e bibliotecas de conteúdo. As fontes online foram consultadas em 12 de setembro de 2026. Referências antigas são usadas para explicar métodos, sem presumir compatibilidade com versões atuais. Páginas de documentação e repositórios sem data editorial são identificados pela versão quando disponível.

As funcionalidades de produtos descritas aqui são documentadas pelos respectivos desenvolvedores. Não foram realizados testes interativos desses aplicativos, instalação de bibliotecas ou benchmarks no Grafting. Compatibilidade com WebAssembly, robustez numérica e preservação de identidade precisam de validação posterior nos candidatos selecionados. Métricas de desempenho publicadas por autores não foram convertidas em promessas de desempenho para este projeto.

As recomendações e os exemplos de comportamento são análises deste relatório. Não constituem aprovação de tecnologia, adoção de dependências, alteração das issues ou encerramento de decisões arquiteturais.

## 1. Vocabulário que ajuda a delimitar o produto

**Contorno ou footprint** é a área vista de cima que será usada como entrada para um gerador. Pode representar a parte interna das paredes, seu eixo ou sua borda externa. Esses três contornos não são equivalentes quando existe espessura.

**Piso, laje e teto** também não são necessariamente o mesmo elemento. Piso pode ser a superfície pisável ou o revestimento; laje pode incluir espessura e faces laterais; teto pode ser a face inferior dessa laje ou uma superfície independente. Um mezanino pode ter piso sem cobrir todo o ambiente abaixo.

**Água do telhado** é uma face inclinada. Cumeeira é o encontro alto; vale ou rincão é um encontro que conduz a água para uma região baixa; beiral é a projeção além da parede. Saber essas funções permite oferecer controles claros, sem expor vértices de malha ao usuário.

**Lance de escada** é uma sequência de degraus; patamar é o trecho aproximadamente horizontal entre lances. Piso do degrau é a parte horizontal e espelho é a face vertical. Corrimão, guarda-corpo, apoios e acabamento podem ter parâmetros próprios.

**Adjacência e acesso** precisam ser distintos no modelo de uma planta. Dois cômodos podem compartilhar uma parede sem haver porta. Um corredor ocupa área; não é apenas uma linha indicando conexão. Essa distinção é explícita na explicação do autor do Edgar e é essencial para avaliar plantas destinadas a exploração. [Edgar: explicação do algoritmo](https://ondra.nepozitek.cz/blog/graph-based-dungeon-generator-basics-1/).

## 2. Ferramentas existentes e lições de interação

### Tiny Glade

A atualização oficial de 29 de julho de 2025 documenta uma ferramenta de escadas construída por pontos editáveis, também pensada para pontes e passarelas. Inclinação influencia transições para plataformas e escadas de mão; existem encaixes em paredes e telhados planos, adaptação ao redor de torres e patamares em cantos. Cores e guarda-corpos são configuráveis. [Anúncio oficial](https://steamcommunity.com/app/2198150/announcements/).

**Aplicação ao Grafting:** é uma referência forte para desenhar um percurso e deixar o sistema completar detalhes. Vale observar especialmente a comunicação visual de um ponto preso a outro elemento e a possibilidade de soltá-lo. A mesma referência não demonstra, por si só, um planejador de interiores, regras de circulação ou integração com a autoridade geométrica do Grafting.

### Dungeon Alchemist

A atualização de 10 de julho de 2025 introduziu construção em vários níveis e telhados, com seleção de andar e controles de estilo. As escadas passaram a conectar pavimentos e abrir o piso superior automaticamente. O próprio anúncio reconheceu uma redução de flexibilidade das escadas nessa mudança. [Fun with Objects, Part 1](https://www.dungeonalchemist.com/post/fun-with-objects-part-1-is-out-now).

Uma atualização posterior, em março de 2026, registra correções para telhados complexos e construção multinível, além de um controle para desativar a geração de telhados em novos cômodos. Isso sustenta tratar geração automática como comportamento configurável. [Fine Print Patch](https://www.dungeonalchemist.com/post/the-fine-print-patch-is-out-now).

**Aplicação ao Grafting:** a integração entre escada e vão é uma referência especialmente próxima. A lição é oferecer conveniência sem tornar obrigatório um único vínculo entre todos os elementos. A alegação promocional de que um algoritmo de telhado não existia não deve ser interpretada como inexistência de pesquisa anterior: a literatura de straight skeleton é muito anterior.

### Sweet Home 3D

O guia oficial organiza a edição por níveis com elevação, altura e espessura de piso. Permite níveis subterrâneos e mostra elementos de outros andares de forma atenuada para auxiliar o desenho. Paredes e ambientes têm controles separados. [Guia de uso](https://www.sweethome3d.com/users-guide/).

O tutorial de escadas explica o ajuste da altura para alcançar o piso superior e a personalização da forma de recorte no teto. [Personalização de escadas](https://www.sweethome3d.com/blog/how-to-customize-staircases/).

**Aplicação ao Grafting:** usar elevações explícitas pode tornar compreensíveis andares, porões e meios-níveis. A interface pode apresentar níveis sem exigir que toda a geometria seja limitada a alturas discretas. A escolha entre esses modelos permanece aberta.

### Archipack

A documentação 2.0 apresenta escadas com formas I, L, U, O e formas próprias, compostas por partes retas, curvas e patamares. Também documenta lajes derivadas de curvas ou paredes, recortadores de piso/laje e telhados com inclinação, partes e acabamento separado. [Objetos Archipack](https://blender-archipack.gitlab.io/user/archipack%20objects.html).

**Aplicação ao Grafting:** um catálogo de formas pode usar os mesmos parâmetros fundamentais, em vez de criar sistemas independentes para cada formato. O detalhamento deve poder ser separado da geometria principal. É necessário distinguir a documentação 2.0 do repositório público consultado, que se identifica como versão para Blender 2.79; a existência deste código não comprova a disponibilidade de todas as funções atuais. [Repositório público](https://github.com/s-leger/archipack).

### FreeCAD e Bonsai

O documento Arch Roof descreve um telhado paramétrico vinculado ao contorno de origem, com propriedades por face e possibilidade de base sólida para formas especiais. A documentação Arch Stairs organiza escadas em lances e patamares. O espelho consultado desses documentos foi arquivado em abril de 2026; serve como referência de modelagem, não como garantia de interface atual. [Arch Roof](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Arch_Roof.md), [Arch Stairs](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Arch_Stairs.md).

Bonsai documenta aberturas, operações booleanas e conexões entre elementos como relações inspecionáveis. Sua página específica de criação de lajes ainda está incompleta. [Geometria e materiais](https://docs.bonsaibim.org/reference/geometry_and_materials/index.html), [Create Slab](https://docs.bonsaibim.org/reference/toolbar/slab.html).

**Aplicação ao Grafting:** distinguir a geometria resultante das relações de edição que a produziram. Essa é uma referência conceitual; importar um modelo BIM completo seria uma escolha muito maior do que as quatro issues.

### CityEngine e Houdini

CityEngine documenta operações de telhado com controle por inclinação ou altura e parâmetros de beiral. Sua classificação de componentes diferencia topo, lados e base. Houdini Labs documenta geração a partir de volumes simples, organização por pavimentos, módulos e substituições locais. [CityEngine roofHip](https://esri.github.io/cityengine-sdk/html/cgaref/cgareference/op_roofHip.html), [classificação das faces](https://esri.github.io/cityengine-sdk/html/cgaref/cgareference/cga_componentTags.html), [Houdini Building Generator](https://www.sidefx.com/docs/houdini/nodes/sop/labs--building_generator-4.0.html).

**Aplicação ao Grafting:** forma principal, subdivisão e distribuição de detalhes devem poder evoluir separadamente. Essas ferramentas são referências de fluxo procedural; não são uma justificativa para substituir o núcleo Rust por seus runtimes.

## 3. Telhados: quais problemas existem por trás dos quatro nomes

A issue #232 pede duas águas, quatro águas, plano e cônico, com inclinação e beiral. Em um retângulo isolado esses nomes parecem suficientes; em plantas em L, pátios e torres anexadas surgem decisões adicionais.

| Família | Entrada mínima proposta | Decisão que continua necessária |
|---|---|---|
| Plano | Contorno e elevação | Espessura, borda e relação com o teto |
| Duas águas | Contorno, orientação da cumeeira e inclinação/altura | Quais lados são empenas; como tratar uma planta em L |
| Quatro águas | Contorno e inclinação, eventualmente por borda | Vales, cumeeiras e regiões muito estreitas |
| Cônico | Centro, contorno circular, base e altura | Cone exato ou cobertura facetada; encontro com outra cobertura |
| Combinação de volumes | Mais de uma área ou eixo | Recortar, fundir ou manter telhados independentes |

Essas entradas são uma proposta de delimitação. Material como telha cerâmica ou madeira não determina a família geométrica: um mesmo perfil deve poder receber mais de um revestimento.

### Straight skeleton

O método imagina as bordas de um polígono avançando para dentro. As trajetórias dos encontros formam uma estrutura usada para derivar as faces do telhado. CGAL documenta polígonos com furos, pesos por borda e extrusão do esqueleto. A entrada é formada por segmentos retos: suporte a polígonos complexos não equivale a suporte analítico a arcos de torre. [Manual CGAL](https://doc.cgal.org/latest/Straight_skeleton_2/index.html).

A API de extrusão documenta pesos ou ângulos e altura máxima. Também distingue condições especiais de extrusão vertical e informa possíveis autointerseções não locais em determinadas configurações com limitação de altura. Portanto, a descrição geral de malha fechada não substitui as pré-condições específicas. [API de extrusão](https://doc.cgal.org/latest/Straight_skeleton_2/group__PkgStraightSkeleton2Extrusion.html).

O trabalho de Held e Palfrader, de 2016, explica pesos aditivos e multiplicativos para faces com inclinações ou alturas iniciais distintas. É relevante se o objetivo incluir coberturas compostas mais expressivas, mas não obriga a implementar todas essas variantes de início. [Artigo](https://arxiv.org/abs/1604.03362).

**Avaliação:** é um candidato forte para cobertura automática de plantas poligonais. Não decide sozinho o estilo preferido, a orientação desejada de uma cumeeira nem como preservar intervenções do usuário quando a topologia muda.

### Perfis e cumeeiras definidos pelo usuário

Outra abordagem começa por uma direção ou linha de cumeeira e constrói as faces em torno dela. A documentação do FreeCAD mostra o valor de propriedades por face, enquanto CityEngine oferece uma referência de controles por altura/inclinação. [FreeCAD](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Arch_Roof.md), [CityEngine](https://esri.github.io/cityengine-sdk/html/cgaref/cgareference/op_roofHip.html).

**Avaliação:** esse caminho oferece maior previsibilidade artística. Uma casa comprida pode manter a cumeeira na direção escolhida, mesmo quando recebe uma extensão. Em contrapartida, a divisão em partes e a união das coberturas passam a ser parte explícita da experiência.

As duas abordagens podem coexistir: geração automática para propor uma solução e controles para orientar suas partes. Essa combinação exige definir o que permanece editável, e não apenas adicionar um botão de regenerar.

### Beiral, torres e triangulação

Beiral deve ter uma medida claramente definida. CityEngine mede seu parâmetro sobre o plano do telhado, perpendicular à borda; medir a projeção horizontal produziria outro resultado para o mesmo número. Essa diferença precisa ser resolvida na especificação de produto. [Definição de overhang](https://esri.github.io/cityengine-sdk/html/cgaref/cgareference/op_roofHip.html).

Para torres, a recomendação de estudo é separar o caso circular regular do caso arbitrário. Um cone paramétrico regular pode preservar a forma circular sem converter a construção inteira em muitos segmentos. Já um contorno irregular em torno de um ápice pode exigir recorte ou decomposição; unir todos os vértices a um centro não é uma solução geral para polígonos côncavos.

Triangular uma superfície existente também não resolve a escolha do perfil. Se os triângulos atravessam lados com alturas incompatíveis, a malha pode torcer ou criar mudanças de inclinação indesejadas. O gerador precisa definir as faces ou a função de altura antes da tesselação. Esta é uma exigência geométrica proposta para a avaliação, não uma recomendação de biblioteca específica.

### Casos que distinguem uma solução simples de uma abrangente

Uma avaliação útil deve incluir retângulo, planta em L, planta com pátio, torre circular, anexo mais baixo e paredes com alturas diferentes. Para cada caso, comparar o resultado automático e a quantidade de correções necessárias. A forma final deve continuar editável por inclinação, beiral e orientação, sem depender de refazer manualmente uma malha inteira.

## 4. Pisos e tetos: área, nível e abertura

A issue #233 é mais ampla do que preencher um polígono. Ela envolve geração opcional, altura arbitrária e vãos. Os produtos examinados oferecem referências distintas: Sweet Home 3D enfatiza níveis; Archipack enfatiza contornos e recortadores; Bonsai enfatiza relações entre elementos. [Sweet Home 3D](https://www.sweethome3d.com/users-guide/), [Archipack](https://blender-archipack.gitlab.io/user/archipack%20objects.html), [Bonsai](https://docs.bonsaibim.org/reference/geometry_and_materials/index.html).

### Três modelos a comparar

| Modelo | Experiência | Vantagem | Limitação a discutir |
|---|---|---|---|
| Superfície independente | Desenhar uma área e escolher sua altura | Mezaninos e plataformas livres | Mais trabalho para manter relação com paredes |
| Superfície derivada de paredes | Clicar no recinto e gerar | Rapidez e coerência com o contorno | Precisa definir como reage a alterações nas paredes |
| Nível com áreas associadas | Escolher o andar e desenhar suas áreas | Organização e edição de vários pavimentos | Não pode presumir que um andar ocupa todo o edifício |

**Análise:** combinar nível como referência de edição com superfícies locais é uma possibilidade promissora. Isso permitiria organizar o prédio sem impedir plataformas intermediárias. A estrutura persistida dessa relação precisa respeitar a arquitetura do Grafting; este relatório não a define.

### Espessura e lado inferior

O controle precisa esclarecer se a altura representa a face superior, a inferior ou o plano de referência. Mudar a espessura não deve deslocar inesperadamente a chegada da escada. Outro ponto é permitir piso sem teto e teto sem piso correspondente, como em ambientes abertos ou coberturas independentes.

Há uma diferença de escopo entre uma superfície sem espessura e uma laje volumétrica. A primeira pode bastar para determinadas interações; a segunda exige bordas visíveis, acabamento nos furos e coerência entre as duas faces. A decisão deve ser explícita, pois influencia tanto a aparência quanto futuras consultas espaciais.

### Vãos de escada, pátios e mezaninos

A abertura precisa fazer parte da área válida da superfície. Pintar uma região escura ou apenas ocultar triângulos não fornece a mesma informação para seleção e consultas. Operações booleanas de polígonos podem derivar o contorno com furos; uma etapa posterior gera a malha. [iOverlay](https://github.com/iShape-Rust/iOverlay).

Um vão pode ser desenhado manualmente ou proposto pela escada. No segundo caso, há questões de edição: mover a escada move também o vão? Excluir a escada fecha o piso? Dois lances usam o mesmo vão? Preservar uma abertura manual é diferente de remover automaticamente uma abertura derivada.

**Proposta para discussão:** apresentar a abertura junto da prévia da escada e permitir confirmar a relação. A automação não deve presumir que toda interseção significa autorização para cortar qualquer superfície.

## 5. Divisórias: alternativas de algoritmo e significado de uma planta boa

A nota local 0008 identifica dois problemas de desenho do gerador anterior: produção de superfícies desnecessárias e recriação do perímetro externo. Ela também solicita uma definição do resultado desejado antes da troca do algoritmo. A pesquisa confirma que apenas substituir o flood-fill não resolve a ausência de critérios de qualidade. [Nota 0008](../../apps/vtt/notes/0008-region-partition-needs-rework.md).

### O que as pesquisas relevantes demonstram

**Merrell, Schkufza e Koltun, 2010.** O trabalho parte de requisitos de alto nível, produz um programa de ambientes com tamanhos e relações e utiliza otimização estocástica para construir plantas de vários pavimentos. Sua contribuição relevante é a separação entre necessidades, planta e construção 3D. O foco é plausibilidade residencial, não garantia universal de qualidade para qualquer edifício. [Artigo original, cópia acadêmica](https://www.cs.princeton.edu/courses/archive/spr11/cos598A/pdfs/Merrell10a.pdf).

**Graph2Plan, 2020.** Combina o contorno do edifício com um grafo de ambientes ajustável pelo usuário. A implementação pública trabalha com resultados rasterizados e caixas de cômodos e documenta pós-processamento para alinhamento e sobreposições, com dependências como Python, PyTorch e MATLAB. É uma referência de interação por restrições, mas não uma biblioteca Rust pronta para o editor. [Artigo](https://arxiv.org/abs/2004.13204), [implementação](https://github.com/HanHan55/Graph2plan).

**House-GAN++, 2021.** Explora refinamento iterativo de plantas, usando resultados anteriores como restrições para a próxima etapa. O valor para o produto é a ideia de melhorar ou completar uma proposta sob condições, em vez de reiniciar tudo a cada tentativa. Modelos treinados e exemplos residenciais não demonstram adequação direta a plantas medievais, torres ou ruínas. [Projeto dos autores](https://ennauata.github.io/houseganpp/page.html), [código](https://github.com/ennauata/houseganpp).

**Infinigen Indoors, 2024.** Documenta grafo de ambientes e otimização com critérios como área, proporções, circulação e ocupação das escadas. Seu material suplementar reserva espaço de escada entre pavimentos. É uma referência ampla para critérios e coordenação, mas sua execução baseada em Blender não equivale a um gerador interativo no navegador. [Artigo e suplemento em HTML](https://arxiv.org/html/2406.11824v1), [repositório](https://github.com/princeton-vl/infinigen).

**Edgar.** Gera layouts a partir de grafos e modelos de cômodos com posições possíveis de portas. Oferece controle de caminhos e conexões, mas o gerador documentado opera sobre grade 2D e monta peças. Adaptar esse método ao interior de uma envoltória desenhada livremente seria um problema adicional. [Repositório e limitações](https://github.com/OndrejNepozitek/Edgar-DotNet).

### Comparação das famílias

A tabela seguinte é uma avaliação para o Grafting, não um benchmark dos produtos citados.

| Família | Como encontra os espaços | Pontos fortes | O que não vem automaticamente |
|---|---|---|---|
| Divisão recursiva, como BSP | Subdivide áreas sucessivamente | Controle simples de tamanho, seed e profundidade | Circulação plausível, formas orgânicas e estabilidade após edição |
| Corredor primeiro | Reserva um percurso e organiza espaços ao redor | Entrada e escada orientam a circulação | Boa solução para prédios compactos sem corredor |
| Grafo e restrições | Procura áreas que satisfaçam relações e medidas | Expressa intenção e critérios de qualidade | Resolver rapidamente toda combinação impossível ou muito restrita |
| Modelos de cômodos | Combina formas pré-definidas | Consistência visual e controle de portas | Preencher qualquer contorno sem sobras |
| Otimização estocástica | Gera e melhora candidatos segundo uma função de custo | Combina vários objetivos | Tempo fixo e repetibilidade sem especificar o processo |
| Aprendizado de máquina | Aprende padrões a partir de exemplos | Diversidade e referências de estilo | Geometria válida, domínio adequado e integração leve |
| WFC | Propaga regras locais de compatibilidade | Padrões modulares e composição local | Uma planta globalmente acessível ou funcional apenas com regras locais |

O repositório original de WFC descreve similaridade local e admite contradições durante a propagação. **Inferência para este projeto:** ele pode ser útil em padrões e módulos, mas não deve ser escolhido como resposta automática para circulação e organização de uma casa. Restrições globais e validação continuariam necessárias. [WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse).

### Por que corredor obrigatório é uma escolha de produto

Uma pequena cabana pode funcionar melhor com acesso direto entre ambientes. Um casarão pode precisar de circulação que não atravesse quartos. Uma fortaleza pode ter uma galeria contínua; uma masmorra pode valorizar desvios, segredos e ciclos. Por isso, “sempre criar um corredor central” resolve somente uma família de planta.

A alternativa assistida poderia aceitar entrada, escada e áreas preservadas, deixando o sistema propor onde colocar circulação. Outra opção é o usuário desenhar o corredor e pedir divisórias ao redor. Uma terceira é oferecer presets como cabana, casa e fortaleza, cada um com preferências diferentes. São alternativas a comparar, não três funcionalidades já incluídas no escopo.

### Critérios de qualidade propostos

Antes de escolher o algoritmo, convém separar condições obrigatórias de preferências. As condições obrigatórias rejeitam um resultado: cômodo fora do contorno, sobreposição, acesso inexistente, parede duplicada ou escada bloqueada. Preferências apenas classificam resultados válidos: proporção mais agradável, menor percurso, corredor menos extenso ou cômodo perto da fachada.

Para um editor de fantasia, os critérios podem ser configuráveis sem pretender aprovação de projeto arquitetônico real. Área mínima, largura útil e altura livre seriam parâmetros do produto; valores numéricos devem ser escolhidos em função da escala e do estilo de uso desejado.

**Proposta de experiência:** produzir algumas alternativas, mostrar a circulação e permitir preservar uma região antes de gerar novamente. Isso dá um significado verificável a “boa planta”: o usuário compara resultados sob os mesmos requisitos. A viabilidade de prévias rápidas precisa ser medida posteriormente.

### Paredes internas sem duplicar o exterior

O desenho recomendado para avaliação é produzir uma partição 2D primeiro, extrair apenas as fronteiras internas necessárias e, então, gerar paredes. A fronteira de dois ambientes deve ser tratada como uma relação compartilhada, em vez de duas paredes coincidentes criadas separadamente. Portas são aberturas sobre essa fronteira, com localização escolhida conforme acesso e espaço disponível.

Essa proposta decorre dos requisitos locais e da distinção entre planta e geometria observada nas pesquisas. Ela não exige persistir um segundo grafo autoritativo de construção: a representação de planejamento pode ser transitória, e qualquer persistência adicional depende de discussão arquitetural.

## 6. Escadas e rampas: geração por parâmetros e por percurso

As referências mostram duas experiências complementares. ProBuilder oferece uma forma paramétrica com controle por número ou altura dos degraus. Tiny Glade enfatiza o percurso editável e a adaptação ao entorno. FreeCAD descreve composição por lances e patamares. [ProBuilder 5.0](https://docs.unity3d.com/Packages/com.unity.probuilder@5.0/manual/Stair.html), [Tiny Glade](https://steamcommunity.com/app/2198150/announcements/), [FreeCAD](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Arch_Stairs.md).

### Dois conjuntos de controles

| Forma de autoria | O que o usuário fornece | O que o gerador calcula |
|---|---|---|
| Dimensões e formato | Altura, largura, extensão e preset | Quantidade e distribuição de degraus, lados e patamares |
| Percurso e extremidades | Pontos de apoio, caminho e largura | Traçado, variação de altura e encaixes |

Como exemplo geométrico, uma subida de 3 unidades com 15 espelhos resulta em 0,2 por espelho. Esse exemplo não define uma medida obrigatória ou uma regra de construção real. O número de superfícies horizontais ainda depende da convenção de chegada: o piso superior pode funcionar como a última superfície pisável. Essa convenção deve ser consistente para evitar uma peça extra ou uma lacuna.

Se a altura total mudar, o sistema pode manter o número de degraus ou manter uma altura-alvo e recalcular a contagem. ProBuilder documenta essa distinção. Para o Grafting, o importante é que o usuário saiba qual grandeza está preservando. [Controles de geração](https://docs.unity3d.com/Packages/com.unity.probuilder@5.0/manual/Stair.html).

### Rampas compartilham parte do problema

Uma rampa pode usar um percurso e um perfil contínuo de altura, enquanto uma escada usa patamares discretos. A documentação de modelagem da Unreal inclui extrusão de caminhos para paredes e rampas, uma referência para essa decomposição geométrica. [Modeling Tools](https://dev.epicgames.com/documentation/unreal-engine/modeling-tools-in-unreal-engine).

**Inferência:** percurso, largura, elevação e encaixe podem compartilhar operações genéricas. Já regras de degrau, guarda-corpo e transição devem ser resolvidas pela geração específica. Compartilhar esses fundamentos não significa tornar escada e rampa indistinguíveis no produto.

### Curvas e espirais

Em uma curva, os lados interno e externo têm comprimentos diferentes. A profundidade dos degraus varia ao longo da largura; um raio pequeno pode produzir regiões estreitas. Em escadas helicoidais, uma volta pode se aproximar da anterior, exigindo avaliar o espaço acima de quem sobe.

Esses casos justificam distinguir escada reta, L/U com patamar, curva e helicoidal. Uma curva em planta não é automaticamente uma escada helicoidal. Archipack é uma referência útil para o vocabulário de partes; as relações de acesso e espaço útil ainda precisam ser especificadas. [Presets e partes](https://blender-archipack.gitlab.io/user/archipack%20objects.html).

### Relações com os outros elementos

O resultado deve ser avaliado junto do piso de chegada, do vão e das paredes próximas. A questão não é apenas a malha do degrau, mas também se há uma área de desembarque utilizável. Corrimão e guarda-corpo podem existir em lados escolhidos, sem bloquear a chegada.

Para a primeira delimitação, vale comparar: ligação reta entre duas alturas; L ou U com patamar; percurso livre; adaptação automática a torre. Cada ampliação aumenta a quantidade de relações que o editor precisa comunicar e preservar. Não há evidência para prometer que todas têm o mesmo custo de implementação.

## 7. Bibliotecas e implementações disponíveis

As licenças abaixo são as declaradas nas páginas dos projetos consultadas. A tabela identifica candidatos para avaliação técnica, não autorização de integração ou análise completa de todas as dependências transitivas.

| Recurso | Disponível | Papel possível | Limitação relevante |
|---|---|---|---|
| iOverlay | Rust; MIT/Apache-2.0 | União, diferença, interseção e contornos com furos | Não planeja cômodos nem gera um telhado completo |
| Spade | Rust; MIT/Apache-2.0 | Triangulação Delaunay com restrições e refinamento | Não fornece semântica de piso, teto ou circulação |
| earcut do Grafting | Crate Rust; consultar a versão integrada | Tesselação de polígonos | Não confundir API/licença com a implementação JavaScript |
| Cavalier Contours | Rust; MIT/Apache-2.0; demonstração WASM | Operações com retas e arcos circulares | Limites de arco, junções de offset e entradas booleanas documentados |
| CGAL Straight Skeleton | C++; pacote sob GPL, opção comercial no projeto | Referência completa para esqueletos e extrusão | Integração, licença e pré-condições exigem avaliação |
| StrandedKitty/straight-skeleton | Interface TypeScript com núcleo CGAL em WASM | Demonstração e experimentação de esqueletos | Wrapper MIT não encerra avaliação da licença do núcleo |
| lizelive/straight-skeleton | Rust; GPL-2.0-or-later | Candidato de esqueleto e perfis de cobertura | Entrada em retícula i16; não presumir adequação às coordenadas livres |
| geo-buffer 0.2.0 | Rust | Offsets e extração de linhas do esqueleto | Documenta ressalvas sobre o algoritmo de origem e entradas válidas |
| Ladybug Geometry Polyskel | Python; AGPL-3.0 | Referência de esqueleto e zonas internas/perimetrais | Não é componente Rust/WASM pronto para este uso |
| Clipper2 | C++, C# e Delphi; Boost Software License 1.0 | Comparação de operações poligonais | Integração adicional; não substitui geradores de construção |
| Edgar-DotNet | .NET; MIT | Referência de layout por grafos e modelos | Grade 2D e montagem de peças; não preenche automaticamente toda envoltória |
| Infinigen | Python/Blender; consultar licenças por componente | Referência de restrições e geração de cenas | Pipeline de geração de cenas, não biblioteca leve de interação |

Fontes da tabela: [iOverlay](https://github.com/iShape-Rust/iOverlay), [Spade](https://github.com/Stoeoef/spade), [earcut Rust](https://docs.rs/earcut/latest/earcut/), [Cavalier Contours](https://github.com/jbuckmccready/cavalier_contours), [CGAL: pacote](https://doc.cgal.org/latest/Manual/packages.html#PkgStraightSkeleton2), [CGAL: licenças](https://www.cgal.org/license.html), [StrandedKitty](https://github.com/StrandedKitty/straight-skeleton), [lizelive](https://github.com/lizelive/straight-skeleton), [geo-buffer](https://docs.rs/geo-buffer/latest/geo_buffer/), [Ladybug](https://github.com/ladybug-tools/ladybug-geometry-polyskel), [Clipper2](https://github.com/AngusJohnson/Clipper2), [licença Clipper2](https://github.com/AngusJohnson/Clipper2/blob/main/LICENSE), [Edgar](https://github.com/OndrejNepozitek/Edgar-DotNet), [Infinigen](https://github.com/princeton-vl/infinigen).

### Candidatos com melhor encaixe inicial

**Reaproveitamento do que já existe.** O manifesto local de graph-core já declara i_overlay 8.1.0 e earcut 0.4. O lockfile consultado registra earcut 0.4.11 e Spade 2.15.1, este usado por irregular-grid. Isso confirma presença de dependências, não que todos os recursos exigidos pelas quatro issues estejam expostos ou implementados. [Manifesto graph-core](../../libs/graph/core/Cargo.toml), [lockfile](../../Cargo.lock).

**Curvas.** Cavalier Contours documenta suporte a arcos circulares sem convertê-los previamente em segmentos retos e inclui demonstração WASM. Contudo, seus offsets usam junções arredondadas e seus arcos têm limites documentados. É um candidato interessante para avaliar, sobretudo se faltarem operações equivalentes na base já existente; não uma instalação recomendada automaticamente. [Capacidades e limitações](https://github.com/jbuckmccready/cavalier_contours).

**Telhados.** CGAL é uma boa referência de comparação, inclusive por explicitar condições de entrada. O demo de StrandedKitty permite fornecer polígonos GeoJSON e apresenta prévias 2D/3D; sua existência foi verificada, mas não foi realizado ensaio interativo. [Demonstração](https://strandedkitty.github.io/straight-skeleton/example/).

**Triangulação.** A documentação JavaScript do Earcut explicita que entradas arbitrariamente inválidas não têm garantia de triangulação correta. Essa observação reforça avaliar a validade do polígono antes da malha, mas não comprova comportamento idêntico na crate Rust integrada. [Earcut JavaScript](https://github.com/mapbox/earcut).

### Critérios para uma avaliação posterior

A escolha deve comparar suporte a concavidades e furos, preservação dos contornos, estabilidade perto de arestas colineares, tratamento de arcos, determinismo, tamanho do módulo WASM e integração com identificadores existentes. Uma biblioteca pode retornar geometria correta e ainda exigir trabalho considerável para informar qual nova face corresponde a uma face antiga.

Uma retícula inteira pode favorecer certas operações, mas demanda definir escala, arredondamento e faixa de coordenadas. Uma API de ponto flutuante tampouco elimina a necessidade de tolerâncias consistentes. Essas decisões pertencem à integração geométrica e devem ser feitas uma vez, sem interpretações diferentes em cada ferramenta.

## 8. Conteúdo visual disponível

Além dos algoritmos, existe conteúdo para testar aparência. Poly Haven disponibiliza HDRIs, texturas e modelos sob CC0. AmbientCG também declara CC0 para seus arquivos de assets. São fontes possíveis para estudos de madeira, pedra e superfícies de cobertura, sujeitos à seleção artística e técnica de cada arquivo. [Poly Haven: licença](https://polyhaven.com/license), [ambientCG: licença](https://docs.ambientcg.com/license/).

**Análise:** assets aceleram a avaliação visual, mas não solucionam o sistema construtivo. Uma escada importada como modelo não passa automaticamente a conhecer pisos de origem e destino. Uma textura de telhas não oferece edição de beiral. Geometria estrutural, revestimento e peças distribuídas precisam ter papéis distintos.

O estudo de materiais pode usar duas apresentações: forma sem detalhes para julgar proporção e conexões; acabamento representativo para julgar estilo. Não é necessário implementar telhas individuais antes de decidir se o telhado cobre corretamente a planta, mas também não se deve confundir uma superfície lisa com a versão artística final.

## 9. Consequências para a arquitetura do Grafting

O ADR-0022 separa geração de padrões da aplicação genérica ao grafo, e mantém significado de produto nos presets do aplicativo. As regras locais também exigem que lógica geométrica reutilizável permaneça no núcleo Rust e que fornecedores sejam isolados. Isso favorece avaliar bibliotecas como componentes de capacidades existentes, em vez de chamar algoritmos equivalentes independentemente no frontend. [ADR-0022](../adr/ADR-0022-wall-representation-free-geometry.md), [contrato operacional](../../AGENTS.md).

Uma decomposição conceitual para discussão seria:

| Camada de decisão | Informação principal | Saída esperada |
|---|---|---|
| Intenção de edição | Região escolhida, níveis, formato e controles | Pedido explícito e prévia |
| Planejamento | Contorno, acessos, áreas reservadas e preferências | Distribuição espacial candidata |
| Geração geométrica | Parâmetros e contornos resolvidos | Superfícies e conexões propostas |
| Aplicação | Estado anterior e proposta | Alteração coerente no modelo existente |
| Apresentação | Superfícies confirmadas e materiais | Malha, seleção e controles |

Essa tabela não propõe criar cinco novos pacotes nem uma segunda fonte autoritativa. Ela ajuda a localizar responsabilidades durante a futura especificação. Parte dessas separações já existe no projeto.

A preservação de edições merece definição funcional desde o início: gerar novamente pode substituir toda a região, somente elementos gerados ou apenas trechos não preservados. Isso influencia os dados de entrada e a identidade das superfícies. Não é apenas uma otimização a acrescentar depois.

## 10. Três direções de produto a comparar

As direções seguintes são alternativas de escopo, não uma classificação universal de melhor e pior.

| Direção | Experiência central | O que facilita | Compromisso |
|---|---|---|---|
| Construção expressiva | Desenhar, puxar e encaixar formas; sistema adapta detalhes | Experimentação rápida e formas orgânicas | Relações internas precisam de regras próprias |
| Construção assistida | Fixar áreas, níveis e acessos; escolher propostas editáveis | Controle com automação de tarefas repetidas | Requer interface para restrições e preservação |
| Geração por programa | Informar tipos de ambientes e conexões; sistema monta | Muitos edifícios variados a partir de requisitos | Exige solver, critérios e tratamento de pedidos impossíveis |

**Recomendação fundamentada para a próxima conversa:** comparar primeiro construção assistida e construção expressiva. Elas permitem discutir como os quatro recursos se combinam sem assumir a necessidade de um modelo de aprendizado de máquina. Geração automática por programa pode permanecer uma opção se criar muitos edifícios completos for uma necessidade central.

Nenhuma dessas direções implica obrigar um corredor em toda planta. O tipo de circulação pode ser um parâmetro, uma área desenhada ou uma consequência de requisitos de acesso. Também não implica limitar toda altura a andares fixos.

## 11. Casos de uso para escolher o escopo

A seleção de exemplos concretos é mais informativa do que uma lista crescente de formatos. Os cenários abaixo podem orientar desenhos e comparações antes de qualquer protótipo.

| Cenário | O que precisa ser demonstrado | Decisão exposta |
|---|---|---|
| Cabana retangular térrea | Piso, divisória simples e telhado de duas águas | Geração por recinto e orientação da cumeeira |
| Casa em L | Cobertura com encontro interno e ambientes acessíveis | Telhado único ou composição de partes |
| Casa de dois andares | Escada, vão e piso superior | Vínculo entre níveis e recorte |
| Torre circular | Parede curva, piso e cobertura cônica | Representação analítica e edição da circunferência |
| Mezanino | Piso parcial e espaço aberto abaixo | Independência entre piso e teto |
| Pátio interno | Contorno externo e abertura interna | Preservação de furos |
| Construção em encosta | Entradas em alturas diferentes e rampa | Meios-níveis e conexão com terreno |
| Planta parcialmente editada | Regeneração após intervenção manual | Elementos preservados e região substituída |
| Espaço pequeno demais | Escada ou cômodos não cabem | Como comunicar inviabilidade e oferecer alternativas |

Para cada cenário, o resultado deve ser julgado pela quantidade de ações, previsibilidade dos controles, coerência da forma e possibilidade de editar novamente. Uma imagem bonita de um caso isolado não comprova cobertura dos demais.

As perguntas que mais alteram o escopo são:

1. A forma externa vem primeiro, ou o sistema também pode alterá-la para acomodar a planta?
2. O usuário organiza ambientes individualmente, escolhe alternativas ou entrega toda a planta ao gerador?
3. Níveis são referências livres de edição ou unidades que controlam a altura dos elementos?
4. Pisos e tetos devem acompanhar as paredes automaticamente, opcionalmente ou nunca?
5. Escadas apenas recebem origem e destino, ou também procuram um percurso ao redor de obstáculos?
6. Quais formatos são obrigatórios desde a primeira entrega: retângulos, L/U, círculos, pátios ou qualquer contorno?
7. O que uma regeneração deve preservar?
8. Telhados compostos devem se unir automaticamente ou ter controles explícitos de ligação?

Essas respostas permitem escrever critérios de aceitação das quatro issues sem escolher um algoritmo por popularidade. A pesquisa sustenta vários caminhos; a seleção depende da experiência que o editor deve proporcionar.

## 12. Limites e pontos ainda não demonstrados

Não foi demonstrado que uma das implementações de straight skeleton examinadas preserve arcos analíticos, identidades de superfície e todas as formas de telhado desejadas ao mesmo tempo. Também não foi demonstrado que os geradores de plantas baseados em aprendizado produzam resultados adequados ao estilo de fantasia e às geometrias livres do Grafting.

O texto de alguns repositórios descreve funcionalidades que podem mudar com a versão. Antes de qualquer integração, deve-se conferir a API e a licença da revisão selecionada. O nome de uma biblioteca, a quantidade de estrelas ou a presença de um demo não foram usados como comprovação de robustez.

As operações geométricas já presentes reduzem a necessidade potencial de novas dependências, mas sua cobertura concreta ainda precisa ser confrontada com o escopo escolhido. As propostas deste relatório permanecem abertas para discussão; nenhuma tecnologia ou comportamento foi aprovado por ele.

## Fontes e referências

As páginas sem data editorial foram consultadas em 12/09/2026. Links para repositórios identificam documentação dos autores; não substituem a inspeção de uma revisão fixa na avaliação de integração.

1. Pounce Light. [Tiny Glade: anúncios oficiais; atualização de escadas de 29/07/2025](https://steamcommunity.com/app/2198150/announcements/). Interação por pontos e adaptação ao contexto.
2. Karel Crombecq / Dungeon Alchemist. [Fun with Objects, Part 1](https://www.dungeonalchemist.com/post/fun-with-objects-part-1-is-out-now), 10/07/2025. Pavimentos, telhados e vãos.
3. Dungeon Alchemist. [The Fine Print Patch](https://www.dungeonalchemist.com/post/the-fine-print-patch-is-out-now), março de 2026. Atualização posterior e controle de geração.
4. Sweet Home 3D. [Users Guide](https://www.sweethome3d.com/users-guide/), documentação online. Níveis, paredes e ambientes.
5. Sweet Home 3D. [How to customize staircases](https://www.sweethome3d.com/blog/how-to-customize-staircases/), tutorial de 2016. Ajuste de altura e aberturas.
6. Archipack. [Archipack Objects](https://blender-archipack.gitlab.io/user/archipack%20objects.html), documentação 2.0. Partes paramétricas, pisos e recortadores.
7. Stephen Leger. [Archipack público](https://github.com/s-leger/archipack), identificado para Blender 2.79. Disponibilidade do código e diferença de versões.
8. FreeCAD. [Arch Roof](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Arch_Roof.md), espelho arquivado em 01/04/2026. Vínculo paramétrico e propriedades por face.
9. FreeCAD. [Arch Stairs](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Arch_Stairs.md), mesmo espelho. Lances, patamares e elevações.
10. Bonsai. [Geometry and Materials](https://docs.bonsaibim.org/reference/geometry_and_materials/index.html), documentação 0.8.5 consultada. Relações, aberturas e parametrização.
11. Bonsai. [Create Slab](https://docs.bonsaibim.org/reference/toolbar/slab.html), documentação incompleta. Escopo da ferramenta de laje.
12. Esri. [roofHip](https://esri.github.io/cityengine-sdk/html/cgaref/cgareference/op_roofHip.html), CGA Reference. Altura, inclinação e convenção de beiral.
13. Esri. [Geometry Tagging](https://esri.github.io/cityengine-sdk/html/cgaref/cgareference/cga_componentTags.html). Classificação de faces.
14. SideFX. [Labs Building Generator 4.0](https://www.sidefx.com/docs/houdini/nodes/sop/labs--building_generator-4.0.html). Volumes, pavimentos e módulos.
15. Fernando Cacciola, Sébastien Loriot e Mael Rouxel-Labbé / CGAL. [Straight Skeleton User Manual](https://doc.cgal.org/latest/Straight_skeleton_2/index.html), versão 6.2.1 consultada. Definição, polígonos com furos e pesos.
16. CGAL. [Skeleton Extrusion API](https://doc.cgal.org/latest/Straight_skeleton_2/group__PkgStraightSkeleton2Extrusion.html), versão 6.2.1 consultada. Pré-condições e limitações da extrusão.
17. Martin Held e Peter Palfrader. [Straight Skeletons with Additive and Multiplicative Weights and Their Application to the Algorithmic Generation of Roofs and Terrains](https://arxiv.org/abs/1604.03362), 2016. Inclinações e alturas iniciais distintas.
18. Paul Merrell, Eric Schkufza e Vladlen Koltun. [Computer-Generated Residential Building Layouts](https://www.cs.princeton.edu/courses/archive/spr11/cos598A/pdfs/Merrell10a.pdf), ACM TOG / SIGGRAPH Asia, 2010. Programa arquitetônico e otimização.
19. Ruizhen Hu et al. [Graph2Plan](https://arxiv.org/abs/2004.13204), SIGGRAPH, 2020. Geração condicionada por contorno e grafo.
20. Autores de Graph2Plan. [Implementação](https://github.com/HanHan55/Graph2plan). Dependências e pós-processamento.
21. Nelson Nauata et al. [House-GAN++](https://ennauata.github.io/houseganpp/page.html), CVPR, 2021. Refinamento de plantas.
22. Autores de House-GAN++. [Código](https://github.com/ennauata/houseganpp). Modelos e execução.
23. Alexander Raistrick et al. [Infinigen Indoors](https://arxiv.org/html/2406.11824v1), CVPR, 2024; artigo e suplemento. Restrições e coordenação entre pavimentos.
24. Princeton Vision & Learning Lab. [Infinigen](https://github.com/princeton-vl/infinigen). Código e documentação.
25. Ondřej Nepožitek. [Edgar-DotNet](https://github.com/OndrejNepozitek/Edgar-DotNet). Templates, grafos e limitações.
26. Ondřej Nepožitek. [Graph-Based Dungeon Generator: Basics](https://ondra.nepozitek.cz/blog/graph-based-dungeon-generator-basics-1/), 23/12/2018. Portas, corredores e conectividade.
27. Maxim Gumin. [WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse). Restrições locais e contradições.
28. Unity. [Stairs, ProBuilder 5.0](https://docs.unity3d.com/Packages/com.unity.probuilder@5.0/manual/Stair.html). Contagem, altura e curvas.
29. Epic Games. [Modeling Tools in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/modeling-tools-in-unreal-engine). Extrusão de caminhos e rampas.
30. iShape-Rust. [iOverlay](https://github.com/iShape-Rust/iOverlay). Operações poligonais e licença declarada.
31. Spade. [Repositório](https://github.com/Stoeoef/spade). Triangulação com restrições e licença declarada.
32. earcut. [Documentação Rust](https://docs.rs/earcut/latest/earcut/). Identificação da implementação Rust.
33. Mapbox. [Earcut JavaScript](https://github.com/mapbox/earcut). Limitações de triangulação de entradas inválidas; implementação distinta da crate local.
34. Cavalier Contours. [Repositório Rust](https://github.com/jbuckmccready/cavalier_contours). Arcos, offsets, WASM e limitações.
35. CGAL. [Package Overview](https://doc.cgal.org/latest/Manual/packages.html#PkgStraightSkeleton2) e [licenciamento](https://www.cgal.org/license.html). Licença do pacote de esqueleto e opção comercial.
36. StrandedKitty. [Straight Skeleton](https://github.com/StrandedKitty/straight-skeleton) e [demo](https://strandedkitty.github.io/straight-skeleton/example/). Interface WASM sobre CGAL.
37. lizelive. [straight-skeleton](https://github.com/lizelive/straight-skeleton). Implementação Rust, retícula e licença.
38. geo-buffer. [Documentação 0.2.0](https://docs.rs/geo-buffer/latest/geo_buffer/). Operações e ressalvas do algoritmo.
39. Ladybug Tools. [ladybug-geometry-polyskel](https://github.com/ladybug-tools/ladybug-geometry-polyskel). Implementação Python e licença.
40. Angus Johnson. [Clipper2](https://github.com/AngusJohnson/Clipper2) e [licença](https://github.com/AngusJohnson/Clipper2/blob/main/LICENSE). Operações poligonais.
41. Poly Haven. [Asset License](https://polyhaven.com/license). Assets CC0.
42. ambientCG. [License information](https://docs.ambientcg.com/license/). Assets CC0.
43. Grafting Monorepo. [ADR-0022](../adr/ADR-0022-wall-representation-free-geometry.md), [nota 0008](../../apps/vtt/notes/0008-region-partition-needs-rework.md), [AGENTS.md](../../AGENTS.md), [manifesto graph-core](../../libs/graph/core/Cargo.toml) e [Cargo.lock](../../Cargo.lock). Limites arquiteturais e dependências observadas localmente.
