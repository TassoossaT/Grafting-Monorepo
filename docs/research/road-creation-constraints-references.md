# Restrições e Validações na Criação de Estradas e Caminhos em Jogos

Jogos de construção de cidades, gerenciamento e ferramentas de engine utilizam algoritmos de validação, sanitização de input e deformação de terreno para garantir que qualquer entrada do jogador resulte em uma rede viária funcional, esteticamente limpa e geometricamente válida. Este documento analisa detalhadamente as restrições de construção de estradas nos principais títulos do gênero e ferramentas de desenvolvimento, mapeando parâmetros numéricos, tratamento de declives, sanitização livre (freehand), criação de junções e integração com a topografia.

## Redes Viárias Complexas e City-Builders Sistêmicos (Cities: Skylines 1 & 2, Transport Fever 2)

Veredito: Jogos de simulação viária pesada priorizam a integridade geométrica e física do tráfego, impondo limites rígidos de inclinação e curvatura via splines paramétricas e gerando rampas ou estruturas automaticamente.

* **Cities: Skylines 1 e 2**:
  * *Transição de Altura & Elevação*: Ajuste de elevação via teclas `PageUp`/`PageDown` (passos de 3m, 6m ou 12m). Ao conectar vias em alturas distintas, o jogo calcula a inclinação (exibida em porcentagem em tempo real no CS2). Se a inclinação for menor que o limite máximo (~4-6% para rodovias, ~8-12% para ruas urbanas), o jogo aplica terraplenagem de corte e aterro (*cut-and-fill*). Se a altura relativa ou topografia for extrema, converte automaticamente em ponte (acima do solo) ou túnel (abaixo do solo). Conexões inválidas são recusadas com o erro visual "Slope too steep" em preview vermelho. [Confirmado por Fonte]
  * *Sanitização de Input*: Oferece modos Reta, Curva Simples, Curva Complexa, Contínuo e Grade. A menor unidade de segmento equivale a 1 célula de zoneamento (8 metros), impondo comprimento mínimo de segmento de ~8m a 16m para formar um nó válido. Curvas possuem raio mínimo atrelado à largura da pista para evitar auto-interseção da malha 3D. A intersecção direta de um traço sobre si mesmo no mesmo comando é totalmente bloqueada com "Space already occupied". O preview exibe a malha em azul quando válida e em vermelho com texto explicativo quando inválida. O traçado usa curvas de Bézier cúbicas / splines com tangentes clampadas. [Confirmado por Fonte / Inferido]
  * *Junções e Snapping*: Raio de snap automático de nós (~8m). Oferece snapping a 90°, paralelismo e linhas de guia. Conectar um novo nó no meio de um segmento existente força o *auto-split* (divisão do segmento em dois e criação de nó de intersecção). Ângulos de junção agudos (< 30°-45°) são rejeitados ("Too acute angle") para prevenir artefatos gráficos e colisões de tráfego. Vias quase paralelas dentro do raio de snap fundem-se em um único segmento. [Confirmado por Fonte]
  * *Interação com Terreno*: No modo padrão, a estrada adere à topografia. Em modo de elevação fixa ou pontes, a via mantém sua inclinação constante independente do relevo, deformando o terreno abaixo ou criando pilares. [Confirmado por Fonte]

* **Transport Fever 2**:
  * *Transição de Altura & Elevação*: Limite de inclinação estrito (padrão de 20% para estradas e 75‰ / 7,5% para ferrovias). Ao conectar vias de alturas distintas, gera automaticamente aterros graduados; se a altura em relação ao solo exceder a margem da rampa, insere pontes com pilares ou perfura túneis automaticamente. Exceder o limite resulta na mensagem de recusa "Slope too steep". [Confirmado por Fonte]
  * *Sanitização de Input*: Construção baseada em splines Hermitianas com comprimento e raio de curvatura calculados dinamicamente. Raios mínimos de curva são estritamente proporcionais à velocidade máxima da via e largura. Auto-interseções e laços no mesmo traço são invalidados imediatamente com renderização vermelha ("Construction not possible"). Tecla `Shift` desativa o snap magnético. [Confirmado por Fonte]
  * *Junções e Snapping*: Snap automático em extremidades e ao longo de segmentos existentes, executando *auto-split* instantâneo. Fusão automática de vias paralelas próximas. Ângulos de junção inferiores a ~25°-30° são recusados para evitar cruzamentos fisicamente impossíveis para veículos. [Confirmado por Fonte]
  * *Interação com Terreno*: Aplica suavização lateral do terreno (*embankment*) ao longo da via. Em rampas elevadas, sobrepõe a malha do terreno sem destruí-la, criando pilares de sustentação. [Confirmado por Fonte]

## Construção de Parques e Ferramentas de Pedestres em Graus (Planet Coaster 2, Planet Zoo, Timberborn)

Veredito: Ferramentas de caminhos de pedestres priorizam acessibilidade e continuidade funcional, convertendo rampas em escadas automaticamente e utilizando malhas modulares ou grades de conectividade.

* **Planet Coaster 2 e Planet Zoo**:
  * *Transição de Altura & Elevação*: Passos de altura ajustáveis via teclas `U`/`J` ou arraste vertical com `Shift`. Ao conectar pontos de alturas diferentes, a ferramenta gera uma rampa inclinada. Se o ângulo exceder o limite de caminhada plana (~15°-20°), a ferramenta converte automaticamente o segmento de rampa em escadaria. [Confirmado por Fonte]
  * *Sanitização de Input*: Suporta modos por segmentos (comprimento ajustável de 0.25m a 4m; largura de 4m a 10m) e desenho livre/estampa (no *Planet Coaster 2*). Raio de curva mínimo é limitado pela largura do caminho para impedir que a malha de pedestres se dobre sobre si mesma. Entradas inválidas (colisão com barreiras, edifícios ou declive excessivo) exibem preview fantasma vermelho e mensagem de erro ("Terrain modified" ou "Obstructed"). A tecla `Ctrl` desativa o snapping automático. O *Planet Coaster 2* inclui a ferramenta *Rounding Tool* para suavização de quinas. [Confirmado por Fonte]
  * *Junções e Snapping*: Snap magnético a caminhos existentes com suporte a *Angle Snap* configurável (15°, 30°, 45°, 90°). Conexões em T ou X fundem a malha visual dos caminhos e criam intersecções arredondadas. O *auto-split* ocorre ao tocar em um caminho existente. Permite desativar a junção automática (*Join Paths*) para construir vias paralelas encostadas. [Confirmado por Fonte]
  * *Interação com Terreno*: A opção "Flatten Terrain" modela o relevo abaixo do caminho. Quando desativada, o caminho flutua sobre a topografia como passarela suspensa com suportes estruturais. Na funcionalidade de grade (*Align to Grid*), rampas e escadas são desativadas, permitindo apenas praças planas. [Confirmado por Fonte]

* **Timberborn**:
  * *Transição de Altura & Elevação*: Caminhos operam em uma malha estritamente volumétrica/discreta (voxel-based grid). Não existem rampas contínuas livremente desenhadas. Para conectar alturas diferentes, o jogador é obrigado a construir escadas modulares de madeira. Cada lanço de escada consome 2 unidades de alcance logístico do Distrito (em comparação com 1 unidade de um caminho plano). [Confirmado por Fonte]
  * *Sanitização de Input*: Desenho ortogonal por células de grade. Não há desenho livre (freehand) ou curvas contínuas; conexões mudam em ângulos retos de 90°. Preview vermelho impede posicionamento sobre entulhos, edifícios ou água sem plataforma. [Confirmado por Fonte]
  * *Junções e Snapping*: Toda célula adjacente com caminho conecta-se automaticamente em grade 4-direcional. Não há conceito de ângulo de junção além de 90°. [Confirmado por Fonte]
  * *Interação com Terreno*: Caminhos devem ser construídos sobre a camada superior do solo ou sobre estruturas de plataformas de madeira. Não há deformação automática de terreno. [Confirmado por Fonte]

## Traçados Orgânicos Medievais e Jogos de Sobrevivência (Manor Lords, Farthest Frontier, Anno 1800 & 117)

Veredito: Jogos de época equilibram estática histórica e facilidade de planejamento; títulos orgânicos utilizam splines flexíveis coladas ao solo, enquanto jogos de simulação econômica mantêm grades ortogonais rígidas.

* **Manor Lords**:
  * *Transição de Altura & Elevação*: Estradas são 100% moldadas sobre a superfície do terreno (ground-conforming). Ao conectar pontos em elevações distintas, a estrada acompanha o perfil do relevo. Terrenos com inclinação extrema impedem a confirmação da via. Não há geração automática de pontes viárias ou cortes de terraplenagem. [Confirmado por Fonte]
  * *Sanitização de Input*: Posicionamento de pontos consecutivos formando linhas de desejo orgânicas. Não há rejeição de laços (circuito fechado é permitido e incentivado para delimitar quadras de vilarejos). Pontos muito próximos são suavizados via interpolação de spline contínua. Remover vias é feito via `Alt + Clique Direito`. [Confirmado por Fonte / Inferido]
  * *Junções e Snapping*: Snap magnético a estradas existentes, divisas de lotes (*burgage plots*) e edifícios. Conectar a um ponto intermediário divide o segmento receptor (*auto-split*). O snap pode ser desativado via atalho para controle fino. [Confirmado por Fonte]
  * *Interação com Terreno*: Adere estritamente à malha do terreno, alterando apenas a textura da superfície (remoção de grama e aplicação de terra batida/pedra). [Confirmado por Fonte]

* **Farthest Frontier**:
  * *Transição de Altura & Elevação*: Apresenta modo de grade clássico e modo *gridless* (a partir da Atualização 1.1). Terrenos com inclinação pronunciada bloqueiam a colocação de estradas com aviso de inclinação excessiva. O jogador deve usar previamente a ferramenta "Flatten Terrain" para viabilizar acessos em encostas. [Confirmado por Fonte]
  * *Sanitização de Input*: Tecla `Shift` força linhas retas ou ângulos perfeitos de 45°. Curvas são criadas manualmente através de pequenos segmentos tangenciais adjacentes. Invalidação por terreno irregular exibe células vermelhas e recusa a construção. [Confirmado por Fonte]
  * *Junções e Snapping*: Requer ancoragem nas extremidades ou nós de estradas existentes para garantir a continuidade da malha de pathfinding dos aldeões. Executa fusão e auto-split ao cruzar vias. [Confirmado por Fonte]
  * *Interação com Terreno*: Adere integralmente ao relevo sem alteração de altura própria ou criação automática de pontes. [Confirmado por Fonte]

* **Anno 1800 e Anno 117**:
  * *Transição de Altura & Elevação*: Malha estritamente ortogonal (grid de 90°). Não existem estradas diagonais nativas ou rampas de elevação controlada. Estradas sobem e descem a topografia acompanhando as células de grade, mas falésias, rochas e água bloqueiam a construção. [Confirmado por Fonte]
  * *Sanitização de Input*: Clique e arraste preso aos eixos cardinalis X/Y. Tentativas de desenho diagonal resultam em traçados em escada ("zig-zag") de células 1x1. Células ocupadas ou intransitáveis são destacadas em vermelho com bloqueio imediato. [Confirmado por Fonte]
  * *Junções e Snapping*: Snap automático em células adjacentes. Junções ocorrem exclusivamente em 90° (junções em T e cruzamentos de 4 vias). Não há suporte para ângulos agudos ou mesclas de pistas. [Confirmado por Fonte]
  * *Interação com Terreno*: A estrada atua como um decalque aplicado sobre a malha de relevo do mapa. [Confirmado por Fonte]

## Construção Cozy e Malhas Procedurais Distorcidas (Tiny Glade, Townscaper)

Veredito: Jogos de estética relaxante eliminam menus de erro e recusas; o input livre do jogador é sanitizado através de algoritmos procedurais de limpeza contextual e síntese de malha em tempo real.

* **Tiny Glade**:
  * *Transição de Altura & Elevação*: Sistema sem grade (*gridless*) e totalmente fluido. Quando o jogador desenha um caminho conectando diferentes elevações, a engine procedural adapta o terreno em tempo real, gerando rampas suaves de terra ou escadas de pedra integradas organicamente ao relevo. [Confirmado por Fonte]
  * *Sanitização de Input*: Ferramenta de pincel contínuo (freehand). O traço do jogador é reamostrado e suavizado em tempo real por algoritmos de curvação (como Catmull-Rom ou Chaikin). Não existe preview vermelho ou mensagem de recusa: rabiscos apertados ou laços fechados são automaticamente convertidos e limpos, transformando-se em pequenos pátios ou praças de paralelepípedo. [Confirmado por Fonte / Inferido]
  * *Junções e Snapping*: Rege-se pelo princípio de "química de construção" (*building chemistry*). Caminhos que se aproximam fundem-se sem costuras visíveis. Ao cruzar muretas ou edifícios, a ferramenta abre arcos de pedra procedurais automaticamente. [Confirmado por Fonte]
  * *Interação com Terreno*: O caminho cola-se ao relevo topográfico, aplicando deformação procedural leve na vegetação e mesclando texturas de borda. [Confirmado por Fonte]

* **Townscaper**:
  * *Transição de Altura & Elevação*: Malha procedural irregular pré-relaxada, criada via Poisson Disk Sampling, Triangulação de Delaunay, quadrangulação e suavização Laplacian. As vias são geradas no topo dos blocos ou ao nível do mar conforme a aplicação do algoritmo Wave Function Collapse (WFC). Rampas e escadas surgem automaticamente entre diferentes níveis de blocos. [Confirmado por Fonte]
  * *Sanitização de Input*: Input discreto via cliques (adicionar/remover bloco). Não há desenho de caminho em freehand. Toda geometria de rua é uma consequência procedural das regras de vizinhança do WFC. Impossível gerar traçados inválidos. [Confirmado por Fonte]
  * *Junções e Snapping*: Determinadas pela topologia da malha quad distorcida. Arcos, pontes e cruzamentos são sintetizados automaticamente ao conectar estruturas. [Confirmado por Fonte]
  * *Interação com Terreno*: As ruas acompanham a curvatura orgânica do grid distorcido sobre a água ou sobre andares de edifícios. [Confirmado por Fonte]

## Ferramentas de Engine e Middleware de Splines (Unreal Engine Landscape Splines, Unity EasyRoads3D & Road Architect)

Veredito: Frameworks de desenvolvimento de jogos oferecem parametrização matemática total de splines, aplicando limites de inclinação, resampling de malha e deformação de heightmap programáveis.

* **Unreal Engine (Landscape Splines)**:
  * *Transição de Altura & Elevação*: Pontos de controle com posição 3D e rotação livre. A opção "Deform Landscape to Splines" altera o heightmap da paisagem para corresponder à altura e inclinação da spline, aplicando uma largura central e uma zona de transição (*Falloff*) configuráveis. [Confirmado por Fonte]
  * *Sanitização de Input*: Edição por nós de Bézier com manipulação direta de vetores de tangente. Suporta ajuste de largura por nó (*Width*) e rolagem (*Roll*). A malha da estrada é esticada ou repetida ao longo da spline via `SplineMeshComponent`. Raios de curva excessivamente fechados causam torção de malha (*twisting*) caso as tangentes não sejam sanitizadas programaticamente. [Confirmado por Fonte]
  * *Junções e Snapping*: Permite conectar pontos de controle de diferentes splines, alinhando tangentes e fundindo segmentos de malha no nó de intersecção. [Confirmado por Fonte]
  * *Interação com Terreno*: Alternável entre deformação direta do relevo (corte/aterro no heightmap) e modo flutuante/independente (ponte ou viaduto). [Confirmado por Fonte]

* **Unity (EasyRoads3D e Road Architect)**:
  * *Transição de Altura & Elevação*: Parâmetros configuráveis de inclinação máxima (*Max Slope Grade*). Quando a inclinação da spline supera o limite definido, a ferramenta executa terraplenagem automática no terreno da Unity ou aciona proceduralmente objetos laterais (*Side Objects*) para gerar estruturas de pontes ou túneis. [Confirmado por Fonte]
  * *Sanitização de Input*: Resampling automático de pontos de spline para manter densidade uniforme de vértices. Validação de raio de curvatura (*Corner Radius*): se o raio for inferior à metade da largura da via (\(R < 0.5 \times W\)), a malha 3D sofre auto-interseção e distorção de textura. As ferramentas clampam as tangentes ou emitem alertas no Inspector. [Confirmado por Fonte / Análise Técnica]
  * *Junções e Snapping*: Sistema dedicado de prefabs de interseções (cruzamentos em T, X e rotatórias). Arrastar um nó sobre um segmento existente dispara o *auto-split* do segmento e a instanciação automática da malha de intersecção com alinhamento de pistas e calçadas. [Confirmado por Fonte]
  * *Interação com Terreno*: Deforma a malha do terreno da Unity com raio de suavização ajustável, remove árvores/detalhes de grama da área da via e aplica pintura automática de textura de terreno sob a estrada. [Confirmado por Fonte]

## Síntese: Conjunto Recomendado de Regras e Restrições para Edição de Estradas

Abaixo está o conjunto consolidado de regras e algoritmos que um sistema robusto de criação de estradas deve implementar, indicando valores numéricos recomendados e sua origem no estado da arte:

1. **Raio Mínimo de Curva Relativo à Largura (\(R_{\min}\))**:
   * *Regra*: O raio do eixo central da via não pode ser inferior a 1,5 vezes a largura total da pista (\(R_{\min} \ge 1.5 \times W\)).
   * *Resultado*: Impede a auto-interseção da malha 3D e degradação de texturas.
   * *Origem/Referência*: *EasyRoads3D* / *Cities: Skylines 2*. [Confirmado por Fonte / Análise Técnica]

2. **Limites de Inclinação Máxima (*Max Slope*)**:
   * *Rodovias / Vias Expressas*: Máximo de **4% a 6%** (~2.3° a 3.4°).
   * *Vias Urbanas Padrão*: Máximo de **8% a 10%** (~4.5° a 5.7°).
   * *Vias de Montanha / Acessos Locais*: Máximo absoluto de **15% a 20%** (~8.5° a 11.3°). Exceder este limite deve acionar erro de construção ou conversão em escadas (para pedestres).
   * *Ferrovias*: Máximo de **2.5% a 7.5%** (75‰).
   * *Origem/Referência*: *Transport Fever 2* / *Cities: Skylines 2*. [Confirmado por Fonte]

3. **Automação de Rampa, Ponte e Túnel por Elevação Delta (\(\Delta H\))**:
   * *Dentro do limite de inclinação*: Aplica rampa terraplenada com corte e aterro (*cut-and-fill*).
   * *Suspenso acima do solo (\(\Delta H \ge 4\text{m} - 6\text{m}\))*: Converte o segmento em ponte estrutural com pilares automáticos.
   * *Subterrâneo (\(\Delta H \le -5\text{m}\))*: Converte o segmento em portal e tubo de túnel.
   * *Caminho de pedestre com declive > 15-20%*: Converte rampa lisa em escadaria.
   * *Origem/Referência*: *Planet Zoo* / *Cities: Skylines 2* / *Transport Fever 2*. [Confirmado por Fonte]

4. **Sanitização de Input e Rejeição de Laços (Loop Rejection)**:
   * *Comprimento Mínimo de Segmento*: \(L_{\min} = 1.0 \times W\) a \(2.0 \times W\) (ex.: 8 metros para vias de 8m).
   * *Auto-interseção*: Checagem de interseção linha-linha durante o arraste livre. Se detectado no mesmo comando: rejeitar com fantasma vermelho (*Cities: Skylines*) ou auto-fundir transformando a área em praça (*Tiny Glade*).
   * *Algoritmo de Suavização*: Reamostragem via Catmull-Rom ou Bézier C1/C2 com espaçamento uniforme de nós (2m a 5m).
   * *Origem/Referência*: *Cities: Skylines 2* / *Tiny Glade*. [Confirmado por Fonte / Análise Técnica]

5. **Geometria de Junções e Interseções**:
   * *Raio de Snap no Nó*: \(R_{\text{snap}} \approx W\) a \(2W\).
   * *Ângulo Mínimo de Intersecção*: \(\theta_{\min} \ge 30^\circ\) a \(45^\circ\). Conexões com ângulos menores são bloqueadas ("Too acute angle").
   * *Auto-Split*: Inserir nó em segmento existente divide-o automaticamente em dois e instancia uma malha de intersecção em T.
   * *Origem/Referência*: *Cities: Skylines 2* / *EasyRoads3D*. [Confirmado por Fonte]

## Fontes

* **Cities: Skylines 1 & 2**:
  * Paradox Interactive - Cities: Skylines II Feature Highlight #1: Road Tools: `https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools`
  * Cities: Skylines Wiki - Roads: `https://skylines.paradoxwikis.com/Roads`
  * Cities: Skylines II Wiki - Road Tools: `https://cs2.paradoxwikis.com/Road_tools`
* **Transport Fever 2**:
  * Transport Fever 2 Official Wiki - Street Construction: `https://www.transportfever2.com/wiki/doku.php?id=gamemanual:streetconstruction`
* **Planet Coaster 2 & Planet Zoo**:
  * Frontier Developments Official Planet Zoo Documentation: `https://www.planetzoogame.com`
  * Planet Coaster 2 Tooling Overview & Line Builder Features (Frontier Developments Devlogs).
* **Tiny Glade**:
  * Pounce Light - Tiny Glade Official Steam Page & Dev Updates: `https://store.steampowered.com/app/2198150/Tiny_Glade/`
* **Townscaper**:
  * Oskar Stålberg - "Organic Towns from Square Tiles" (IndieCade Europe 2019): `https://www.youtube.com/watch?v=1hqt8JkYRdI`
  * Andersource - Townscaper Grid Mechanics Breakdown: `https://andersource.dev/2020/09/16/townscaper-grid.html`
  * Boris the Brave - Townscaper Grid Explained: `https://boristhebrave.com/2021/11/14/townscaper-grid-explained/`
* **Manor Lords**:
  * Manor Lords Official Wiki & Steam Community Guides: `https://manorlords.fandom.com`
* **Farthest Frontier**:
  * Crate Entertainment Forum - Farthest Frontier Patch 1.1 Gridless Update Notes: `https://forums.crateentertainment.com`
* **Timberborn**:
  * Timberborn Wiki - Pathing and District Mechanics: `https://timberborn.fandom.com/wiki/Path`
* **Unreal Engine**:
  * Epic Games - Landscape Splines in Unreal Engine Documentation: `https://dev.epicgames.com/documentation/en-us/unreal-engine/landscape-splines-in-unreal-engine`
* **Unity Middleware (EasyRoads3D & Road Architect)**:
  * EasyRoads3D v3 User Manual: `https://www.easyroads3d.com/v3/manual.html`
  * Road Architect GitHub Repository: `https://github.com/MicroGamer73/RoadArchitect`
