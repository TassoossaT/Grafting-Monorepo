# Estado atual do planejamento

> **Tipo:** estado operacional mutável  
> **Autoridade:** não altera a arquitetura; em conflito,
> `GRAFTING_MASTER_SOURCE.md` vence.  
> **Atualizado em:** 26 de julho de 2026

## Situação

- O Grafting Monorepo ainda não foi criado.
- Não existe repositório Git nem histórico de commits.
- Não existem workspaces, lockfiles, aplicações, crates, pipelines ou
  infraestrutura em execução.
- A fase atual é exclusivamente de imaginação, pesquisa, arquitetura e
  preparação da criação a partir do zero.
- A fonte arquitetural ativa é `GRAFTING_MASTER_SOURCE.md`.

## Fase atual

```text
planejamento
→ revisão adversarial
→ fechamento dos Decision Gates
→ ADRs
→ spikes descartáveis
→ scaffold
```

## Decision Gates prioritários

- `GATE-001` — host Web;
- `GATE-002` — engine C#;
- `GATE-003` — plataformas desktop da V1;
- `GATE-004` — host do servidor autoritativo;
- `GATE-005` — nível de determinismo.

Os demais gates permanecem registrados na fonte mestre.

## Spikes fundacionais previstos

1. Rust → Wasm em Dedicated Worker;
2. Rust C ABI/DLL → C#;
3. mesmo WGSL em wgpu nativo e Web;
4. benchmark de batching e copy budget;
5. validação inicial de Nx e toolchains;
6. Graph IR mínimo e visualização X6 read-only;
7. AI Control Plane mínimo sem gateway ou autoevolução avançada.

## Próxima ação recomendada

Produzir comparações objetivas e ADRs propostos para `GATE-001` a `GATE-005`.
Nenhum agente deve fechar esses gates sem decisão explícita do proprietário.

## Regra de atualização

Este arquivo registra apenas:

- estado real;
- fase corrente;
- próximos passos;
- bloqueios;
- decisões aguardando o proprietário.

Decisões arquiteturais devem ser atualizadas na fonte mestre ou em ADR.
