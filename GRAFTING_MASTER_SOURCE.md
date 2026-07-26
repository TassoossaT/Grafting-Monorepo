# Grafting Monorepo — Fonte Mestre de Arquitetura e Criação

> **Documento canônico unificado para produto, arquitetura, criação e AI Control Plane.**
>
> Versão: `1.1.0`  
> Data-base original: 23 de julho de 2026  
> Data de consolidação: 26 de julho de 2026  
> Estado: `CANONICAL-UNIFIED`  
> Próximo marco: fechar os Decision Gates da Seção 5 e executar a Fase 0 unificada antes do scaffold definitivo.
>
> Nome do projeto: **Grafting Monorepo**  
> Subsistema de interoperabilidade: **Isekai**  
> AI Control Plane: **`.ai/`**  
> Contrato operacional por escopo: **`AGENTS.md`**
>
> **Substitui como autoridade corrente:** `MONOREPO_CREATION_SPEC.md`, `RELATORIO_GRAFTING_MONOREPO.md`, `arquitetura-ia-claude-gpt-monorepo.md`, `GRAFTING_AI_CREATION_APPEND.md` e fontes derivadas anteriores.

---

## 0. Como usar este documento

Este arquivo não é apenas uma descrição de arquitetura. Ele é simultaneamente:

1. a definição do produto técnico;
2. o registro das decisões arquiteturais já tomadas;
3. a fonte mestre para criação e evolução do monorepo;
4. o plano de criação incremental do repositório;
5. o backlog inicial com critérios de aceite;
6. a base para ADRs, runbooks, contratos e documentos gerados;
7. a definição do Knowledge & Automation Plane;
8. a definição do AI Control Plane para Claude, GPT/Codex e futuros provedores.

Todo humano ou agente deve ler este arquivo antes de propor ou executar alterações estruturais. `AGENTS.md` complementa este documento com regras operacionais específicas do escopo; `.ai/` contém as capacidades e políticas do sistema de IA.

### 0.1 Linguagem normativa

Os termos abaixo têm significado deliberado:

- **DEVE / NÃO DEVE:** regra obrigatória.
- **DEVERIA / NÃO DEVERIA:** padrão recomendado; exceções precisam ser justificadas.
- **PODE:** decisão local permitida.
- **LOCKED:** decisão arquitetural fechada.
- **PROVISIONAL:** padrão inicial que precisa ser validado por um spike.
- **OPEN:** decisão humana ainda não tomada.

### 0.2 Regra de precedência

Em caso de conflito:

1. requisitos explícitos mais recentes do proprietário do projeto;
2. ADR aceito mais recente;
3. este documento mestre;
4. contratos e schemas versionados;
5. `AGENTS.md` aplicável ao escopo;
6. código, manifests e pipelines existentes;
7. `.ai/` para políticas e capacidades do AI Control Plane;
8. adapters de fornecedor como `CLAUDE.md`, `.claude/`, `.codex/` e `.agents/`;
9. documentação gerada e visualizações;
10. suposições do agente.

Se o código contradizer uma decisão `LOCKED`, o agente NÃO DEVE assumir que o código venceu. Deve reportar o desvio e pedir uma decisão. `.ai/` NÃO DEVE sobrescrever silenciosamente um contrato operacional em `AGENTS.md`; adapters de fornecedor NÃO DEVEM contradizer nenhuma das duas camadas.

### 0.3 O que um agente não pode fazer silenciosamente

O agente NÃO DEVE:

- transformar uma decisão `OPEN` em implementação definitiva;
- trocar uma tecnologia `LOCKED` por preferência própria;
- criar uma segunda implementação da lógica proprietária em TypeScript, C# ou Python;
- expor tipos Rust diretamente pela FFI;
- chamar replicação de estado de Event Sourcing;
- prometer zero-copy entre domínios de memória distintos;
- fazer um target cacheável executar efeitos externos;
- adicionar uma nova raiz de workspace ou um novo lockfile sem ADR;
- introduzir containers como requisito para toda compilação local;
- reescrever amplamente arquivos não relacionados à tarefa;
- gerar diretórios futuros vazios apenas para “completar” a árvore;
- criar uma segunda fonte durável de tarefas;
- expandir permissões, hooks, sandbox ou MCPs sem aprovação;
- habilitar cache semântico para código, segurança, incidentes ou estado mutável;
- promover aprendizado ou autorreescrita sem evidência, eval e rollback.

---

## 1. Visão do produto

O repositório abrigará dois produtos principais:

1. **Virtual Tabletop Web**
   - TypeScript;
   - Three.js;
   - interface web;
   - consumo do motor por WebAssembly;
   - simulação e computação pesada fora da main thread.

2. **Jogo Desktop Nativo**
   - C#/.NET;
   - engine gráfica ainda a decidir;
   - consumo do motor por biblioteca nativa;
   - suporte inicial prioritário a Windows, com desenho compatível com Linux e macOS.

Os dois produtos consumirão o mesmo núcleo proprietário em Rust.

### 1.1 Objetivo central

Construir um motor lógico, matemático e de otimização que:

- seja a fonte única de verdade;
- seja reutilizável na Web e no Desktop;
- permita implementação futura de solver de otimização próprio;
- execute algoritmos na CPU e, quando vantajoso, na GPU;
- mantenha controle explícito de memória e ciclo de vida;
- não replique lógica proprietária nos hosts;
- possa futuramente operar localmente ou em servidor autoritativo.

### 1.2 O que “core único” significa

“Core único” significa:

- uma única modelagem matemática;
- uma única implementação das regras de negócio;
- um único algoritmo de solver;
- uma única coleção de kernels WGSL;
- um único protocolo de comandos, eventos e snapshots;
- bindings finos, sem reimplementar comportamento;
- backends de execução intercambiáveis atrás de contratos internos.

“Core único” não significa:

- um único processo;
- um único binário para todos os sistemas;
- uma única instância de dispositivo lógico GPU;
- uma referência Rust atravessando qualquer runtime;
- uma única representação física da memória em CPU, Wasm, Worker, GPU e rede.

### 1.3 Critérios de sucesso arquiteturais

O projeto será considerado bem estruturado quando:

- uma regra alterada no Rust produz o mesmo comportamento nos dois produtos;
- o Web e o Desktop não possuem cópias do solver;
- uma mudança de contrato incompatível falha cedo no build;
- uma ABI incompatível falha no startup, não durante gameplay;
- tarefas afetadas são executadas em ordem correta pelo Nx;
- cada compilador continua sendo operado por sua toolchain nativa;
- o cache nunca mascara efeitos externos ou artefatos de outra plataforma;
- a ausência de WebGPU aciona fallback CPU controlado;
- o renderer não precisa conhecer a implementação interna do solver;
- o solver não precisa conhecer Three.js, a engine C# ou protocolos de transporte.

### 1.4 Identidade e taxonomia

O projeto se chama **Grafting Monorepo**, inspirado na ideia de enxertar ou conectar partes que originalmente pertencem a lugares diferentes em um sistema coerente.

Convenções:

| Contexto | Nome |
|---|---|
| Nome humano do projeto | `Grafting Monorepo` |
| Slug recomendado do repositório | `grafting` |
| Prefixo de crates Rust | `grafting-*` |
| Escopo de pacotes npm | `@grafting/*` |
| Namespace raiz C# | `Grafting.*` |
| Ponte entre runtimes/linguagens | `Isekai` |

**Isekai** é o bounded context que transporta dados, comandos, resultados e ciclos de vida entre “mundos” de execução:

- Rust nativo ↔ C#/.NET;
- Rust/Wasm ↔ TypeScript;
- memória linear Wasm ↔ TypedArrays;
- memória nativa ↔ spans/views C#.

O nome não substitui terminologia técnica. APIs públicas continuam explícitas:

```text
engine_submit
engine_job_poll
engine_buffer_release
```

e não usam nomes metafóricos como `send_to_another_world`.

Limites:

- Isekai não contém regra de negócio;
- Isekai não implementa solver;
- Isekai não possui renderização;
- Isekai não é o sistema de multiplayer;
- Isekai depende do engine; o engine não depende de Isekai;
- rede continua nos contextos `replication` e `transport`.

Essa disciplina permite usar uma identidade memorável sem prejudicar a leitura técnica do código.

Componentes previstos:

| Artefato | Responsabilidade |
|---|---|
| `grafting-isekai-wasm` | crate Rust que expõe o core para Wasm |
| `grafting-isekai-capi` | crate Rust que expõe a C ABI nativa |
| `@grafting/isekai-wasm` | pacote npm com Wasm, loader e tipos |
| `@grafting/isekai-web` | cliente TypeScript/Worker idiomático |
| `Grafting.Isekai.Interop` | wrapper C# seguro da biblioteca nativa |
| `Grafting.Isekai.Protocol` | tipos C# gerados dos contratos binários |

No Nx, os nomes de projeto devem continuar únicos, por exemplo:

```text
isekai-wasm-bridge
isekai-capi-bridge
isekai-wasm-package
isekai-web-client
isekai-dotnet-interop
isekai-dotnet-protocol
```

---

## 2. Princípios arquiteturais

### 2.1 Fonte única de verdade

Toda lógica que precisa produzir o mesmo significado em Web, Desktop ou servidor DEVE viver no Rust ou em contratos compartilhados.

TypeScript e C# são hosts:

- coletam input;
- controlam UI e renderização;
- operam transporte;
- convertem erros para a linguagem do host;
- chamam operações em lote;
- apresentam resultados.

Eles NÃO DEVEM reproduzir regras internas do core.

### 2.2 Meta-orquestração

Nx será o orquestrador superior, não o substituto dos compiladores.

| Ecossistema | Autoridade nativa | Papel do Nx |
|---|---|---|
| TypeScript | pnpm + Vite/tsc/test runner | ordenar, filtrar afetados e cachear |
| Rust | Cargo + rustup + wasm tooling | ordenar targets, declarar inputs/outputs e cachear artefatos finais |
| C# | dotnet + MSBuild | integrar projetos ao grafo e executar targets |
| Python | uv + Python | preparar ambiente e executar pacotes/scripts |
| Contratos | `flatc` | gerar linguagens na ordem correta |
| Documentação | gerador específico | orquestrar e validar deriva |

Nx não resolverá dependências Python, não substituirá Cargo, não compilará C# diretamente e não será a fonte da verdade das dependências desses ecossistemas.

### 2.3 Toolchains nativas e builds nativos

Artefatos dependentes de plataforma DEVEM ser construídos no sistema ou runner correspondente:

- Wasm: runner Linux para build normal;
- `.dll`: Windows;
- `.so`: Linux;
- `.dylib`: macOS;
- testes gráficos DirectX: Windows com hardware apropriado;
- testes gráficos Metal: macOS com hardware apropriado.

Containers PODEM ser usados em CI, serviços auxiliares e ambientes reprodutíveis específicos, mas NÃO DEVEM ser a abstração universal do desenvolvimento ou substituir runners gráficos nativos.

### 2.4 Performance comprovada

O projeto NÃO DEVE usar GPU, FlatBuffers, pinning, SharedArrayBuffer ou unsafe apenas por prestígio arquitetural.

Cada otimização importante deve possuir:

- benchmark representativo;
- baseline CPU;
- medida de upload;
- medida de compute;
- medida de readback;
- tamanho do lote;
- consumo de memória;
- comportamento em fallback.

### 2.5 Portabilidade antes de interop de baixo nível

Na primeira versão:

- dispositivos e buffers de renderização não serão compartilhados com o `wgpu`;
- recursos GPU do solver serão privados do Rust;
- resultados atravessarão uma fronteira CPU explícita;
- interop de recursos externos por D3D12/Vulkan/Metal só poderá entrar após benchmark e ADR.

---

## 3. Registro resumido de decisões

### 3.1 Decisões `LOCKED`

| ID | Decisão |
|---|---|
| DEC-001 | Rust é a fonte única da lógica, matemática e solver proprietário. |
| DEC-002 | Nx atua como meta-orquestrador; toolchains nativas permanecem soberanas. |
| DEC-003 | pnpm gerencia o workspace Node/TypeScript. |
| DEC-004 | Cargo gerencia crates, features, targets e dependências Rust. |
| DEC-005 | uv gerencia Python, ambientes e lockfile. |
| DEC-006 | dotnet/MSBuild gerencia projetos C#. |
| DEC-007 | O Rust possui os recursos GPU de computação; os hosts possuem os recursos de renderização. |
| DEC-008 | O backend GPU será baseado em `wgpu`; kernels portáveis serão escritos em WGSL. |
| DEC-009 | O backend GPU possui fallback CPU funcional. |
| DEC-010 | Chamadas FFI serão em lote; operações iterativas por entidade são proibidas no hot path. |
| DEC-011 | A ABI desktop será uma C ABI versionada com handles opacos e tipos de largura fixa. |
| DEC-012 | ABI, protocolo de rede e versão do produto são eixos de versão separados. |
| DEC-013 | FlatBuffers será usado em dados estruturados; arrays numéricos quentes usarão layouts brutos explícitos. |
| DEC-014 | “Zero-copy” não será descrito como propriedade end-to-end. |
| DEC-015 | A Web executará Wasm/simulação/compute em Dedicated Worker. |
| DEC-016 | Multiplayer inicial será replicação autoritativa com journal e snapshots, não Event Sourcing completo. |
| DEC-017 | Builds nativos ocorrerão em runners do sistema de destino. |
| DEC-018 | Código gerado não será obrigatoriamente commitado; geração será uma tarefa determinística. |
| DEC-019 | `.venv` nunca será compartilhado entre Windows, WSL, Linux, macOS ou checkouts diferentes. |
| DEC-020 | O Global Virtual Store experimental do pnpm não é requisito arquitetural. |
| DEC-021 | Exportação do grafo Nx é contexto estrutural derivado, não RAG. |
| DEC-022 | `AGENTS.md` será o contrato agnóstico de agente; arquivos específicos de fornecedor serão adaptadores curtos. |
| DEC-023 | O projeto se chama Grafting; Isekai é exclusivamente a fronteira de interoperabilidade entre runtimes e linguagens. |
| DEC-024 | `AGENTS.md` raiz e local é o contrato operacional canônico por escopo. |
| DEC-025 | `.ai/` é a fonte canônica do AI Control Plane: skills, agentes, prompts, policies, workflows, evals, catálogo e roteamento. |
| DEC-026 | `CLAUDE.md`, `.claude/`, `.codex/` e `.agents/` são adapters de fornecedor e não fontes arquiteturais paralelas. |
| DEC-027 | Knowledge & Automation Plane e Graph IR mínimo são P0. |
| DEC-028 | Todo projeto Nx nasce com `project.json`, `README.md`, `AGENTS.md`, metadata de Graph IR e `src/`. |
| DEC-029 | Capacidades, skills, ferramentas e contexto são carregados sob demanda. |
| DEC-030 | Agent Skills é o formato base interoperável de skills. |
| DEC-031 | Haverá uma única fonte durável de tarefas; Backlog.md é o default inicial. |
| DEC-032 | Cada tarefa possui um único proprietário executor por vez; executores paralelos usam worktrees distintas. |
| DEC-033 | O implementador não pode ser o único revisor da própria mudança. |
| DEC-034 | Aprendizado contínuo é evidence-driven, avaliado e approval-gated. |
| DEC-035 | A manutenção pós-ferramenta é determinística e não chama modelo. |
| DEC-036 | Cache semântico permanece desabilitado por padrão e proibido para código, segurança, incidentes e side effects. |
| DEC-037 | Prompts canônicos vivem em `.ai/prompts/`; registros externos são projeções publicadas. |
| DEC-038 | Integrações externas de IA entram por spike, quarentena, licença, segurança e avaliação. |
| DEC-039 | Nenhuma integração de IA pode criar outra raiz de workspace, lockfile ou toolchain sem ADR. |
| DEC-040 | O Grafting Graph IR representa também capacidades, skills, agentes, prompts, ferramentas, políticas, evals, tarefas e runs. |

### 3.2 Decisões `PROVISIONAL`

| ID | Decisão a validar |
|---|---|
| PROV-001 | Usar o plugin oficial `@nx/dotnet`, atualmente sujeito a validação de maturidade no spike. |
| PROV-002 | Usar `wasm-pack` como empacotador inicial do binding Wasm. |
| PROV-003 | Usar FlatBuffers para Commands, DomainEvents, ReplicationDeltas e Snapshots. |
| PROV-004 | Manter um único `uv.lock` para os pacotes Python compatíveis do workspace. |
| PROV-005 | Usar uma única versão de produto enquanto os artefatos forem internos. |
| PROV-006 | Manter o `wgpu::Device` do Web dentro do mesmo Worker que possui a instância Wasm. |
| PROV-007 | Usar Bifrost como gateway central, inicialmente por contêiner pinado ou serviço externo. |
| PROV-008 | Usar BAML como compilador tipado de prompts. |
| PROV-009 | Usar Langfuse para tracing, datasets e versões publicadas de prompts. |
| PROV-010 | Usar Promptfoo para evals rápidas e regressões. |
| PROV-011 | Usar LangMem para extração e consolidação de learning candidates. |
| PROV-012 | Usar GEPA/DSPy para otimização offline de variantes. |
| PROV-013 | Usar LLMLingua somente para compressão seletiva de conteúdo não normativo. |
| PROV-014 | Usar Serena e ast-grep como complementos de inteligência de repositório. |

### 3.3 Decisões `OPEN`

| Gate | Decisão humana necessária | Impacto |
|---|---|---|
| GATE-001 | Framework web: React/Vite, React/Next ou outro | estrutura de `apps/web-vtt`, SSR e build |
| GATE-002 | Engine C#: Unity, Godot C#, MonoGame, Stride ou engine própria | integração nativa, packaging e ownership de thread |
| GATE-003 | Plataformas desktop V1 | matriz de CI e formatos publicados |
| GATE-004 | Linguagem do host do servidor autoritativo | árvore futura e deployment |
| GATE-005 | Grau de determinismo exigido | tipos numéricos, replay e validação |
| GATE-006 | Política de suporte quando WebGPU estiver indisponível | UX, fallback e requisitos mínimos |
| GATE-007 | Estratégia de distribuição: monolítica ou pacotes publicáveis | versionamento e release |
| GATE-008 | Licença e política de código proprietário | publicação e distribuição de símbolos |
| GATE-009 | Persistência do multiplayer | journal, snapshots e operação |

Nenhum gate impede criar provas de conceito isoladas. Os gates GATE-001 a GATE-003 impedem o scaffold definitivo das aplicações.

---

## 4. Arquitetura lógica

### 4.1 Visão geral

```mermaid
flowchart TB
    Web["Web VTT<br/>TypeScript + Three.js"]
    Desktop["Desktop Game<br/>C# + engine"]
    Isekai["Isekai<br/>Wasm e C ABI"]
    Core["Rust Core único<br/>domínio + solver"]
    Backends["Compute backends<br/>CPU e wgpu"]

    Web --> Isekai
    Desktop --> Isekai
    Isekai --> Core
    Core --> Backends
```

### 4.2 Camadas do motor

#### `domain-core`

Responsável por:

- regras de negócio;
- estado autoritativo;
- máquina de estados;
- validação de Commands;
- aplicação de mudanças;
- geração de DomainEvents;
- RNG controlado;
- hashes de estado;
- APIs independentes de transporte e renderização.

Não pode depender de:

- Three.js;
- C#;
- Web APIs;
- sockets;
- banco de dados;
- `wgpu`;
- sistema de arquivos do host;
- relógio global não injetado.

#### `compute-api`

Define:

- operações matemáticas;
- tipos de job;
- capacidades;
- políticas de fallback;
- contratos entre domínio e backends;
- planos de execução em lote.

Não deve expor tipos concretos do `wgpu`.

#### `compute-cpu`

Responsável por:

- implementação de referência;
- execução em máquinas sem WebGPU;
- testes diferenciais;
- verificação final de resultados;
- workloads pequenos em que a GPU seria mais lenta.

#### `compute-wgpu`

Responsável por:

- criação do adapter/device/queue;
- pipelines;
- cache de pipelines;
- buffers persistentes;
- arenas de upload;
- readback assíncrono;
- kernels WGSL;
- capability negotiation;
- recuperação de device loss;
- métricas de upload/dispatch/readback.

#### `projection-core`

Responsável por:

- transformar estado/eventos autoritativos em visão permitida para cada cliente;
- esconder informações privadas;
- produzir `ReplicationDelta`;
- não conhecer WebSocket, UDP, TCP ou autenticação concreta.

#### `isekai-wasm`

Responsável por:

- adaptar offsets e comprimentos da memória linear;
- expor handles numéricos;
- inicialização assíncrona;
- integração com Worker;
- converter erros em códigos/estruturas estáveis;
- nunca duplicar regras.

#### `isekai-capi`

Responsável por:

- exports `extern "C"`;
- ABI versionada;
- validação de ponteiros;
- `catch_unwind` na fronteira;
- handles generacionais;
- status codes;
- funções de criação/liberação;
- nunca expor `Vec`, `String`, trait object ou enum Rust.

### 4.3 Domínios futuros

Domínios como física, pathfinding, IA e otimização devem ser adicionados por feature slice.

Um domínio pode conter:

- contratos próprios;
- crate Rust;
- testes;
- benchmarks;
- documentação local;
- integração com `domain-core` ou `compute-api`.

Não devem ser criados diretórios vazios antecipadamente. O gerador local criará cada slice quando houver uma feature real.

---

## 5. Decision Gates a fechar

Esta seção deve ser respondida pelo proprietário antes do scaffold final. O agente pode preparar comparações e spikes, mas não escolher silenciosamente.

### GATE-001 — Host Web

Perguntas:

- O VTT é uma SPA cliente ou precisa de SSR?
- Haverá páginas públicas indexáveis?
- A aplicação precisa de rotas de servidor do mesmo framework?
- O deploy será estático, Node ou edge?

Default recomendado para um VTT predominantemente cliente:

> React + Vite + Three.js, com serviços de backend separados.

Motivo:

- inicialização simples do Worker/Wasm;
- menor acoplamento com SSR;
- ciclo rápido para renderização interativa;
- packaging previsível.

### GATE-002 — Engine Desktop

A escolha precisa avaliar:

- possibilidade de distribuir uma DLL Rust;
- modelo de threading;
- suporte a P/Invoke;
- controle de packaging por RID;
- política de plugins nativos;
- acesso a janela/input;
- restrições de licença;
- capacidade de rodar testes sem editor.

O core não deve assumir Unity, Godot ou outra engine até o gate fechar.

### GATE-003 — Plataformas V1

Default pragmático sugerido:

- Web: navegadores modernos com WebAssembly;
- GPU Web: WebGPU quando disponível;
- Desktop V1: Windows x64;
- Linux/macOS: core compilável e validado progressivamente, sem prometer cliente final na primeira milestone.

### GATE-004 — Servidor autoritativo

Opções aceitáveis:

- host TypeScript/Node carregando Wasm ou addon nativo;
- host C# carregando biblioteca nativa;
- host Rust chamando o core diretamente.

Critério principal:

- operação, observabilidade e escala do host;
- não a linguagem do solver, que continuará Rust.

### GATE-005 — Determinismo

Devem ser diferenciados:

1. determinismo semântico;
2. determinismo de replay em mesma plataforma;
3. determinismo bit-a-bit entre plataformas;
4. validade matemática dentro de tolerância.

GPU floating-point não deve ser usada para decisões que exigem igualdade bit-a-bit entre máquinas. Um solver pode usar GPU para busca e CPU para validar a solução final.

---

## 6. Topologia física proposta

### 6.1 Árvore inicial

```text
/
├── GRAFTING_MASTER_SOURCE.md
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── grafting.graph.json
├── .mcp.json
├── .ai/
│   ├── README.md
│   ├── registry/
│   ├── policies/
│   ├── skills/
│   ├── agents/
│   ├── prompts/
│   ├── workflows/
│   ├── context/
│   ├── contracts/
│   ├── adapters/
│   ├── evals/
│   ├── catalog/
│   ├── state/
│   ├── reports/
│   └── scripts/
├── .claude/
├── .codex/
├── .agents/
├── nx.json
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── Cargo.toml
├── Cargo.lock
├── rust-toolchain.toml
├── pyproject.toml
├── uv.lock
├── .python-version
├── global.json
├── Directory.Build.props
├── Directory.Packages.props
├── System.sln
├── apps/
│   ├── web-vtt/
│   ├── desktop-game/
│   └── architecture-studio/
├── libs/
│   ├── engine/
│   │   ├── contracts/
│   │   ├── domain-core/
│   │   ├── compute-api/
│   │   ├── compute-cpu/
│   │   ├── compute-wgpu/
│   │   └── projection-core/
│   ├── isekai/
│   │   ├── wasm-bridge/
│   │   └── capi-bridge/
│   └── domains/
├── packages/
│   ├── isekai-wasm/
│   ├── isekai-web-client/
│   ├── graph-model/
│   ├── graph-query/
│   ├── graph-workflow/
│   └── graph-x6/
├── dotnet/
│   ├── Grafting.Isekai.Interop/
│   └── Grafting.Isekai.Protocol/
├── python/
│   ├── automation/
│   ├── data-tools/
│   └── experiments/
├── tools/
│   ├── ai-gateway/
│   ├── nx-plugin/
│   ├── generators/
│   ├── graph-extractors/
│   └── scripts/
├── graphs/
│   ├── authored/
│   ├── schemas/
│   └── views/
├── backlog/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── runbooks/
│   ├── benchmarks/
│   ├── generated/
│   └── archive/superseded/
└── dist/
```

Diretórios associados a decisões `OPEN` não devem ser populados definitivamente antes do gate correspondente. A árvore é uma direção; não é autorização para criar todos os diretórios vazios.

Todo projeto Nx criado deve conter:

```text
project.json
README.md
AGENTS.md
metadata de Graph IR
src/
```

`CLAUDE.md` local só será criado quando existir necessidade específica do adapter Claude.

### 6.2 Regra correta para manifests

Haverá uma única **raiz de workspace e lockfile** por ecossistema, mas manifests locais continuarão existindo quando a toolchain exigir.

| Ecossistema | Único na raiz | Permitido/necessário nos membros |
|---|---|---|
| Rust | workspace `Cargo.toml`, `Cargo.lock` | um `Cargo.toml` por crate |
| Node | `pnpm-workspace.yaml`, `pnpm-lock.yaml` | um `package.json` por pacote/app |
| Python | workspace `pyproject.toml`, `uv.lock` | um `pyproject.toml` por membro empacotado |
| .NET | `System.sln`, props e packages centrais | um `.csproj` e, se lock mode for adotado, `packages.lock.json` por projeto |

É proibido criar:

- um segundo `Cargo.lock` dentro de crate membro;
- um segundo `pnpm-lock.yaml`;
- outro workspace uv independente sem ADR;
- solução .NET paralela sem motivo explícito;
- ambientes virtuais commitados.

### 6.3 Saídas determinísticas

Artefatos consumíveis devem convergir para:

```text
dist/
├── wasm/
│   └── engine/
├── native/
│   ├── win-x64/
│   ├── linux-x64/
│   └── osx-arm64/
├── dotnet/
├── python/
├── contracts/
└── docs/
```

Diretórios internos de compilação não são artefatos públicos:

- `target/`;
- `bin/`;
- `obj/`;
- `.venv/`;
- `node_modules/`;
- caches locais.

O Nx deve cachear artefatos finais ou saídas determinísticas, não ambientes inteiros.

---

## 7. Orquestração Nx

### 7.1 Papel

Nx deve:

- conhecer projetos;
- conhecer dependências;
- criar o DAG de tarefas;
- executar em ordem;
- paralelizar tarefas independentes;
- calcular hashes a partir de inputs;
- restaurar outputs e logs;
- executar somente afetados em PRs;
- fornecer generators locais;
- exportar o grafo estrutural.

Nx não deve:

- instalar toolchains durante cada target;
- sincronizar `.venv` em múltiplas tarefas paralelas;
- esconder dependências externas não declaradas;
- cachear ações com side effects;
- fingir hermeticidade que o workspace não possui.

### 7.2 Regra de cache

Uma tarefa só pode usar `cache: true` quando:

\[
f(\text{inputs declarados}, \text{toolchain}, \text{env declarada})
=
\text{outputs determinísticos}
\]

Targets cacheáveis:

- compile;
- build;
- lint;
- unit test determinístico;
- codegen;
- documentação gerada;
- benchmarks somente quando tratados como artefatos, não como comparação temporal absoluta.

Targets não cacheáveis:

- install/bootstrap;
- deploy;
- publish;
- assinatura;
- migração de banco;
- chamadas a serviços externos;
- testes end-to-end contra ambiente mutável;
- atualização de lockfile;
- download mutável sem checksum.

O Nx restaura tanto arquivos declarados quanto output de terminal. Inputs e outputs precisam ser ajustados por projeto, conforme a documentação oficial:

- <https://nx.dev/docs/features/cache-task-results>
- <https://nx.dev/docs/reference/project-configuration>

### 7.3 Convenção mínima de targets

Cada projeto aplicável deveria expor:

| Target | Função |
|---|---|
| `format:check` | verificar formatação |
| `lint` | análise estática |
| `typecheck` | checagem de tipos |
| `test` | testes unitários |
| `build` | produzir artefato |
| `codegen` | gerar fontes derivadas |
| `bench` | benchmark local |
| `package` | organizar artefato publicável |

Targets específicos:

- `build:wasm`;
- `build:native`;
- `test:abi`;
- `test:protocol`;
- `test:differential`;
- `test:gpu`;
- `docs:generate`;
- `docs:check`.

### 7.4 Dependências conceituais

```text
contracts:codegen
    ├──> domain-core:build
    ├──> isekai-web-client:build
    └──> isekai-dotnet-protocol:build

domain-core:build
    ├──> isekai-wasm-bridge:build
    └──> isekai-capi-bridge:build

isekai-wasm-bridge:build
    └──> isekai-wasm-package:package

isekai-capi-bridge:build
    └──> isekai-dotnet-interop:build

isekai-wasm-package:package
    └──> web-vtt:build

isekai-dotnet-interop:build
    └──> desktop-game:build
```

### 7.5 Projeto explícito antes de plugins sofisticados

Na fase inicial, Rust, Python e utilitários devem poder ser representados com `project.json` e comandos nativos.

Um plugin Nx local só deve abstrair algo depois de:

- haver pelo menos duas ocorrências reais;
- os inputs/outputs estarem compreendidos;
- o comando manual estar testado;
- a abstração reduzir manutenção.

Não criar um executor genérico “universal” que recrie Cargo, uv ou MSBuild.

### 7.6 Integração .NET

O plugin oficial `@nx/dotnet` deve ser avaliado em spike:

- detecção dos `.csproj`;
- dependências de projeto;
- targets inferidos;
- outputs;
- compatibilidade com a engine escolhida;
- comportamento em máquinas sem SDK .NET;
- custo de migração.

Se o spike falhar, o fallback é:

- projetos explícitos;
- `dotnet restore/build/test/publish`;
- dependências declaradas no grafo;
- sem abandonar Nx.

Para restore determinístico:

- versões NuGet ficam centralizadas em `Directory.Packages.props`;
- `RestorePackagesWithLockFile` deve ser habilitado;
- `packages.lock.json` deve ser commitado por projeto;
- CI usa `dotnet restore --locked-mode`;
- arquivos `bin/` e `obj/` não são fontes nem lockfiles.

Referências:

- <https://nx.dev/docs/technologies/dotnet/introduction>
- <https://nx.dev/docs/technologies/dotnet/guides/migrate-from-nx-dotnet-core>

### 7.7 Identidade e tags dos projetos

Projetos Nx devem usar nomes estáveis e tags previsíveis.

Categorias iniciais:

```text
scope:engine
scope:domain
scope:host
scope:tooling
scope:contracts

lang:rust
lang:typescript
lang:csharp
lang:python
lang:schema

platform:web
platform:desktop
platform:server
platform:cross

type:app
type:lib
type:binding
type:generator
type:test
```

Regras de fronteira:

- `scope:engine` não depende de `scope:host`;
- `scope:domain` não depende de bindings;
- hosts dependem de wrappers/bindings, não de detalhes internos do core;
- `compute-api` não depende de `compute-wgpu`;
- contratos não dependem de código gerado consumidor;
- ferramentas podem ler manifests, mas não entram no runtime do produto.

### 7.8 Dependências políglotas no grafo

Nx não deve “adivinhar” dependências Rust ou Python a partir de imports TypeScript.

Fase inicial:

- declarar `implicitDependencies` entre projetos políglotas;
- usar generators para atualizar essas dependências;
- validar o grafo em CI.

Fase posterior:

- plugin local pode ler `cargo metadata`;
- plugin local pode ler os membros e sources do uv;
- `@nx/dotnet` pode fornecer dependências `.csproj`;
- dependências geradas devem ser comparadas com o grafo declarado.

O plugin local não deve implementar um novo resolvedor. Ele apenas traduz metadata das toolchains para o modelo de projetos do Nx.

### 7.9 Exemplo de projeto Rust explícito

```json
{
  "name": "engine-compute-wgpu",
  "root": "libs/engine/compute-wgpu",
  "projectType": "library",
  "tags": [
    "scope:engine",
    "lang:rust",
    "platform:cross",
    "type:lib"
  ],
  "implicitDependencies": [
    "engine-compute-api"
  ],
  "targets": {
    "check": {
      "executor": "nx:run-commands",
      "options": {
        "command": "cargo check -p engine-compute-wgpu"
      },
      "cache": true,
      "inputs": [
        "{projectRoot}/**/*",
        "{workspaceRoot}/Cargo.toml",
        "{workspaceRoot}/Cargo.lock",
        "{workspaceRoot}/rust-toolchain.toml"
      ]
    }
  }
}
```

O exemplo é conceitual. O nome real do crate e os inputs compartilhados devem ser definidos por `namedInputs`.

### 7.10 Build directories e concorrência

Rust:

- `target/` pode continuar compartilhado pelo Cargo localmente;
- Nx não deve publicar `target/` como artefato;
- builds publicáveis copiam somente arquivos finais para `dist/`;
- targets Cargo excessivamente fragmentados podem disputar o mesmo lock;
- preferir tarefas Cargo de granularidade suficiente para evitar dezenas de processos redundantes.

Python:

- `uv sync` ocorre antes da execução paralela;
- tarefas paralelas usam `--no-sync`.

.NET:

- restore ocorre antes da matriz de build;
- targets não devem executar restore implícito quando `--no-restore` for seguro.

Node:

- `pnpm install` ocorre antes do Nx;
- targets não alteram lockfile ou `node_modules`.

### 7.11 Inputs globais

Hashes de build devem considerar, conforme o target:

- lockfile do ecossistema;
- manifest raiz;
- manifest do membro;
- toolchain pinada;
- schema;
- build profile;
- target triple/RID;
- features;
- variáveis de ambiente que alterem output;
- scripts realmente executados.

Não depender de uma variável externa escondida, como `RUSTFLAGS`, sem declará-la como input ou neutralizá-la no CI.

---

## 8. Gestão Python com uv e Nx

### 8.1 Modelo

Python será usado intensamente para:

- requisições HTTP;
- automações;
- geração de dados;
- experimentação;
- IA;
- análise;
- ferramentas de CI;
- documentação;
- scripts de manutenção.

uv é a fonte de verdade para:

- resolução de dependências;
- lock;
- criação de ambiente;
- execução;
- build de pacotes.

Nx apenas agenda essas operações.

### 8.2 Workspace

O workspace uv terá:

- um `pyproject.toml` raiz;
- um `uv.lock` cross-platform;
- membros com `pyproject.toml` próprio;
- dependências locais declaradas como workspace sources;
- grupos de dependência quando apropriado.

uv workspaces compartilham um único lockfile, mas cada pacote mantém sua própria declaração:

- <https://docs.astral.sh/uv/concepts/projects/workspaces/>

### 8.3 `.venv`

A regra é:

> um ambiente por checkout e por sistema operacional, reconstruível a partir de `uv.lock`.

`.venv`:

- não é universal;
- não é artefato do Nx;
- não é compartilhado Windows ↔ WSL;
- não é enviado ao cache remoto;
- não é executado em paralelo por jobs de `sync`;
- não é commitado.

### 8.4 Evitar corrida em tarefas paralelas

Fluxo local e CI:

1. executar `uv sync --locked` uma única vez no bootstrap;
2. executar tarefas Nx em paralelo;
3. dentro das tarefas usar:

```bash
uv run --locked --no-sync --package <pacote> <comando>
```

Isso impede que vários targets tentem mutar `.venv` simultaneamente.

Em CI:

```bash
uv lock --check
uv sync --locked
pnpm nx affected -t lint test build
```

O comportamento de `--locked`, `--frozen` e `--no-sync` está documentado em:

- <https://docs.astral.sh/uv/concepts/projects/sync/>

### 8.5 Pacotes com build nativo

Pacotes Python que dependem de wheels nativas devem:

- usar versões travadas;
- preferir wheels oficiais;
- declarar marcadores de plataforma;
- ser testados na matriz de OS/arquitetura;
- nunca reutilizar `.venv` de outra plataforma;
- produzir wheels próprias em runners nativos quando necessário.

O cache do Nx pode armazenar:

```text
dist/python/<package>/<version>/<platform-tag>/*.whl
```

Ele não deve armazenar o ambiente instalado.

### 8.6 Requisições HTTP

Bibliotecas como `requests` devem ser dependência do pacote que efetivamente as utiliza.

Exemplo:

```bash
uv add --package automation requests
```

Não instalar dependências manualmente com `pip` dentro da `.venv`.

### 8.7 Scripts descartáveis versus automação de produção

- Experimentos pequenos podem usar metadata inline reconhecida pelo uv.
- Automação usada por CI ou release deve ser um pacote membro, testado.
- Scripts não devem depender implicitamente do diretório atual.
- Entrada, saída e side effects devem ser explícitos.

---

## 9. Node, pnpm e pacote Wasm

### 9.1 Política pnpm

Usar:

- store content-addressed padrão;
- workspace protocol;
- lockfile único;
- Corepack ou versão pinada;
- instalação congelada em CI.

Não tornar o Global Virtual Store experimental uma exigência.

### 9.2 Pacote Wasm

`packages/isekai-wasm` será o pacote técnico que contém:

- `.wasm`;
- loader;
- definições TypeScript;
- metadata de ABI/protocolo;
- glue estritamente necessário.

O cliente web deve depender de:

```json
{
  "dependencies": {
    "@grafting/isekai-wasm": "workspace:*"
  }
}
```

O package não deve conter lógica de domínio escrita novamente em TypeScript.

### 9.3 Wrapper Web

`packages/isekai-web-client` deve oferecer uma API idiomática:

- criação/encerramento do Worker;
- submissão de lote;
- Promise por job;
- cancelamento cooperativo;
- tratamento de device loss;
- decode de resultados estruturados;
- gerenciamento de transferables.

O wrapper não deve expor offsets de memória para componentes React.

---

## 10. Contratos de dados

### 10.1 Dois caminhos de dados

#### Caminho estruturado

Usar FlatBuffers para:

- Commands;
- DomainEvents;
- ReplicationDeltas;
- Snapshots;
- envelopes de transporte;
- resultados heterogêneos;
- mensagens versionáveis.

#### Caminho numérico quente

Usar arrays brutos, preferencialmente Structure of Arrays, para:

- posições;
- matrizes;
- vetores;
- custos;
- gradientes;
- candidatos;
- índices;
- grandes batches homogêneos.

Exemplo:

```text
positions_x: Float32Array
positions_y: Float32Array
positions_z: Float32Array
entity_ids:  Uint32Array
```

Não embrulhar milhões de floats em objetos FlatBuffers individuais.

### 10.2 Localização

- Contratos exclusivos de um domínio vivem no domínio.
- Envelopes globais vivem em `libs/engine/contracts`.
- Código gerado vai para diretórios fixos dos consumidores.

Exemplo:

```text
libs/domains/physics/contracts/*.fbs
packages/isekai-web-client/src/generated/
dotnet/Grafting.Isekai.Protocol/Generated/
libs/engine/domain-core/src/generated/
```

### 10.3 Geração

`flatc` deve:

- ter versão pinada;
- ser chamado por target Nx determinístico;
- produzir TS, C# e Rust;
- falhar com schema inválido;
- gerar outputs declarados;
- ser executado no bootstrap.

Código gerado:

- não é fonte de verdade;
- não precisa ser commitado por padrão;
- deve estar ignorado quando for sempre reproduzível;
- deve existir antes da checagem de tipos/IDE;
- deve ser regenerado automaticamente em build/CI.

Se um consumidor ou IDE exigir código commitado, a exceção deve ser registrada por ADR e validada com `codegen:check`.

### 10.4 Evolução

Regras mínimas:

- novos campos de table são adicionados ao final ou usam IDs explícitos;
- campos removidos são marcados deprecated, não apagados;
- defaults existentes não são alterados sem migração;
- `struct` FlatBuffers é reservado a layouts realmente estáveis;
- mensagens não confiáveis são verificadas antes do uso;
- versão do protocolo fica no envelope.

Referências:

- <https://flatbuffers.dev/>
- <https://flatbuffers.dev/evolution/>
- <https://flatbuffers.dev/languages/typescript/>
- <https://flatbuffers.dev/languages/c_sharp/>
- <https://flatbuffers.dev/languages/rust/>

---

## 11. FFI e memória

### 11.1 Regra principal

> Quem aloca controla o ciclo de vida e oferece a operação compatível de liberação.

Isso não significa que toda memória precise ser copiada. Significa que ownership não pode ser implícito.

### 11.2 O que pode atravessar a C ABI

Permitido:

- inteiros de largura fixa;
- floats de largura fixa;
- ponteiro + comprimento;
- handles opacos;
- structs `#[repr(C)]` versionadas;
- status codes;
- callbacks com contrato explícito.

Proibido:

- `Vec<T>`;
- `String`;
- `&str`;
- `Box<T>` sem API opaca;
- enum Rust sem representação fixa;
- trait object;
- panic;
- exceção C#;
- `usize`, `long` ou `bool` dependente de ABI.

### 11.3 Handles

Usar handles generacionais de 64 bits:

```text
EngineHandle
ProblemHandle
JobHandle
BufferHandle
```

Propriedades:

- `0` é inválido;
- índice e geração impedem use-after-free trivial;
- tipo lógico é validado;
- release duplicado retorna erro;
- handles não são ponteiros públicos.

### 11.4 Chamada síncrona

Para dados pequenos ou trabalho curto:

```text
host empresta pointer + length
Rust processa durante a chamada
Rust não retém o ponteiro
chamada retorna
host pode mover/liberar a memória
```

No C#, memória gerenciada deve permanecer pinned apenas durante a chamada.

### 11.5 Chamada assíncrona

Para CPU longa ou GPU:

```text
host submete batch
Rust copia para arena própria ou recebe ownership explícito
Rust retorna JobHandle
host consulta/aguarda status
Rust entrega BufferHandle
host lê dentro de um lease
host libera BufferHandle
```

Um ponteiro pinned do C# NÃO DEVE ser retido depois que a chamada `submit` retorna.

### 11.6 API conceitual

```c
EngineStatus engine_get_abi_info(EngineAbiInfo* out_info);

EngineStatus engine_create(
    const EngineCreateInfo* create_info,
    EngineHandle* out_engine
);

EngineStatus engine_submit(
    EngineHandle engine,
    const uint8_t* command_data,
    uint64_t command_length,
    JobHandle* out_job
);

EngineStatus engine_job_poll(
    JobHandle job,
    JobState* out_state
);

EngineStatus engine_job_take_result(
    JobHandle job,
    BufferHandle* out_buffer
);

EngineStatus engine_buffer_view(
    BufferHandle buffer,
    const uint8_t** out_data,
    uint64_t* out_length
);

EngineStatus engine_buffer_release(BufferHandle buffer);
EngineStatus engine_job_release(JobHandle job);
EngineStatus engine_shutdown(EngineHandle engine);
EngineStatus engine_destroy(EngineHandle engine);
```

### 11.7 Wasm

No Wasm:

- referências públicas são offsets e comprimentos;
- TypedArrays são views da memória linear;
- `memory.grow` pode invalidar views anteriores;
- views devem ser recriadas após crescimento;
- arenas devem reduzir crescimento frequente;
- o Worker deve possuir a instância Wasm.

API conceitual:

```text
reserve_input(length) -> offset
commit_input(offset, length) -> JobHandle
job_poll(job) -> state
job_result(job) -> { offset, length, BufferHandle }
buffer_release(handle)
```

### 11.8 Copy budget

| Fronteira | Meta V1 |
|---|---|
| C# → Rust síncrono | zero cópia, memória pinned durante a chamada |
| C# → Rust assíncrono | uma cópia para memória nativa |
| Rust → C# view síncrona | zero cópia dentro de lease |
| Main thread → Worker | transferência de ownership do `ArrayBuffer` quando possível |
| JS → arena Wasm | uma cópia quando dados nasceram fora do Wasm |
| view Wasm → Rust | zero cópia dentro da memória linear |
| CPU/Wasm → GPU | um upload explícito |
| GPU → CPU | um readback explícito |
| rede | cópias dependem do runtime e transporte |

Formulação correta:

> O sistema busca evitar desserialização completa e cópias redundantes, mantendo no máximo as cópias intencionais exigidas por cada domínio de memória.

---

## 12. ABI: versão e ciclo de vida

### 12.1 Eixos de versão

| Eixo | Exemplo | O que protege |
|---|---|---|
| Produto | `1.4.0` | release percebido pelo usuário |
| ABI | `2.1` | layout e funções da biblioteca nativa |
| Wire protocol | `3.0` | mensagens cliente/servidor |
| Schema revision | identificadores por contrato | evolução FlatBuffers |
| Save format | `5` | snapshots/savegames persistidos |

Não inferir compatibilidade de protocolo apenas pela versão do produto.

### 12.2 Política ABI

- `ABI_MAJOR`: quebra incompatível.
- `ABI_MINOR`: extensão append-only compatível.
- patch do produto: implementação interna sem alteração contratual.

Toda struct pública começa com:

```c
uint32_t struct_size;
```

Campos novos entram somente no final.

### 12.3 Capability negotiation

`EngineAbiInfo` deve informar:

- major;
- minor;
- tamanho;
- build ID;
- target;
- feature flags;
- backend CPU;
- backend GPU;
- suporte a async;
- versão de protocolo suportada.

O wrapper C# valida isso no startup.

### 12.4 Ciclo de vida

#### Engine

```text
Creating → Ready → ShuttingDown → Destroyed
                  ↘
                   Poisoned → Destroyed
```

#### Job

```text
Pending → Running → Completed → Released
                  ↘ Failed ───→ Released
                  ↘ Cancelled → Released
```

#### Buffer

```text
OwnedByRust → ViewLeased → OwnedByRust → Released
```

### 12.5 Panic

Cada export `extern "C"` deve proteger a fronteira.

Se uma panic recuperável ocorrer:

- converter para status;
- registrar diagnóstico interno;
- marcar engine como poisoned quando o estado não puder ser garantido;
- permitir consulta de erro e destruição;
- não continuar simulando em estado duvidoso.

`catch_unwind` não captura builds com `panic=abort`; a política de compilação deve ser deliberada.

Referência:

- <https://doc.rust-lang.org/nomicon/ffi.html>

### 12.6 Wrapper C#

O wrapper deve usar:

- `LibraryImport` quando compatível;
- `SafeHandle`;
- `Span<T>` apenas dentro de lifetime válido;
- tradução centralizada de status;
- shutdown idempotente;
- packaging por RID;
- teste de ABI antes do primeiro uso real.

---

## 13. GPU e solver único

### 13.1 Ownership

Regra fechada:

> O Rust é o único proprietário dos recursos GPU de computação matemática. Three.js e a engine C# são proprietários dos recursos de renderização.

Isso produz:

- um solver;
- um dispatcher Rust;
- uma coleção WGSL;
- dois formatos de distribuição;
- dispositivos lógicos separados quando o renderer também usa GPU.

### 13.2 O mesmo backend em Web e Desktop

`wgpu` executa:

- nativamente sobre Vulkan, Metal, D3D12 e OpenGL;
- no Wasm sobre WebGPU ou WebGL2.

Compute geral exige WebGPU; WebGL2 não deve ser tratado como fallback equivalente para compute. Quando WebGPU estiver indisponível, o backend CPU deve assumir.

Referência:

- <https://github.com/gfx-rs/wgpu>

### 13.3 Conteúdo do backend

`compute-wgpu` deve controlar:

- `Instance`;
- `Adapter`;
- `Device`;
- `Queue`;
- shader modules;
- bind groups;
- compute pipelines;
- buffers persistentes;
- staging buffers;
- ring buffers;
- submission IDs;
- readback pool;
- device loss.

### 13.4 Dados residentes

Para solver futuro:

1. modelo é carregado;
2. matrizes e vetores persistem na GPU;
3. cada iteração envia apenas parâmetros/deltas;
4. múltiplos kernels são encadeados;
5. readback ocorre somente para scalars ou solução final;
6. solução é validada na CPU.

Evitar:

```text
upload matriz → dispatch → readback matriz
```

em toda iteração.

### 13.5 Divisão solver versus kernels

Rust:

- modelagem;
- política de busca;
- controle macro das iterações;
- stopping criteria;
- gestão de memória;
- scheduling;
- validação.

WGSL:

- avaliação paralela;
- matvec;
- reduções;
- scoring;
- avaliação de restrições;
- atualização vetorial;
- operações densas ou massivamente paralelas.

`wgpu` não transforma automaticamente uma função Rust comum em compute shader. Os kernels WGSL são fonte única para GPU.

### 13.6 Jobs assíncronos

API interna conceitual:

```rust
trait ComputeBackend {
    fn capabilities(&self) -> ComputeCapabilities;
    fn upload_problem(&mut self, problem: &ProblemData) -> ProblemHandle;
    fn submit(&mut self, plan: ComputePlan) -> JobHandle;
    fn poll(&mut self, job: JobHandle) -> JobState;
    fn take_result(&mut self, job: JobHandle) -> Result<ComputeResult, ComputeError>;
    fn release_problem(&mut self, problem: ProblemHandle);
}
```

Evitar uma FFI por operação numérica. `ComputePlan` deve representar lote suficiente para amortizar dispatch.

### 13.7 Workloads adequados

Ótimos candidatos:

- milhares de avaliações independentes;
- álgebra linear;
- campos de distância;
- scoring de IA;
- relaxações;
- redução de grandes vetores;
- geração offline;
- solver com estado residente e resposta compacta.

Candidatos ruins:

- regras de negócio;
- fluxos altamente ramificados e pequenos;
- tarefas menores que o custo de upload;
- lógica que exige determinismo bit-a-bit;
- output gigante consumido pelo renderer em todo frame.

### 13.8 Limite da separação de dispositivos

Se o Rust calcular milhões de posições que Three.js precisa renderizar todo frame:

```text
GPU Rust → CPU → GPU renderer
```

o readback/upload pode dominar.

Nesse caso, uma futura ADR escolherá entre:

1. executar o compute visual no renderer;
2. mover renderização para Rust;
3. implementar external-memory interop por backend.

Não generalizar essa exceção para pathfinding, IA ou solver com output compacto.

---

## 14. Threads e assincronia

### 14.1 Web

Main thread:

- React/UI;
- Three.js;
- input;
- apresentação;
- frame loop.

Worker:

- instância Wasm;
- estado da simulação;
- `wgpu` compute;
- jobs;
- decode/encode de protocolo;
- opcionalmente WebSocket em fase futura.

Regras:

- não bloquear main thread;
- não usar polling ocupado;
- comunicar por mensagens;
- transferir `ArrayBuffer` quando ownership puder mudar;
- não introduzir `SharedArrayBuffer` na V1;
- tratar encerramento e crash do Worker.

### 14.2 Desktop

O host C# não deve executar job pesado na thread de UI/render.

Modelo:

- C# submete;
- Rust agenda;
- GPU/worker executa;
- C# recebe completion;
- resultado é consumido no ponto seguro do frame.

Não chamar `device.poll(Wait)` na thread principal.

### 14.3 Readback

Readback GPU deve usar:

- buffer staging;
- submissão;
- callback/future;
- pool de buffers;
- sinalização curta;
- consumo posterior.

Enquanto um buffer estiver mapeado pela CPU, ele não deve ser usado simultaneamente pela GPU.

Referência:

- <https://docs.rs/wgpu/latest/wgpu/struct.CommandBuffer.html>

---

## 15. Multiplayer

### 15.1 Nome correto da arquitetura

V1:

> Replicação autoritativa com journal de comandos aceitos e snapshots periódicos.

Não chamar de Event Sourcing.

### 15.2 Tipos distintos

| Tipo | Significado |
|---|---|
| `ClientCommand` | intenção enviada pelo cliente |
| `AcceptedCommand` | comando autenticado, ordenado e aceito |
| `DomainEvent` | fato semântico produzido pelo domínio |
| `ReplicationDelta` | projeção transmissível para um cliente específico |
| `Snapshot` | estado autoritativo persistível |

`DomainEvent` não é `ReplicationDelta`.

### 15.3 Fluxo

```text
ClientCommand
  → autenticação/autorização no host
  → ordenação e deduplicação
  → batch para Rust
  → DomainEvents + state hash
  → journal
  → projeção por cliente
  → ReplicationDelta
  → transporte
```

### 15.4 Core agnóstico

O core não conhece:

- socket;
- IP;
- reconexão;
- TLS;
- banco;
- filas;
- autenticação concreta.

O host injeta comandos e coleta resultados.

### 15.5 Journal

Registro mínimo:

- tick;
- sequence;
- command ID;
- client ID lógico;
- AcceptedCommand;
- DomainEvents;
- state hash;
- core version;
- protocol version.

### 15.6 Snapshot

Conteúdo mínimo:

- estado autoritativo;
- RNG state;
- last sequence;
- state hash;
- core version;
- protocol/save version.

### 15.7 Recuperação

```text
carregar snapshot mais recente
→ aplicar AcceptedCommands posteriores
→ recomputar state hash
→ comparar
→ liberar sessão
```

Event Sourcing completo somente será adotado se eventos se tornarem a fonte primária e houver política formal de upcasting/migração.

---

## 16. Knowledge, documentação e contexto para IA

### 16.1 Fontes de verdade

A autoridade é dividida sem geração circular:

- este documento: arquitetura global;
- ADRs: alterações específicas;
- `AGENTS.md`: contrato operacional por escopo;
- `.ai/`: AI Control Plane;
- código/manifests/schemas: fatos implementados;
- Graph IR e docs geradas: projeções com evidência.

```text
docs/
├── architecture/
│   ├── overview.md
│   ├── boundaries.md
│   ├── memory-model.md
│   ├── gpu-model.md
│   ├── abi.md
│   └── multiplayer.md
├── adr/
│   ├── 0001-*.md
│   └── ...
├── runbooks/
├── benchmarks/
└── generated/
    ├── project-graph.json
    ├── project-graph.html
    ├── artifact-manifest.json
    └── repo-map.md
```

### 16.2 `AGENTS.md`

`AGENTS.md` é o contrato operacional agnóstico e canônico por escopo:

- propósito e superfície pública;
- comandos oficiais;
- invariantes e ownership;
- dependências permitidas e proibidas;
- critérios de aceite;
- limites;
- arquivos gerados;
- testes obrigatórios;
- ADRs;
- checklist de mudança;
- mapa da documentação.

Arquivos `AGENTS.md` locais restringem o subtree. `.ai/` pode indexá-los e validar consistência, mas não os sobrescreve silenciosamente.

### 16.3 `CLAUDE.md` e adapters

`CLAUDE.md` deve ser curto:

- mandar ler `AGENTS.md`;
- mandar ler este documento;
- apontar para context packs e skills aplicáveis;
- listar comandos de validação;
- explicar como reportar decisões abertas;
- conter apenas comportamento específico do Claude.

`.claude/`, `.codex/` e `.agents/` adaptam a mesma fonte canônica. Não duplicar todo o blueprint nesses arquivos, pois isso cria deriva e aumenta contexto.

### 16.4 Cursor e outros fornecedores

Regras específicas podem existir em:

- `.cursor/rules/*.mdc`;
- arquivos equivalentes de outras ferramentas.

Elas devem adaptar, não contradizer, `AGENTS.md`.

### 16.5 Grafo Nx

O grafo será gerado sob demanda ou em CI:

```bash
pnpm nx graph --file=docs/generated/project-graph.json
```

Esse arquivo é:

- contexto estrutural;
- input para ferramentas;
- snapshot derivado.

Não é RAG sozinho.

RAG só existe quando houver:

- corpus;
- chunking;
- embeddings ou índice;
- mecanismo de retrieval;
- política de atualização;
- avaliação de relevância.

### 16.6 Documentação automatizada

Automação deve gerar:

- grafo de projetos;
- matriz de artefatos;
- inventário de contratos;
- lista de exports ABI;
- versões de toolchains;
- benchmark summary;
- compatibilidade de targets.

Automação não deve gerar silenciosamente:

- decisões arquiteturais;
- justificativas de ADR;
- promessas de suporte;
- requisitos de produto.

---

### 16.7 Grafting Graph IR

O Graph IR representa projetos, targets, módulos, símbolos, contratos, ABI, artefatos, runtimes, threads, documentos, ADRs, workflows, skills, agentes, prompts, ferramentas, MCPs, policies, evals, tarefas, runs e handoffs.

Relações derivadas registram extractor, versão, arquivo, símbolo, hash, confiança e evidência. O Graph IR é o modelo canônico de intercâmbio e consulta; a autoridade do fato continua no código, manifest, schema, contrato ou ADR de origem.

Níveis:

| Nível | Conteúdo |
|---|---|
| L0 | apps, packages, crates e projetos |
| L1 | módulos e imports |
| L2 | classes, traits, interfaces e APIs públicas |
| L3 | call graph, dataflow e runtime tracing |

Call graphs aproximados não são verdade normativa.

### 16.8 AntV X6 e Architecture Studio

X6 é visualizador/editor controlado. Informação normativa, derivada, authored e visual permanece separada. Grafos derivados são somente leitura. Workflows authored passam por schema, policy, plan/diff e executor Nx/CI.

Views V1:

1. Project Map;
2. Task Pipeline;
3. Interop/Isekai;
4. Contract Map;
5. Documentation Map;
6. AI Capability Map.

### 16.9 Context packs

Cada tarefa recebe um context pack pequeno, reproduzível, versionado e validado contendo task, critérios, capabilities, policies, contexto, ferramentas permitidas/proibidas, schema de saída, artefatos, handoffs, graph scope e token budget. O context pack é índice, não substituto para leitura do código.

## 17. Generators e scaffolding

### 17.1 Plugin local

Um plugin Nx local será criado depois que o scaffold inicial estabilizar.

Generators previstos:

- `domain`;
- `rust-crate`;
- `flatbuffer-contract`;
- `python-package`;
- `web-package`;
- `dotnet-wrapper`;
- `adr`;
- `benchmark`.

### 17.2 Generator de domínio

Input:

- nome;
- tags;
- precisa de contrato?;
- precisa de compute?;
- precisa de binding público?;

Output mínimo:

- diretório;
- manifest de membro;
- `project.json`;
- testes;
- documentação local;
- atualização de workspace;
- dependências no grafo.

Não criar bindings para todo domínio automaticamente. Preferir uma API agregada do engine.

### 17.3 Regra de adoção

Durante a fase bootstrap, a primeira estrutura pode ser criada manualmente pelo agente.

Após o generator passar nos testes:

- novos projetos padronizados devem usar generator;
- alterações manuais na topologia devem ser justificadas;
- generator deve ser atualizado quando a convenção mudar.

---

## 18. CI/CD

### 18.1 Princípios

- instalação ocorre antes do Nx;
- tarefas cacheáveis não fazem instalação;
- runners usam lockfiles;
- cache é particionado por OS, arquitetura, perfil e toolchain;
- GPU real é testada separadamente de CPU CI;
- publish/sign/deploy nunca são restaurados de cache.

### 18.2 Pipeline de Pull Request

Etapas:

1. checkout;
2. validar versões das toolchains;
3. `pnpm install --frozen-lockfile`;
4. `uv lock --check`;
5. `uv sync --locked`;
6. `cargo metadata` e lock check;
7. `dotnet restore --locked-mode`, quando aplicável;
8. codegen;
9. `nx affected` para format/lint/typecheck/test/build;
10. validar ABI e protocolo;
11. extrair e validar Graph IR;
12. bloquear relações arquiteturais proibidas;
13. gerar context packs e documentação;
14. validar `.ai/`, registries, skills e referências;
15. compilar prompts e gerar adapters;
16. detectar drift;
17. executar evals rápidas;
18. revisar expansão de permissões e MCPs;
19. verificar artefatos inesperados.

### 18.3 Matriz nativa

| Runner | Artefatos |
|---|---|
| Linux x64 | Wasm, `.so`, testes Rust/Python/TS |
| Windows x64 | `.dll`, wrapper C#, desktop V1 |
| macOS arm64 | `.dylib`, validação Metal/wgpu futura |

Não assumir que um build Linux equivale a validar DirectX ou Metal.

### 18.4 Testes GPU

Pipeline normal:

- valida WGSL;
- compila backend;
- testa CPU fallback;
- executa testes sem exigir GPU dedicada.

Pipeline GPU, nightly/manual:

- roda em hardware conhecido;
- coleta adapter/features/limits;
- executa benchmarks;
- testa device loss quando possível;
- compara resultado contra CPU dentro de tolerância;
- publica relatório, não cacheia como verdade eterna.

### 18.5 Release

Enquanto tudo for interno:

- uma versão do produto;
- manifest de artefatos;
- versões separadas de ABI/protocolo;
- build ID e git SHA;
- checksums.

Manifest:

```json
{
  "productVersion": "0.1.0",
  "coreVersion": "0.1.0",
  "abi": { "major": 1, "minor": 0 },
  "protocol": { "major": 1, "minor": 0 },
  "gitSha": "<sha>",
  "target": "x86_64-pc-windows-msvc",
  "profile": "release",
  "features": ["cpu", "wgpu"]
}
```

Nx Release poderá coordenar versões e changelogs, mas publicação Cargo/NuGet/Python exigirá adaptadores explícitos. Não presumir publicação políglota automática.

---

## 19. Testes

### 19.1 Pirâmide

1. testes puros do domínio;
2. property-based tests;
3. testes diferenciais CPU versus GPU;
4. testes de contrato;
5. testes ABI;
6. testes de integração dos bindings;
7. testes dos hosts;
8. e2e;
9. benchmarks.

### 19.2 Domínio

Testar:

- invariantes;
- comandos inválidos;
- transições;
- RNG controlado;
- replay;
- state hash;
- snapshots.

### 19.3 CPU versus GPU

Para cada kernel:

- gerar casos pequenos;
- executar CPU;
- executar GPU;
- comparar com tolerância;
- incluir NaN, infinidade, vazio, limites;
- testar devices com features mínimas.

Não exigir igualdade bit-a-bit de floating point sem justificativa matemática.

### 19.4 ABI

Testar:

- versão compatível;
- major incompatível;
- `struct_size` menor/maior;
- handle inválido;
- double release;
- use-after-release;
- null pointer;
- buffer vazio;
- panic interna;
- shutdown com jobs pendentes;
- biblioteca ausente;
- arquitetura errada.

### 19.5 Memória

Testar:

- leak;
- crescimento de arena;
- leases;
- pinning curto;
- Worker termination;
- `memory.grow`;
- device loss;
- liberação após cancelamento.

---

## 20. Observabilidade

O core deve produzir eventos diagnósticos estruturados, não escrever diretamente em UI.

Campos:

- severity;
- subsystem;
- code;
- message ID;
- job ID;
- tick;
- duration;
- bytes uploaded;
- bytes read back;
- backend;
- adapter;
- build ID.

Hosts decidem:

- console;
- arquivo;
- telemetria;
- overlay;
- tracing distribuído.

Dados sensíveis ou secretos não devem aparecer em logs.

---

## 21. Segurança e robustez

### 21.1 Dados não confiáveis

Todo payload de rede deve:

- ter limite de tamanho;
- ser verificado;
- validar versão;
- validar command type;
- validar autorização no host;
- validar semântica no core;
- recusar offsets inválidos.

### 21.2 FFI

Cada export deve:

- validar null;
- validar comprimento;
- validar overflow;
- validar alinhamento quando necessário;
- retornar status;
- nunca fazer unwind pela fronteira.

### 21.3 GPU

Limitar:

- tamanho de buffers;
- número de jobs;
- workgroups;
- memória residente;
- tempo máximo cooperativo;
- fila por origem;
- retries de device loss.

### 21.4 Supply chain

- lockfiles commitados;
- toolchains pinadas;
- checksums para binários baixados;
- dependências novas revisadas;
- plugins Nx tratados como código executável;
- cache remoto somente em domínio confiável.

---

## 22. Fases de implementação

A ordem mandatória unificada é:

```text
decisões
→ Knowledge Plane + Graph IR mínimo
→ AI Control Plane mínimo
→ spikes
→ workspace orientado a contexto
→ core CPU
→ bindings Isekai
→ compute GPU
→ hosts
→ multiplayer
→ solver proprietário
→ AI Control Plane avançado
```

### Fase 0 — Fechamento arquitetural e fundação de conhecimento

Objetivo:

- resolver gates;
- provar riscos P0;
- criar contratos para humanos e agentes;
- não construir produto ainda.

Entregáveis:

- ADR do Knowledge & Automation Plane;
- Grafting Graph IR v1 mínimo;
- `GRAFTING_MASTER_SOURCE.md`;
- `AGENTS.md` raiz;
- template `README.md` + `AGENTS.md` + metadata por projeto;
- `.ai/` mínimo;
- AI System Maintainer;
- hooks via `uv`;
- primeiro context pack;
- `ai:validate` e drift check;
- ADRs iniciais;
- spike Rust → Wasm;
- spike Rust DLL → C#;
- spike `wgpu` nativo e Web;
- benchmark de fronteira;
- decisão de engine e host Web.

### Fase 1 — Workspace mínimo orientado a contexto

Objetivo:

- criar toolchains;
- criar Nx;
- criar projeto Rust puro;
- validar cache;
- validar o grafo e contratos operacionais.

Entregáveis:

- manifests raiz;
- versões pinadas;
- bootstrap;
- `nx graph`;
- extrator Nx → Graph IR;
- Studio read-only mínimo;
- registry inicial de capabilities e agents;
- projeto `domain-core`;
- CI Linux básica.

### Fase 2 — Contratos, core CPU, Prompt IR e evals mínimas

Objetivo:

- implementar um vertical slice sem GPU;
- provar o fluxo básico do AI Control Plane.

Entregáveis:

- Command;
- DomainEvent;
- Snapshot;
- codegen;
- state hash;
- testes puros;
- backend CPU;
- Prompt IR mínimo;
- compilador/snapshot inicial;
- Promptfoo;
- cache de compilação.

### Fase 3 — Isekai: bindings entre mundos

Objetivo:

- consumir o mesmo vertical slice em Web e C#.

Entregáveis:

- C ABI v1;
- wrapper C#;
- Wasm Worker;
- API de jobs;
- testes de ciclo de vida.

### Fase 4 — Compute GPU

Objetivo:

- acelerar um workload comprovadamente apropriado.

Entregáveis:

- `compute-api`;
- `compute-wgpu`;
- kernel WGSL;
- buffers residentes;
- readback async;
- comparação CPU/GPU;
- fallback.

### Fase 5 — Hosts mínimos

Objetivo:

- UI/render mínimos consumindo o core.

Entregáveis:

- VTT mostra estado do core;
- Desktop mostra o mesmo estado;
- nenhum domínio duplicado.

### Fase 6 — Multiplayer

Objetivo:

- host autoritativo mínimo.

Entregáveis:

- AcceptedCommand;
- journal;
- snapshot/recovery;
- projection;
- delta por cliente;
- reconexão.

### Fase 7 — Solver proprietário

Objetivo:

- framework de otimização reutilizável.

Entregáveis:

- modelo de problema;
- backend CPU;
- kernels GPU;
- stopping criteria;
- benchmark;
- validação;
- persistência de problemas residentes.

### Fase 8 — AI Control Plane avançado

Objetivo:

- adicionar gateway, observabilidade, aprendizado e comunicação direta somente após a fundação estar medida.

Entregáveis sujeitos a spike:

- Bifrost;
- Langfuse;
- LangMem;
- GEPA/DSPy;
- LLMLingua seletivo;
- Context Broker MCP;
- provider routing;
- Graph IR avançado;
- views de IA no Architecture Studio.

## 23. Backlog inicial

### Epic A — Decisões e provas de conceito

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| A-001 | ADR do host Web | — | GATE-001 fechado com justificativa |
| A-002 | ADR da engine C# | — | GATE-002 fechado e risco de P/Invoke avaliado |
| A-003 | ADR de plataformas V1 | — | matriz explícita de OS/arch |
| A-004 | ADR de determinismo | — | níveis exigidos definidos |
| A-005 | Spike C ABI Rust/C# | A-002 | create/execute/destroy e erro funcionam |
| A-006 | Spike Wasm/Worker | A-001 | batch processado fora da main thread |
| A-007 | Spike `wgpu` nativo | — | compute + readback assíncrono |
| A-008 | Spike `wgpu` Web | A-006 | mesmo WGSL executa em WebGPU |
| A-009 | Benchmark de cópias | A-005,A-006 | copy budget medido |
| A-010 | Avaliar `@nx/dotnet` | A-002 | adotar ou registrar fallback |

### Epic B — Fundação do workspace

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| B-001 | Criar workspace pnpm/Nx | A-001 | grafo executável |
| B-002 | Criar workspace Cargo | — | `cargo check --workspace` |
| B-003 | Criar workspace uv | — | `uv lock --check` e pacote exemplo |
| B-004 | Criar solução .NET | A-002 | restore/build mínimo |
| B-005 | Pinar toolchains | B-001..B-004 | versões reproduzíveis |
| B-006 | Criar bootstrap | B-005 | instala/sincroniza uma vez |
| B-007 | Configurar cache Nx | B-001 | segundo build restaura output |
| B-008 | Configurar affected | B-007 | mudança local executa apenas dependentes |
| B-009 | CI Linux inicial | B-006 | PR verde em clean checkout |
| B-010 | CI Windows inicial | B-004,B-006 | DLL e testes C# verdes |

### Epic C — Core e contratos

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| C-001 | Criar `domain-core` | B-002 | crate puro sem host/network/GPU |
| C-002 | Definir Command mínimo | C-001 | validação e teste |
| C-003 | Definir DomainEvent mínimo | C-002 | evento semântico testado |
| C-004 | Definir Snapshot mínimo | C-001 | round trip e hash |
| C-005 | Configurar `flatc` | B-001,B-002,B-004 | TS/C#/Rust gerados |
| C-006 | Definir evolução de schema | C-005 | teste de compatibilidade |
| C-007 | Implementar state hash | C-001 | replay reproduz hash |
| C-008 | Criar property tests | C-002..C-004 | invariantes cobertos |

### Epic D — Isekai, ABI e bindings

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| D-001 | Definir `EngineAbiInfo` | A-005 | compatibilidade testada |
| D-002 | Implementar handles | C-001 | geração e double-release testados |
| D-003 | Implementar engine lifecycle | D-002 | estados e poison testados |
| D-004 | Implementar buffer lease | D-002 | view/release sem leak |
| D-005 | Exportar `isekai-capi` v1 | D-001..D-004 | header e DLL |
| D-006 | Criar `Grafting.Isekai.Interop` | D-005 | `SafeHandle` e smoke test |
| D-007 | Criar `isekai-wasm` | C-001,D-002 | offsets/handles testados |
| D-008 | Criar `isekai-web-client` | D-007 | Promise/job/cancel/shutdown |
| D-009 | Teste de memória | D-006,D-008 | sem leak no cenário alvo |

### Epic E — Compute

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| E-001 | Criar `compute-api` | C-001 | domínio não depende de `wgpu` |
| E-002 | Criar `compute-cpu` | E-001 | baseline correto |
| E-003 | Escolher workload piloto | A-007,A-008 | dataset e métrica definidos |
| E-004 | Criar WGSL único | E-003 | valida nativo e Web |
| E-005 | Criar `compute-wgpu` | E-001,E-004 | device/pipeline/job |
| E-006 | Buffers persistentes | E-005 | upload amortizado |
| E-007 | Readback assíncrono | E-005 | nenhuma espera na UI |
| E-008 | Fallback CPU | E-002,E-005 | capability switch testado |
| E-009 | Teste diferencial | E-002,E-005 | tolerância aprovada |
| E-010 | Benchmark decisório | E-006,E-007 | faixa em que GPU vence |

### Epic F — Hosts

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| F-001 | Scaffold Web | A-001,B-001 | app inicia |
| F-002 | Integrar Worker/Wasm | D-008,F-001 | estado vem do Rust |
| F-003 | Integrar Three.js | F-001 | renderer separado do compute |
| F-004 | Scaffold Desktop | A-002,B-004 | app inicia |
| F-005 | Integrar DLL | D-006,F-004 | estado vem do Rust |
| F-006 | Packaging nativo | F-005 | DLL correta por RID |
| F-007 | Vertical slice compartilhado | F-002,F-005 | comportamento equivalente |

### Epic G — Automação e documentação

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| G-001 | Criar `AGENTS.md` | B-001 | regras e comandos corretos |
| G-002 | Criar `CLAUDE.md` | G-001 | adaptador curto, sem duplicação |
| G-003 | Gerar repo map | B-001 | arquivo derivado reproduzível |
| G-004 | Gerar artifact manifest | D-001 | versões e target corretos |
| G-005 | Template de ADR | — | novo ADR padronizado |
| G-006 | Generator de crate | B-001,B-002 | crate e grafo válidos |
| G-007 | Generator de domínio | G-006,C-005 | slice completo |
| G-008 | `docs:check` | G-003,G-004 | CI detecta deriva |

### Epic H — Multiplayer futuro

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| H-001 | ADR do host autoritativo | GATE-004 | GATE-004 fechado |
| H-002 | AcceptedCommand | C-002 | ordem/dedup testados |
| H-003 | Journal | H-002 | append/recovery |
| H-004 | Snapshot recovery | C-004,H-003 | hash validado |
| H-005 | Projection core | C-003 | informação privada isolada |
| H-006 | ReplicationDelta | H-005 | delta específico por cliente |
| H-007 | Transport adapter | H-001,H-006 | core continua agnóstico |

---

### Epic I — Knowledge Plane e Graph IR

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| I-001 | ADR do Knowledge & Automation Plane | — | autoridade e lifecycle documental definidos |
| I-002 | Graph IR v1 | I-001 | schemas, IDs e evidência validados |
| I-003 | Template operacional por projeto | I-001 | README, AGENTS e metadata gerados |
| I-004 | Extrator Nx → Graph IR | I-002,B-001 | projetos/targets/edges reproduzíveis |
| I-005 | Context pack v1 | I-002,G-001 | task gera pacote pequeno e rastreável |
| I-006 | Architecture Studio read-only | I-002,I-004 | subgrafo navegável sem editar fatos derivados |
| I-007 | Drift check | I-003,I-004 | CI detecta documentação/grafo desatualizado |

### Epic J — AI Control Plane

| ID | Trabalho | Depende de | Critério de aceite |
|---|---|---|---|
| J-001 | Criar estrutura `.ai/` | I-001 | registry, policies, contracts e state válidos |
| J-002 | Instalar AI System Maintainer | J-001,B-003 | observe/audit testados via uv |
| J-003 | Registry de capabilities e agents | J-001 | IDs únicos e schemas válidos |
| J-004 | Skill lifecycle e adapters | J-003,G-001,G-002 | mesma skill localizável por Claude e Codex |
| J-005 | Prompt IR v1 | J-001 | prompt compilado e hash reproduzível |
| J-006 | Promptfoo | J-005 | regressões e triggers avaliados |
| J-007 | Gateway Bifrost spike | J-005,J-006 | roteamento/custo/cache exato medidos |
| J-008 | Langfuse spike | J-005,J-006 | tracing com política de dados validada |
| J-009 | Learning candidates | J-002,J-006 | evidência vira proposta, não mudança automática |
| J-010 | LangMem/GEPA/DSPy spikes | J-009 | variante avaliada em branch com rollback |
| J-011 | Context Broker MCP | I-005,J-003 | tools mínimas testadas no MCP Inspector |
| J-012 | AI Graph IR extension | I-002,J-003,J-005 | skills/prompts/runs aparecem com evidência |

## 24. Definition of Done

Uma tarefa só está concluída quando:

- escopo solicitado foi implementado;
- testes relevantes passam;
- lint/format/typecheck passam;
- inputs e outputs Nx estão corretos;
- nenhuma tarefa cacheável ganhou side effect;
- documentação afetada foi atualizada;
- ADR foi criado quando houve decisão;
- contrato/ABI foi versionado quando necessário;
- código gerado é reproduzível;
- não há lógica duplicada nos hosts;
- erro e cleanup foram considerados;
- o agente reportou arquivos e comandos executados;
- mudança ficou pequena o suficiente para revisão;
- `AGENTS.md`, `.ai/`, adapters e Graph IR não ficaram em drift;
- mudanças de skill, prompt ou agente possuem eval aplicável;
- tokens, cache e custo foram registrados quando houve chamada de modelo;
- nenhuma permissão ou ferramenta foi expandida silenciosamente.

Para performance:

- benchmark anexado;
- baseline comparável;
- hardware e versões registrados;
- resultado não é baseado em microbenchmark irrelevante.

---

## 25. Protocolo de trabalho para agentes Claude e GPT/Codex

### 25.1 Antes de escrever

Todo agente deve:

1. ler `AGENTS.md`;
2. ler este documento;
3. ler ADRs relacionados;
4. inspecionar a árvore real;
5. consultar o grafo Nx;
6. identificar o ID exato da tarefa;
7. listar decisões `OPEN` que bloqueiam;
8. propor plano pequeno;
9. aguardar decisão apenas quando realmente bloqueante.

### 25.2 Durante a implementação

Todo agente deve:

- trabalhar em um ID de backlog por vez, salvo autorização;
- usar toolchains nativas;
- preservar alterações existentes;
- não refatorar áreas não relacionadas;
- adicionar teste junto da implementação;
- registrar premissas;
- fazer checkpoints em commits pequenos quando autorizado;
- atualizar o plano se descobrir um risco.

### 25.3 Formato de conclusão

Ao concluir uma tarefa, responder:

```text
Tarefa:
Resultado:
Arquivos alterados:
Validações executadas:
Decisões tomadas:
Riscos ou pendências:
Próxima tarefa desbloqueada:
```

### 25.4 Stop conditions

O agente deve parar e pedir decisão quando:

- engine/framework não escolhido altera a estrutura;
- a ação mudaria ABI major;
- a ação quebraria protocolo persistido;
- seria necessário compartilhar recursos GPU entre runtimes;
- seria necessário um segundo lockfile/workspace;
- credenciais ou publicação externa forem necessárias;
- um teste demonstra que a arquitetura `LOCKED` é inviável;
- escopo crescer materialmente além do ID selecionado.

### 25.5 Prompt de bootstrap recomendado

```text
Leia integralmente GRAFTING_MASTER_SOURCE.md.

Sua missão atual é trabalhar somente na Fase 0. Não crie ainda a árvore
definitiva das aplicações e não converta decisões OPEN em escolhas silenciosas.

1. Extraia a tabela de decisões LOCKED, PROVISIONAL e OPEN.
2. Faça uma análise adversarial das decisões P0:
   - ownership da GPU;
   - copy budget;
   - ABI/lifecycle;
   - multiplayer.
3. Proponha os ADRs necessários para fechar GATE-001 a GATE-005.
4. Proponha quatro spikes mínimos:
   - Rust → Wasm em Worker;
   - Rust DLL → C#;
   - mesmo WGSL em wgpu nativo e Web;
   - benchmark de batching/cópias.
5. Para cada spike, defina árvore mínima, comandos, teste e critério objetivo
   de sucesso.
6. Não implemente nada até apresentar o plano e os pontos que exigem decisão.

Ao encontrar conflito, cite a seção e apresente a menor alteração possível.
```

### 25.6 Prompt após fechamento dos gates

```text
Leia GRAFTING_MASTER_SOURCE.md, AGENTS.md raiz e local, o context pack e todos os ADRs aceitos.

Execute somente a tarefa <ID>.

Antes de editar:
- confirme dependências;
- mostre os arquivos que serão criados/alterados;
- declare inputs e outputs Nx;
- liste validações.

Durante a implementação:
- mantenha toolchains nativas como fonte de verdade;
- não replique lógica Rust;
- não faça alterações arquiteturais silenciosas;
- preserve alterações alheias.

Ao final, use o formato de conclusão definido na Seção 25.3.
```

---

### 25.7 Provedores, agentes e revisão

Claude e Codex compartilham skills, contracts, context packs e tarefas. Definições específicas de fornecedor permanecem adapters. Não fixar permanentemente que um provedor sempre planeja ou implementa. Usar `primary_agent`, `review_agent`, `verification_agent` e `synthesis_agent` conforme evals locais.

O agente que implementou não pode ser o único revisor. Para trabalho paralelo, usar uma worktree por executor e um único proprietário por tarefa.

### 25.8 Formato estruturado de handoff

Todo handoff deve registrar task ID, remetente, destinatário, objetivo, contexto, critérios, restrições, incertezas, artefatos, proprietário atual, schema de retorno e próximo responsável.

## 26. Estratégia para aproveitar o crédito de agente

O crédito deve ser gasto em redução de incerteza e trabalho verificável, nesta ordem:

### Passo 1 — Revisão adversarial

Pedir ao Claude para tentar quebrar este blueprint:

- contradições;
- incompatibilidades de toolchain;
- custos ocultos;
- riscos de threading;
- risco de ABI;
- risco de device loss;
- tarefas faltantes.

Não permitir edição nessa passada.

### Passo 2 — ADRs

Uma sessão por decisão grande:

- Web;
- engine C#;
- plataformas;
- determinismo;
- servidor.

Cada sessão deve terminar em ADR, não em código.

### Passo 3 — Spikes descartáveis

Spikes devem ser pequenos e mensuráveis. Eles não viram fundação automaticamente.

Depois do resultado:

- aceitar;
- rejeitar;
- reescrever como código de produção.

### Passo 4 — Scaffold

Somente depois:

- manifests;
- workspace;
- Nx;
- core mínimo;
- CI.

### Passo 5 — Vertical slice

Entregar uma ação completa:

```text
input Web/C#
→ binding
→ Rust
→ evento/resultado
→ host
```

Antes de criar dezenas de pacotes.

### Passo 6 — Automação

Automatizar somente convenções já comprovadas:

- generators;
- docs;
- manifests;
- release.

### Práticas para reduzir desperdício

- fornecer ID de tarefa em todo prompt;
- não pedir “construa todo o monorepo”;
- pedir plano e diff esperado;
- manter `repo-map.md` atualizado;
- separar revisão de implementação;
- exigir critérios de aceite;
- criar checkpoints;
- não repetir o blueprint inteiro em arquivos de agente.

---

## 27. Checklist de criação

### Antes do scaffold

- [ ] GATE-001 fechado.
- [ ] GATE-002 fechado.
- [ ] GATE-003 fechado.
- [ ] GATE-004 pelo menos adiado formalmente.
- [ ] GATE-005 fechado.
- [ ] Spike Wasm aprovado.
- [ ] Spike C ABI aprovado.
- [ ] Spike wgpu Web/nativo aprovado.
- [ ] Copy budget medido.

### Workspace

- [ ] pnpm e Nx pinados.
- [ ] Cargo workspace válido.
- [ ] uv workspace e lock válidos.
- [ ] solução .NET válida.
- [ ] `flatc` pinado.
- [ ] bootstrap idempotente.
- [ ] `.venv` fora do cache.
- [ ] outputs determinísticos.

### Core

- [ ] domínio puro.
- [ ] backend CPU.
- [ ] command/event/snapshot.
- [ ] state hash.
- [ ] testes de invariantes.
- [ ] nenhum host importado.

### FFI

- [ ] ABI major/minor.
- [ ] `struct_size`.
- [ ] handles generacionais.
- [ ] status codes.
- [ ] panic protegida.
- [ ] shutdown.
- [ ] leases.
- [ ] Worker.
- [ ] wrapper C#.

### GPU

- [ ] ownership privado.
- [ ] capability negotiation.
- [ ] fallback CPU.
- [ ] buffers persistentes.
- [ ] readback assíncrono.
- [ ] benchmark.
- [ ] teste diferencial.

### CI e documentação

- [ ] affected.
- [ ] cache por plataforma.
- [ ] runners nativos.
- [ ] docs geradas.
- [ ] ADRs.
- [ ] artifact manifest.
- [ ] `AGENTS.md`.
- [ ] `CLAUDE.md`.

---

### Knowledge & AI Control Plane

- [ ] documento mestre adotado;
- [ ] documentos substituídos arquivados;
- [ ] Graph IR v1;
- [ ] `grafting.graph.json`;
- [ ] template README/AGENTS/metadata;
- [ ] `.ai/` mínimo;
- [ ] AI System Maintainer testado via uv;
- [ ] hooks sem chamada de modelo;
- [ ] registry e schemas válidos;
- [ ] primeiro context pack;
- [ ] adapters Claude/Codex sem drift;
- [ ] Prompt IR e snapshot reproduzível;
- [ ] Promptfoo;
- [ ] cache semântico desabilitado;
- [ ] uma única fonte durável de tarefas;
- [ ] aprovação para mudanças de controle;
- [ ] rollback testado.

## 28. Questões futuras deliberadamente fora da V1

Não implementar sem demanda e ADR:

- compartilhamento de textura/buffer entre `wgpu` e renderer;
- SharedArrayBuffer;
- Event Sourcing completo;
- microservices por domínio;
- Bazel hermético;
- Kubernetes;
- publicação independente de todo crate/pacote;
- plugin Nx universal para todas as linguagens;
- transpilar Rust comum diretamente para WGSL;
- renderer único em Rust;
- execução distribuída do solver;
- hot reload da biblioteca nativa;
- migração automática de savegames arbitrariamente antigos.

---

## 29. AI Control Plane detalhado

### 29.1 Estrutura

```text
.ai/
├── README.md
├── registry/
│   ├── capabilities.yaml
│   ├── agents.yaml
│   ├── tools.yaml
│   ├── models.yaml
│   ├── prompts.yaml
│   ├── policies.yaml
│   └── workflows.yaml
├── policies/
├── skills/
├── agents/
├── prompts/
├── workflows/
├── context/
├── contracts/
├── adapters/
├── evals/
├── catalog/
├── state/
├── reports/
└── scripts/
```

`.ai/` é a fonte canônica do control plane, mas não substitui `AGENTS.md` como contrato operacional do projeto.

### 29.2 Progressive disclosure

Inicialmente carregar apenas ID, nome, resumo, gatilhos, risco, custo e dependências. Corpo de skill, referências, scripts, schemas e tools entram somente após seleção.

### 29.3 Agent Skills

Formato canônico:

```text
skill-name/
├── SKILL.md
├── manifest.yaml
├── references/
├── scripts/
├── templates/
├── examples/
├── evals/
├── tests/
└── assets/
```

Lifecycle:

```text
discovered
→ quarantined
→ inspected
→ adapted
→ evaluated
→ approved
→ active
→ monitored
→ deprecated
→ archived
```

Skills externas nunca entram diretamente como ativas.

### 29.4 Agentes iniciais do control plane

- capability-curator;
- skill-engineer;
- context-engineer;
- agent-evaluator;
- repository-intelligence-agent;
- graph-ir-architect.

Cada agente define responsabilidades, permissões, limites, tools, contexto, schema de saída e evals.

### 29.5 AI System Maintainer

Modos:

- `observe`: após tools, sem modelo e sem alteração canônica;
- `audit`: fim do turno, validação e relatório;
- `evolve`: evidence-driven, com eval, revisão, aprovação e rollback.

Hooks:

```text
PostToolUse → observe
Stop        → audit
SessionEnd  → finalize
```

Execução Python:

```bash
uv run --locked --no-sync python <script>
```

A própria skill, hooks, permissions, sandbox e MCPs só mudam em tarefa separada com aprovação humana.

### 29.6 Prompt IR

Prompts canônicos vivem em `.ai/prompts/`. O compilador valida schema, resolve fragments, deduplica, preserva prioridade, gera adapters e snapshots, calcula hash e registra proveniência.

BAML é spike opcional; não substitui a fonte Git.

### 29.7 Gateway e cache

Bifrost é spike prioritário, executado inicialmente como contêiner pinado ou serviço externo e configurado em `tools/ai-gateway/`.

Caches distintos:

- compilação de prompt;
- prompt caching nativo do provedor;
- cache exato de resposta;
- cache semântico.

Cache semântico é desabilitado por padrão e proibido para implementação, debugging, review, segurança, incidentes, arquitetura, side effects e estado mutável.

### 29.8 Economia de tokens

Usar progressive disclosure, tool search, namespaces, context packs, deduplicação, summaries estruturados, cache e compressão seletiva.

LLMLingua não pode comprimir policies, permissions, AGENTS, CLAUDE, contracts, schemas, código, ABI, critérios de aceite, mensagens críticas ou configurações.

### 29.9 Observabilidade e evals

Langfuse é spike para tracing e datasets; `.ai/prompts/` continua fonte canônica.

Promptfoo é o default para evals rápidas. Registrar correção, escopo, regressão, retrabalho, custo, latência, tokens, cache hit, tools, arquivos e side effects.

### 29.10 Aprendizado contínuo

Pipeline:

```text
execução
→ observação
→ evidência
→ agrupamento
→ learning candidate
→ proposta
→ eval
→ variante
→ comparação
→ revisão
→ aprovação
→ promoção
→ monitoramento
```

Evidência mínima: pedido explícito, mesma correção duas vezes, incidente crítico, eval reproduzível, workflow equivalente três vezes ou drift objetivo.

LangMem, Hermes, GEPA e DSPy são referências/spikes; não promovem mudanças diretamente.

### 29.11 Comunicação entre agentes

Fase 1: arquivos em `.ai/state/`.

Fase 2: Context Broker MCP com tools mínimas:

```text
capabilities.search
capabilities.describe
context.build_pack
tasks.get
tasks.update
handoffs.create
handoffs.respond
artifacts.publish
events.append
```

Fase 3: Claude e Codex chamam-se por MCP/wrappers com limites, tracing, schemas e aprovação para efeitos.

## 30. Referências técnicas primárias


### Nx

- <https://nx.dev/docs/getting-started/intro>
- <https://nx.dev/docs/features/cache-task-results>
- <https://nx.dev/docs/reference/project-configuration>
- <https://nx.dev/docs/technologies/dotnet/introduction>

### uv

- <https://docs.astral.sh/uv/concepts/projects/>
- <https://docs.astral.sh/uv/concepts/projects/workspaces/>
- <https://docs.astral.sh/uv/concepts/projects/sync/>

### wgpu/WebGPU

- <https://github.com/gfx-rs/wgpu>
- <https://docs.rs/wgpu/latest/wgpu/struct.Adapter.html>
- <https://docs.rs/wgpu/latest/wgpu/struct.CommandBuffer.html>
- <https://www.w3.org/TR/webgpu/>

### FlatBuffers

- <https://flatbuffers.dev/>
- <https://flatbuffers.dev/evolution/>
- <https://flatbuffers.dev/flatc/>

### Rust FFI

- <https://doc.rust-lang.org/nomicon/ffi.html>

---

## 31. Resumo executivo final

A arquitetura pretendida é viável:

- um único core proprietário em Rust;
- uma implementação de solver;
- kernels WGSL reutilizados em Web e Desktop;
- CPU fallback;
- bindings finos;
- Nx coordenando toolchains nativas;
- Python gerenciado por uv;
- contratos estruturados e arrays numéricos quentes;
- ABI explícita;
- GPU compute privada do core;
- renderização privada dos hosts;
- multiplayer autoritativo sem falsa nomenclatura de Event Sourcing.

O maior risco não é tecnológico. É tentar construir todas as camadas simultaneamente antes de validar:

- a engine C#;
- o Worker Wasm;
- a C ABI;
- o `wgpu` Web;
- o custo real das transferências.

Por isso, a ordem mandatória é:

```text
decisões
→ Knowledge Plane + Graph IR mínimo
→ AI Control Plane mínimo
→ spikes
→ workspace
→ core CPU
→ bindings
→ GPU
→ hosts
→ multiplayer
→ solver
→ AI Control Plane avançado
```

Essa sequência preserva o objetivo principal: criar um núcleo matemático realmente reaproveitável sem transformar o monorepo em um projeto de manutenção de build.


---

## 32. Manutenção desta fonte mestre

Toda alteração arquitetural deve:

1. identificar seção afetada;
2. citar task e ADR;
3. atualizar versão;
4. classificar decisão como `LOCKED`, `PROVISIONAL` ou `OPEN`;
5. atualizar Graph IR;
6. atualizar `AGENTS.md` quando comportamento operacional mudar;
7. atualizar `.ai/` quando o AI Control Plane mudar;
8. regenerar adapters;
9. executar drift checks;
10. preservar histórico Git.

Documentos substituídos devem ir para:

```text
docs/archive/superseded/
```

com:

```text
SUPERSEDED BY: GRAFTING_MASTER_SOURCE.md
DO NOT USE AS CURRENT ARCHITECTURAL AUTHORITY
```
