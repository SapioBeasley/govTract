# govTract Agent Instructions

These instructions apply to all implementation work in this repository unless a more specific `AGENTS.md` exists deeper in the tree.

## Product and architecture defaults

- Use Next.js App Router (`app/`), TypeScript, shadcn/ui, and Tailwind CSS.
- Prefer a single Next.js application plus PostgreSQL for the MVP.
- Keep procurement integrations behind a small source-adapter abstraction.
- Preserve original source payloads separately from normalized procurement data.
- Keep the opportunity model source- and geography-agnostic even though the initial UX is optimized for Houston contractors.
- Prefer deterministic identifiers and source evidence over AI inference for matching opportunities, awards, vendors, and predecessor contracts.
- Treat SAM.gov Contract Opportunities as the primary federal solicitation source and USAspending.gov as the primary federal historical award/spending source.
- Use authoritative local procurement records when available for local historical contract, pricing, competitor, and incumbent intelligence.

## Test-driven development is the default workflow

For implementation work, use Red -> Green -> Refactor.

1. Translate the issue acceptance criteria and expected behavior into automated tests before production implementation.
2. Add or modify the smallest focused test that demonstrates the missing behavior or reproduces the bug.
3. Confirm the new test fails for the expected reason when practical.
4. Implement the minimum production change needed to make the test pass.
5. Run the focused test first, then the relevant broader test suite.
6. Refactor only after the behavior is green, keeping tests green throughout.
7. Do not consider an issue complete without appropriate automated regression coverage unless automated coverage is genuinely impractical. If so, document why and provide a deterministic verification procedure.

Do not weaken, delete, skip, or rewrite a valid test merely to make an implementation pass. If an existing test is incorrect, explain the mismatch with the intended contract before changing it.

## What counts as the red test

- Bug fix: a regression test that fails on the current bug.
- API or server behavior: route/handler/service tests around observable inputs and outputs.
- Database behavior: schema, persistence, idempotency, migration, or query behavior tests.
- Source adapters: deterministic fixtures and adapter-contract tests.
- UI behavior: focused component or integration tests where practical; otherwise test the underlying state/data behavior and add deterministic UI verification.
- Data normalization: fixture-driven normalization tests that capture source edge cases.
- AI-assisted features: tests against deterministic mocks/fixtures and persisted model-output fixtures in normal CI, not paid live-model calls.

## Test design rules

- Prefer behavior tests over implementation-detail tests.
- Keep tests deterministic, isolated, and re-runnable.
- Use realistic captured fixtures for external procurement sources, sanitized of secrets and unnecessary personal data.
- Do not make normal unit/integration tests depend on live SAM.gov, Beacon, BidNet, USAspending, Vercel, Neon, or other external services.
- Keep live-source checks bounded and separate from deterministic test suites.
- Add regression fixtures for every newly discovered source edge case.
- Test idempotency for ingestion and derived-data jobs: rerunning the same input must not create duplicate canonical records or duplicate downstream work.
- Test failure isolation where relevant: one malformed source record should not abort an otherwise recoverable batch.
- Test source provenance and evidence preservation whenever normalization or matching behavior changes.

## Database and migration rules

- Database changes require both Drizzle schema changes and an additive migration unless the task explicitly concerns an unapplied local-only schema.
- Never edit an already-applied migration; add a new migration instead.
- Prefer additive/backward-compatible migrations for the MVP.
- Preserve existing canonical IDs when practical during data-model evolution.
- For migrations with backfills, make the backfill deterministic and safe to re-run or otherwise protected from duplication.
- Test important constraints, uniqueness guarantees, nullable source fields, and relationship behavior.
- Never run destructive migration experiments against production data as part of TDD.

## Procurement source adapter rules

- Implement source behavior through the shared adapter contract rather than adding source-specific branching to common ingestion code.
- Preserve the raw source record before destructive normalization.
- Keep source record identifiers, source revision identifiers, URLs, timestamps, hashes, and provenance available for traceability.
- Source-specific parsing should be fixture-tested.
- Common adapter behavior should be covered by contract tests that can be reused across Beacon, SAM.gov, BidNet, USAspending, and future sources.
- Live checks may validate provider behavior, but fixture-driven tests are the required regression layer.

## Opportunity, award, vendor, and incumbent matching

- Deterministic matching rules come first.
- Do not treat an incumbent as canonical unless a source explicitly identifies one.
- Store inferred incumbent/predecessor/competitor relationships as derived intelligence with supporting evidence, method, and confidence.
- Ambiguous fuzzy matches must not be irreversibly merged.
- Matching tests should cover exact identifiers, strong deterministic composites, ambiguous candidates, and non-matches.

## AI usage and cost controls

- An opportunity may receive at most one automatic AI solicitation-understanding processing cycle.
- After the first automatic AI cycle, every later AI regeneration requires an explicit manual user action.
- Page renders, ingestion, scheduled jobs, retries, amendments, model changes, prompt changes, and extractor changes must not silently trigger another AI cycle.
- Deterministic retrieval, hashing, extraction, stale detection, matching, and input preparation may rerun automatically without model usage.
- A single logical AI processing cycle may use bounded staged/chunked model calls when required for large solicitations.
- Persist and reuse AI outputs so repeated page loads do not consume model tokens.
- Record non-sensitive model/version, input fingerprint, trigger type, usage, and cost metadata where available.
- Normal PR CI must use mocks/fixtures and must not make paid model calls.
- Paid/full AI evaluation workflows must be manual-triggered or otherwise deliberately bounded, never an automatic cost on every PR/push/ingestion run.

## GitHub Actions and CI

- GitHub Actions are appropriate for bounded MVP batch workflows, tests, reconciliation, backfills, data-quality checks, and evaluations.
- Do not use GitHub Actions as the long-term production queue or for latency-critical user-facing work.
- General PR validation should remain deterministic and should not require live procurement-source access.
- Source-specific live checks should be isolated so unrelated UI/application changes do not trigger external calls.
- Every PR that changes behavior should include the relevant automated tests.

## Working an issue

Before implementation:

- Read the issue and its acceptance criteria.
- Inspect current behavior and relevant tests.
- Identify the smallest observable behavior that proves the issue is satisfied.
- Write the failing test or regression fixture first.

During implementation:

- Keep changes narrowly scoped to the issue.
- Prefer small, composable functions and explicit domain types.
- Avoid unrelated cleanup unless required to make the change safe.
- Preserve backward compatibility unless the issue explicitly authorizes a breaking change.

Before declaring the issue complete:

- Run the focused tests.
- Run the relevant broader test suites.
- Run TypeScript validation.
- Run the production build when application code or build-affecting configuration changed.
- Confirm migrations are additive and ordered correctly when DB changes are involved.
- Confirm no secrets, credentials, session cookies, or sensitive payloads were added to code, fixtures, logs, or PR text.
- Confirm AI/model calls cannot be triggered unintentionally by the change.

## Pull request expectations

PR descriptions should state:

- the behavior being added or fixed;
- the test or fixture that demonstrated the missing behavior;
- the implementation approach;
- the validation run after implementation;
- any migration, source-access, AI-cost, or rollout considerations.

When practical, explicitly describe the TDD sequence: what failed before the implementation and what passes now.
