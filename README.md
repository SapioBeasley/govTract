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
