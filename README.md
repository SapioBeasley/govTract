# govTract

govTract is a multi-source government contracting platform focused initially on helping Houston contractors discover, understand, evaluate, and respond to procurement opportunities.

## Stack

- Next.js 16 App Router (`app/`)
- TypeScript with strict mode
- Tailwind CSS 4
- shadcn/ui configuration

## Local development

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The root route redirects to `/opportunities`.

## Validation

```bash
npm run typecheck
npm run build
```

## Application areas

- `/opportunities` — opportunity discovery
- `/saved` — saved/pursuit pipeline
- `/bids` — bid workspaces
- `/company` — contractor profile
- `/admin` — ingestion and processing diagnostics

## Environment

Issue #1 has no runtime secrets. Copy `.env.example` when environment configuration is introduced in issues #2 and #4. Never commit secrets or local `.env` files.
