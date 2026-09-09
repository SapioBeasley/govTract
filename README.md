# govTract

govTract is a multi-source government contracting platform focused initially on helping Houston contractors discover, understand, evaluate, and respond to procurement opportunities.

## Stack

- Next.js 16 App Router (`app/`)
- TypeScript with strict mode
- Tailwind CSS 4
- shadcn/ui configuration
- PostgreSQL with Drizzle ORM

## Local development

Requirements: Node.js 20.9+ and npm, plus access to a PostgreSQL database.

```bash
npm install
cp .env.example .env.local
```

Set `DATABASE_URL` in `.env.local` for the Next.js application. CLI database commands read `DATABASE_URL` from the process environment, so export the same value before running them:

```bash
export DATABASE_URL="postgresql://user:password@host/database"
npm run db:migrate
npm run db:check
npm run dev
```

Open `http://localhost:3000`. The root route redirects to `/opportunities`.

The application health endpoint is available at:

```text
GET /api/health/db
```

It returns HTTP 200 when PostgreSQL is reachable and HTTP 503 when the database is unavailable. The response does not expose credentials or raw database errors.

## Database migrations

SQL migrations live in `drizzle/` and are applied in filename order by:

```bash
npm run db:migrate
```

Applied migration filenames and SHA-256 checksums are recorded in `public.govtract_migrations`. Re-running the command is safe: already-applied migrations are skipped, and changing an applied migration causes the command to fail so schema changes must be added as a new migration.

The initial foundation migration uses `IF NOT EXISTS` so an already-populated govTract database can adopt the migration journal without recreating existing tables or indexes.

## Validation

```bash
npm run typecheck
npm run build
npm run db:check
```

## Application areas

- `/opportunities` — opportunity discovery
- `/saved` — saved/pursuit pipeline
- `/bids` — bid workspaces
- `/company` — contractor profile
- `/admin` — ingestion and processing diagnostics

## Environment

Copy `.env.example` to `.env.local` for local application development. Keep credentials only in local environment files, Vercel environment variables, or GitHub Actions secrets; never commit live database credentials.

For persisted ingestion runs, configure the GitHub Actions repository secret `DATABASE_URL` with the same target PostgreSQL database used by the application.

### Beacon document access

Beacon solicitation metadata can be discovered through the public supplier experience, but individual document downloads require an authenticated supplier session for protected documents. govTract uses the same `/api/planholder/document/...` route rendered by Beacon's supplier UI and does not bypass the underlying private storage bucket.

Connect or reconnect Beacon from `/admin`. govTract validates the one-time login link, captures the reusable Beacon browser session, encrypts it, and stores it in `source_connections`. Document ingestion loads that persisted session at runtime; it does not require a manually copied Beacon cookie secret.

The GitHub Actions repository secret `SOURCE_SESSION_ENCRYPTION_KEY` must use the exact same 32-byte key configured in Vercel so Actions can decrypt the persisted Beacon source session. Do not rotate that key while encrypted sessions depend on it unless there is a reconnect or migration plan.

Before protected document retrieval, the job restores the persisted Beacon session into Puppeteer and verifies `/api/rest/session` reports role `supplier`. An invalid or unauthorized session is marked `needs_reauth`; opportunity metadata discovery remains independently usable.

Some Beacon solicitations require the connected supplier to register before their document routes become available. govTract handles this hands-off by default: when that specific registration-required response is observed, it uses the connected Beacon contact/company profile to create the solicitation planholder registration as `Bidder`, preserves the account's existing special-designation values, sets `emailDocument=false`, and retries the blocked document. Registration is deduplicated per solicitation within a run. Set `BEACON_AUTO_REGISTER=false` only when an operator intentionally wants to disable this behavior. A registration failure does not incorrectly mark the reusable Beacon session as expired.

Beacon can respond to the individual planholder route with a short-lived AWS S3 presigned URL for `documents.beaconbid.com` in `us-west-2`. govTract validates that redirect against the expected bucket, region, and exact document key, then streams it without forwarding the Beacon session cookie. Presigned URLs are treated as ephemeral credentials: they are never stored as document URLs and are never written to logs or workflow artifacts.

Document bytes are streamed only long enough to enforce size limits and compute SHA-256. The file body is not persisted by default. Existing hashes are skipped unless rehashing is explicitly requested, while amendment/version and reprocessing semantics remain unchanged.
