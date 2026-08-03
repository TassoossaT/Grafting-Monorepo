# Definition of Done

> Extracted from `GRAFTING_MASTER_SOURCE.md` §24 as part of the master-source
> split (`MASTER-SOURCE-SPLIT-PHASE1`). This section had zero external
> citations by section number. See `GRAFTING_MASTER_SOURCE.md` §0's router
> table for the full document map.

A task is only complete when:

- the requested scope has been implemented;
- relevant tests pass;
- lint/format/typecheck pass;
- Nx inputs and outputs are correct;
- no cacheable task gained a side effect;
- affected documentation has been updated;
- an ADR was created when there was a decision;
- a contract/ABI was versioned when necessary;
- generated code is reproducible;
- there is no duplicated authoritative logic across hosts, apps, or packages;
- consumed packages have current generated public-API baselines and behavioral
  contract tests for their documented guarantees;
- third-party runtime APIs and types do not leak outside their designated
  owning module/project boundary;
- error and cleanup were considered;
- the agent reported the files and commands executed;
- the change was small enough for review;
- `AGENTS.md`, `.ai/`, adapters, and Graph IR did not drift;
- skill, prompt, or agent changes have an applicable eval;
- tokens, cache, and cost were recorded when there was a model call;
- no permission or tool was silently expanded.

For performance:

- benchmark attached;
- comparable baseline;
- hardware and versions recorded;
- the result is not based on an irrelevant microbenchmark.
