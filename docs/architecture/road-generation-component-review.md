# Recortes de geração e atualização de ruas — #328

Verificado em 2026-09-29. Task TASK-324-ROAD-EDITOR-STABILITY, base ea9b3d9b. Pesquisa de fontes primárias com revisões fixadas; nenhuma dependência instalada e nenhum código externo copiado.

## Godot Road Generator

Revisão 980bc04c9f95a5c49b787f0a7a64a458156d5b9b. [Licença MIT](https://github.com/TheDuckCow/godot-road-generator/blob/980bc04c9f95a5c49b787f0a7a64a458156d5b9b/LICENSE), Moo-Ack! Productions.

No [road_segment.gd](https://github.com/TheDuckCow/godot-road-generator/blob/980bc04c9f95a5c49b787f0a7a64a458156d5b9b/addons/road-generator/nodes/road_segment.gd#L184), check_rebuild valida container e extremos, atualiza referências prior/next e reconstrói quando is_dirty. _rebuild, linha 640, atualiza curva, malha e dados derivados. _update_curve, linha 670, usa dois RoadPoints e suas tangentes; bake_interval controla densidade.

[_build_geo, linha 816](https://github.com/TheDuckCow/godot-road-generator/blob/980bc04c9f95a5c49b787f0a7a64a458156d5b9b/addons/road-generator/nodes/road_segment.gd#L816), recebe curva, faixas e densidade; produz malha via SurfaceTool e GeoLoopInfo. Quantidade de seções depende do comprimento assado/densidade, com mínimo de uma. Sem faixas, gera malha vazia. Custo acompanha seções e faixas; não foi medido. Não comprova ausência de auto-interseção ou invalidação mínima de toda rede. Curve3D, Node3D, transformações, tráfego e SurfaceTool são dependências do motor; não serão portados.

A [documentação de conexões entre containers](https://github.com/TheDuckCow/godot-road-generator/wiki/A-getting-started-tutorial#step-10-moveadjust-connected-roadcontainers) admite ligação virtual, posições que podem divergir, referências de tráfego incompletas e alterações de perfil sem propagação. Esse modelo não substitui a conectividade autoritativa do grafo Grafting.

## Road Architect

Revisão ae6c383c8ab380626c87e07f8c793e46cf9f289f. [Licença MIT](https://github.com/FritzsHero/RoadArchitect/blob/ae6c383c8ab380626c87e07f8c793e46cf9f289f/LICENSE.md), MicroGSD LLC, 2018. Arquivos foram recuperados por HTTP 200 e inspecionados em faixas específicas através de graft_task_test; a indisponibilidade inicial no leitor web não foi tomada como ausência da fonte.

[RoadCalcs1.cs, linhas 13–25](https://github.com/FritzsHero/RoadArchitect/blob/ae6c383c8ab380626c87e07f8c793e46cf9f289f/Scripts/RoadCalcs1.cs#L13), recebe Road e buffer; o trabalho chama RoadJobPrelim e RoadJob1. [RoadCalcs2.cs, linhas 12–22](https://github.com/FritzsHero/RoadArchitect/blob/ae6c383c8ab380626c87e07f8c793e46cf9f289f/Scripts/RoadCalcs2.cs#L12), recebe buffer e chama RoadJob2. São adaptadores de trabalho, não algoritmos de spline isolados. Exceções são comunicadas pelo estado do editor.

[RoadCreationT.cs](https://github.com/FritzsHero/RoadArchitect/blob/ae6c383c8ab380626c87e07f8c793e46cf9f289f/Scripts/RoadCreationT.cs#L14) contém RoadJobPrelim, linha 14. A linha 56 calcula passo como roadDefinition/distância da spline; não é garantia matemática de comprimento de arco exato. A preparação depende de perfis, spline, terreno, interseções e buffers Unity. O bloco de conexões, linha 2339, modifica buffers de acostamento para extremos especiais. Isso não demonstra atualização local independente de toda estrada. RoadJob1 e RoadJob2 começam nas linhas 5018 e 5047.

[RoadConstructorBufferMaker.cs](https://github.com/FritzsHero/RoadArchitect/blob/ae6c383c8ab380626c87e07f8c793e46cf9f289f/Scripts/RoadConstructorBufferMaker.cs#L630): MeshSetup1, linha 630, converte vetores/triângulos/normais em Mesh, com caminho condicionado ao limite de 64000 vetores. MeshSetup2, linha 878, acrescenta UVs, tangentes, materiais, colliders e hierarquia. Destino e invariantes são específicos do Unity. Não foi benchmarkado nem avaliado como solução de curvas degeneradas.

## Comparação com a implementação atual

| Capacidade | Fonte externa | Grafting atual | Resultado da avaliação |
|---|---|---|---|
| Autoria e resolução de malha separadas | Godot Curve3D/densidade; Road Architect spline/buffers | automatic_path/interpretStroke e ribbon_profile no Rust | Preservar a separação; a prévia por pontos passa a usar a curva autoritativa |
| Validade da faixa | Seções laterais do Godot; buffers Unity | bezier_surface.rs rejeita offsets inválidos e tangentes estacionárias; union_ribbons normaliza sobreposição planar | Manter o core; sem falha reproduzida que justifique substituir o gerador |
| Conexões | prior/next, ligações entre containers e extremos especiais Unity | bezier_network.rs com tolerância de posição/altura e divisão de aresta | Usar fontes como referência; não portar conexões virtuais ou regras de tráfego |
| Atualização | dirty/rebuild do Godot; jobs/buffers do Road Architect | regeneratePathSpine resolve changedSpineCloud e refaz o componente conectado | Não prometer apenas dois segmentos; junções e união têm dependências reais |
| Isolamento | Objetos de editor e motor | geometria Rust, backend Three privado, orquestração VTT | Preservar fronteiras; sem nova biblioteca ou segunda spline autoritativa |

## Plano mínimo aplicado e limites

O defeito reproduzido é a divergência entre prévia reta e curva confirmada, além do descarte de pontos próximos/verticais. A correção usa automatic e ribbon já existentes no Rust; não exige um algoritmo externo. Entradas candidatas são validadas antes de substituir o rascunho. Os recortes externos foram usados como referência e descartados para cópia, pois não corrigem esses defeitos e adicionariam dependências de motor.

Os testes adicionais cobrem S/U, espaçamento desigual, elevação, faixa curta/larga, coordenadas e índices finitos, e preservação de todos os nós/arestas/controles de outra rua desconectada. Testes anteriores cobrem divisão exata, largura variável, rollback, cruzamento em alturas distintas e undo/redo. A finitude de uma malha não prova costura ou aparência correta. Permanecem pendentes a medição visual de junções/terreno, orçamento de latência e custo de picking/render.

Uma otimização por segmento exigiria medir a região afetada e preservar dependências da união e das junções; não será inferida apenas do padrão dirty. A regeneração atual é por componente conectado. Nenhum código licenciado foi copiado; se uma futura adaptação copiar trechos MIT, deverá manter licença, copyright e origem fixada junto ao destino.
