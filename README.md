# Grafting Monorepo

Grafting é um monorepo políglota planejado para reunir:

- um Virtual Tabletop Web em TypeScript e Three.js;
- um jogo desktop em C#/.NET;
- um núcleo único em Rust para domínio, matemática, IA, pathfinding e solver;
- ferramentas Python gerenciadas por uv;
- interoperabilidade Rust/Wasm/TypeScript e Rust/C ABI/C# pelo subsistema Isekai;
- compute GPU com wgpu/WGSL e fallback CPU;
- Knowledge & Automation Plane;
- Grafting Graph IR;
- AI Control Plane compartilhado entre Claude e GPT/Codex.

## Estado atual

O repositório ainda está em fase de planejamento. Não existe implementação,
workspace ou histórico Git anterior.

O próximo marco é fechar os Decision Gates e executar os spikes da Fase 0 antes
do scaffold definitivo.

Consulte:

- [`GRAFTING_MASTER_SOURCE.md`](GRAFTING_MASTER_SOURCE.md) — arquitetura,
  decisões, backlog e plano canônicos;
- [`CURRENT_PLANNING_STATE.md`](CURRENT_PLANNING_STATE.md) — situação corrente e
  próximos passos;
- [`AGENTS.md`](AGENTS.md) — contrato operacional para agentes;
- [`docs/adr/`](docs/adr/) — decisões arquiteturais futuras;
- [`.ai/README.md`](.ai/README.md) — escopo futuro do AI Control Plane.

## Autoridade documental

A ordem de autoridade é:

1. `GRAFTING_MASTER_SOURCE.md`;
2. ADRs aprovados;
3. contratos e schemas versionados;
4. código, manifests e pipelines;
5. `AGENTS.md` raiz e locais;
6. `.ai/`;
7. adapters de fornecedor;
8. documentação gerada.

Arquivos resumidos não substituem a fonte mestre.

## Ordem de criação

```text
decisões
→ ADRs
→ spikes
→ workspace mínimo
→ core CPU
→ bindings Isekai
→ compute GPU
→ hosts
→ multiplayer
→ solver
→ AI Control Plane avançado
```

## Regra central

Não construir todas as camadas simultaneamente. Primeiro reduzir incerteza,
medir as fronteiras críticas e fechar as decisões que alteram a estrutura.
