# Main Integration Workspace Rules

This physical workspace is the permanent main integration workspace.

## Required production workflow reference

- Before any integration, push, deployment, rollback, or task handoff, read and follow `docs/operations/PRODUCTION_SOURCE_OF_TRUTH.md`.
- Treat that document as a required companion to this file, not optional guidance.
- Every new Stock Radar task handoff must carry its required handoff checklist, including local `main`, GitHub `main`, and deployed Vercel commit status.
- Do not report a push or deployment complete until the equality and post-deploy checks in that document pass.

## Workspace lock

- The required repository root is `C:\Users\PC\Documents\Codex\US-Stock Radar`.
- The required branch is `main`.
- Never run `git switch` or `git checkout` in this workspace.
- Never create, move, remove, or repoint a Git worktree from this workspace.
- Never run repository commands with another worktree or repository as the working directory.
- Do not implement isolated feature work directly in this workspace. Use a separate task, branch, and worktree for feature development.

## Local development server ownership

### Port 3110: permanent user-review server

- Port `3110` is the persistent user-review server and must run from the permanent `main` workspace at `C:\Users\PC\Documents\Codex\US-Stock Radar`.
- Keep the `3110` server running across ordinary feature development and main integration. Do not stop or restart it merely to perform a final-main verification.
- For ordinary TypeScript, TSX, CSS, and API route changes, rely on Next.js development hot reload and verify the current `main` HEAD through the existing `3110` UI or API.
- Restart `3110` only when an `.env` or environment-variable change, `next.config` or runtime configuration change, package/runtime change, server failure, or confirmed hot-reload failure actually requires it.
- Before an allowed `3110` restart, state the specific reason. A routine health check or the fact that a merge completed is not by itself a restart reason.

### Ports 3111 and above: Codex worktree servers

- Run feature-development and candidate verification servers from separate worktrees on port `3111` or higher.
- Codex may stop or restart these worktree-owned servers as needed. Use distinct ports such as `3112` and `3113` for concurrent tasks.
- The normal verification flow is: verify the candidate on its `3111+` worktree server, merge the approved change into `main`, leave `3110` running, and confirm the merged `main` HEAD through the existing `3110` UI or API.

### Shared local database caution

- Different ports and worktrees can still share the same local Supabase database. Server separation does not isolate database state.
- Continue to follow the existing migration, cleanup, and destructive-database safety rules for every worktree and port.

## Start-of-task check

Before changing files or Git state, run and inspect:

```powershell
$pwd.Path
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

- If the root or branch differs from the required values, stop and report it. Do not correct it by switching branches.
- If the working tree is not clean before a new integration begins, stop and report the changed files.

## Integration only

- Bring completed work into `main` without leaving `main`.
- Use `git merge --no-ff <branch>` for a complete feature branch.
- Use `git cherry-pick <commit>` only when selected commits are explicitly requested.
- Inspect other branches with `git show`, `git log`, or `git diff`; do not switch to them.
- Resolve conflicts semantically and preserve unrelated user changes.
- Run the relevant tests after integration.
- Push only when the user explicitly requests it.

## Mandatory worktree acceptance and merge gate

- A worktree's completion report, code review, or passing tests alone never authorizes a merge. The main integration agent must independently verify the original user request before merging.
- Before a task is delegated, record concrete acceptance checks from the user's request: affected pages or APIs, expected user-visible behavior, relevant account/plan states, and required viewport sizes.
- Before merging, compare every changed file and behavior in the candidate branch against that acceptance list. Any change outside the requested scope is a merge blocker until it is removed, split into its own task, or explicitly approved by the user.
- For every UI, route, authentication, permission, redirect, data, or plan change, verify the real user journey on the task branch before merge. This includes the exact direct URLs the user uses, logged-out and relevant logged-in account states, and PC, intermediate, and 390px mobile views when the change can affect them.
- For visual work, inspect the actual rendered screen and DOM layout where needed; source code and automated tests are supporting evidence only, not completion evidence.
- Record checks that could not be performed as unverified. Unverified or ambiguous behavior blocks merging; return it to the worktree instead of assuming the intended outcome.
- After a merge, run the same critical user-journey smoke checks on local `main`. If the merged result differs from the verified task result, stop further integrations and report the discrepancy before changing anything else.

## SEC diagnostics

- Start with `docs/DIAGNOSTICS_INDEX.md`; it links the feature-specific diagnostic references where each investigation path and its detailed meaning are defined.

## Investigation and change boundaries

- Treat diagnosis, investigation, and review requests as read-only unless the user also explicitly requests a change. Do not alter code, product state, data, jobs, caches, or permissions while investigating.
- Report confirmed facts, inferences, unverified items, and performed changes separately. Do not present the most likely explanation as a confirmed cause.
- A read failure, permission boundary, limited query scope, or unsupported state is not evidence that data or a record does not exist.
- Before a requested fix, reproduce the user-visible behavior where possible and identify the failed layer; after it, report both changed and intentionally unchanged areas.
- Keep feature-specific investigation paths and response semantics in their own diagnostic documents rather than duplicating them here.

## SEC analysis value lock

- Code must not calculate, correct, replace, or supply fallback values for SEC LLM analysis results. Validators may only detect and report errors.

## End-of-task check

Before reporting completion, confirm:

```powershell
$pwd.Path
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

The workspace must still be the required root on `main`. A non-clean status is acceptable only for changes intentionally made during the current task and clearly reported to the user.
