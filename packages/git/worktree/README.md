# `@deepseek-ai/dsh-git-worktree`

English | [中文](README.zh.md)

Manages linked Git worktrees through the active subprocess execution world. Listing uses `git worktree list --porcelain -z`; creation validates branch names with Git and places worktrees below `<repository>/.sivitacode/worktrees`; removal omits `--force`, rejects paths outside that directory, and leaves dirty, untracked, locked, and main-worktree refusal to Git.

## Model Experience

Indirectly, through worktree consumers that select a session directory.

#### KV Cache effect

None directly.

## Known Limitations and Deferred Work

- Submodules require the Git version's native worktree support and remain subject to Git's removal checks.
