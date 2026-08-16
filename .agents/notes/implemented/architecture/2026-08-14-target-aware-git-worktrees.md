# Agent Note: Target-aware Git worktrees

Status: implemented

English | [中文](2026-08-14-target-aware-git-worktrees.zh.md)

## Problem

Parallel coding sessions need independent checkouts in local, SSH, and container targets. Host-only Git calls would create worktrees on the wrong machine, while custom dirty-state checks could race or delete untracked work.

## Decision

Git worktree operations use the active managed subprocess provider, so local, SSH, and container sessions execute Git in their selected world. Listing parses `git worktree list --porcelain -z`. Creation delegates branch validation to `git check-ref-format --branch` and places linked worktrees below the repository-owned `.sivitacode/worktrees` directory.

The deployment Inventory exposes these operations through its authenticated Remote namespace. Its Web settings page selects a target, manages linked worktrees, and creates a target-pinned session with the worktree path as its working directory.

Removal accepts only an exact path returned by Git, rejects the main worktree and paths outside the managed directory, and never supplies `--force`. Git remains authoritative for dirty, untracked, submodule, and locked refusal.

## Alternatives considered

**Copy the Mux worktree implementation.** This was rejected because Mux is AGPL prior art and the MIT line uses an independent implementation over Git's public protocol.

**Precompute dirty and lock state before forced deletion.** This was rejected because the check races the delete and duplicates Git's authoritative refusal. The service never passes `--force`.

**Allow arbitrary removal paths.** This was rejected because an administrative mistake could delete a worktree owned outside SivitaCode's managed directory.

## Consequences

Branch names are encoded into path-safe directory leaves and never interpreted by a shell. The service is independent MIT-licensed code informed by Git's public command protocol; it does not copy the AGPL Mux implementation.

## Verification

Real Git integration tests cover both the service and Inventory composition: they create, list, and remove a linked feature worktree and demonstrate main-worktree, dirty-worktree, and invalid-branch refusal.
