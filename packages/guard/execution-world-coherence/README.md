# `@deepseek-ai/dsh-execution-world-coherence`

English | [中文](README.zh.md)

Startup guard for assembled coding-agent runtimes. It injects `ctx.fs` and `ctx.subprocess` and rejects activation unless both providers expose the same execution-world object. This prevents split-brain compositions in which file tools inspect one machine while Bash, search, LSP, Git, jobs, MCP stdio, or PTY processes execute on another.

The check compares provider-owned opaque identity, never a display label. Local providers share `LOCAL_EXECUTION_WORLD`; remote adapters share the identity of their exact sandbox owner.

## Known Limitations and Deferred Work

- **Only mounted FS and subprocess roots are compared** — provider-specific child capabilities must continue to derive from these roots or add their own identity check.
