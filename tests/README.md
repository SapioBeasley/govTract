# govTract Tests

This directory is the shared home for repository-level automated test assets and cross-cutting regression coverage.

The repository follows the TDD workflow defined in the root `AGENTS.md`: Red -> Green -> Refactor.

## Running the deterministic suite

Run the complete normal PR regression suite with:

```bash
npm test
```

`npm test` automatically discovers `*.test.ts` and `*.test.tsx` files under `app/`, `components/`, `lib/`, `scripts/`, and `tests/`, so adding a new test in those locations does not require registering another package script or GitHub Actions step.

Database-backed tests expect an isolated PostgreSQL database with all govTract migrations applied and `DATABASE_URL` set to that database. Tests that exercise encrypted source-session persistence also require a test-only `SOURCE_SESSION_ENCRYPTION_KEY`. GitHub PR validation provisions these automatically using an ephemeral PostgreSQL service and a deterministic non-production test key; it does not use Neon or production credentials.

Focused `test:*` package scripts remain available for local iteration, but `npm test` is the aggregate deterministic CI source of truth.

## Intended structure

- `tests/unit/` — cross-cutting unit tests that do not fit naturally beside a module.
- `tests/integration/` — deterministic integration tests across application/database boundaries.
- `tests/contracts/` — reusable procurement source-adapter and other interface contract tests.
- `tests/fixtures/` — sanitized, deterministic source payloads and regression fixtures.
- `tests/regression/` — bug reproductions and behavior regressions that span multiple modules.

Existing tests may remain in their current locations until a deliberate cleanup task moves them. Do not relocate tests solely for consistency if doing so would obscure history or create unrelated churn.

## Rules

- Write or update the failing test before implementing behavioral changes when practical.
- Prefer observable behavior over implementation-detail assertions.
- Keep normal CI deterministic and isolated from paid AI calls and unnecessary live procurement-source access.
- Use sanitized captured fixtures for SAM.gov, Beacon, BidNet, USAspending, and local procurement sources.
- Add a regression fixture/test whenever a new source edge case or production bug is discovered.
- Test ingestion idempotency, provenance preservation, and failure isolation where relevant.
- Live-source checks are supplemental validation, not the primary regression layer.

See the root `AGENTS.md` for the complete engineering and testing policy.
