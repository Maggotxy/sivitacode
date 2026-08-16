# Agent Note: SivitaCode product benchmark

Status: implemented

English | [中文](2026-08-14-sivitacode-product-benchmark.zh.md)

## Problem

SivitaCode needs repeatable evidence for built-product startup and assembled-agent acceptance. A single wall-clock number without samples, environment facts, or a matching baseline cannot distinguish product regression from host variation. Startup speed also cannot establish agent task quality.

## Decision

The benchmark runs three deterministic built-entry scenarios after configurable warmup and records every observation, median, and nearest-rank p95 in versioned JSON. It also runs the real built-mode headless Loader acceptance with a deterministic mock model, Bash tool call, and durable session assertion. The report records its Node and operating-system environment.

Baseline enforcement is explicit rather than automatic. A caller supplies a report from equivalent infrastructure and a maximum median regression percentage. The benchmark rejects a missing scenario or an over-budget median. Scheduled hosted CI collects an artifact without comparing different ephemeral machines; a manual workflow accepts an explicit prior run id for enforcement.

## Alternatives considered

**Commit one golden latency threshold.** Rejected because runner hardware, power state, Node version, and concurrent load would turn an absolute threshold into noise.

**Call keyless mock acceptance an agent-quality benchmark.** Rejected because it proves product composition and tool execution, not success on representative coding tasks or real-model variance.

**Compare SivitaCode and the compatibility command.** Rejected because both entries intentionally share one runtime; this would measure branding dispatch rather than an architectural alternative.

## Consequences

Maintainers can archive comparable machine-readable evidence and reject measured regressions without presenting host-specific values as universal performance. Comparative agent-quality claims remain unavailable until a pinned corpus, real model/provider protocol, repeated trials, cost accounting, and statistical analysis exist.
