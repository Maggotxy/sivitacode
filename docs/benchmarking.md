# SivitaCode benchmarking

English | [中文](benchmarking.zh.md)

This contributor reference defines reproducible product evidence; it does not claim that one model or agent is better from startup latency alone. Build the repository, then run the built SivitaCode entry and the keyless assembled-agent acceptance benchmark:

```sh
pnpm run build
pnpm benchmark:sivitacode --samples 9 --warmup 2 --output benchmark-results/sivitacode.json
```

The JSON report records the Node and operating-system environment, every observation, median and nearest-rank p95 for product version startup, headless composition/help, and Web configuration composition. It also boots the real headless Loader tree in built mode, drives a deterministic mock-model Bash tool round trip, and requires its persistence acceptance test to pass. The latter is an acceptance duration rather than a latency distribution because repeating it would mostly measure test-process setup.

Compare only reports from equivalent hardware, operating-system images, Node versions, power modes, and otherwise idle runners. Use an explicit prior report to reject median regressions:

```sh
pnpm benchmark:sivitacode \
  --samples 9 \
  --warmup 2 \
  --baseline benchmark-baseline/sivitacode.json \
  --max-regression-percent 15 \
  --output benchmark-results/sivitacode.json
```

The independent `SivitaCode benchmark` workflow uploads the machine-readable report. A manually dispatched run can download a named artifact from an explicit successful run id and enforce the selected median budget. Scheduled runs collect evidence without comparing unrelated hosted machines. Agent-quality claims require a separate task corpus, pinned model and provider, repeated trials, judge protocol, token/cost accounting, and confidence intervals; this startup benchmark cannot support such claims.
