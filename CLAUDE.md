# CLAUDE.md

**[`AGENTS.md`](AGENTS.md) is the authoritative working guide for this
repository.** Read it first. This file exists so that a tool looking for
`CLAUDE.md` finds a pointer rather than a second, drifting copy of the same
instructions — which is exactly the duplication the rest of this codebase was
rearranged to remove.

## The map

| Read | For |
|---|---|
| [`AGENTS.md`](AGENTS.md) | how to work here: the rules, the traps, the security posture, what is still open |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | the layout and why it is that shape, including the deviations from the doctrine and the reasons |
| [`README.md`](README.md) | how to run it, the environment, the operator scripts |
| [`docs/file-inventory.md`](docs/file-inventory.md) | where any `#1` file went — every one of them |
| `../#1/AGENTS.md`, `../#1/CLAUDE.md` | the full history: why the behaviour is what it is, every bug found and every trade weighed. Nothing there was deleted; `#2` did not rewrite the application, so that account still describes it. |

## The three sentences that matter most

**`#2` is `#1` rearranged, not rewritten.** Every route behaves as it did, every
page URL is unchanged, every browser global keeps its name. `#1`'s own test
suites, moved across untouched, pass here — 103 API assertions and 53 browser
journeys. (The administration console is a separate repository now; the
assertions that went with it went with it.) If you are about to change behaviour, that is a different change from
anything structural, and it deserves its own commit and its own reasoning.

**Run `npm run verify` after moving or renaming any file, front or back.** Three
checks, about a second, no network and no database. They catch the failure this
structure makes possible: a reference that points at nothing, a module reaching
past a sibling's published interface, or a route that quietly stopped existing.

**Backend edits do not take effect until the process restarts.** HTML, CSS and
browser JS are read off disk per request; everything under `backend/src/` is
loaded once at boot. The symptom is silence — it reads as "my change did not
save". Use `npm run dev`.
