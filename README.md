# Delivery Workspace

[![Application checks](https://github.com/Griva100/delivery-workspace/actions/workflows/checks.yml/badge.svg)](https://github.com/Griva100/delivery-workspace/actions/workflows/checks.yml)
A working full stack project and task management application built with React, TypeScript, Node.js, Express, PostgreSQL, Redis and BullMQ. It includes account creation, secure session cookies, task editing, priorities, due dates, report exports, automated integration tests, Docker support and Vercel configuration.
**Live application:** [https://griva-delivery-workspace.vercel.app](https://griva-delivery-workspace.vercel.app)

Developed for Griva Shah with AI assistance.

## Features

- Account registration, sign-in and sign-out with scrypt password hashes and hashed server-side sessions.
- Private projects and tasks scoped to the authenticated user.
- Task create/edit/delete, status, priority and due date.
- Optimistic concurrency: a stale edit returns HTTP 409 rather than overwriting a newer change.
- Redis-cached workspace reads with invalidation after mutations; PostgreSQL remains authoritative.
- CSV report exports, with BullMQ jobs, retries, a separate worker and report-status polling.
- Inline report mode for a Vercel deployment without a continuously running worker.
- CSV formula escaping and access checks on every private report download.
- Public, read-only sample data for browsing the interface.
- Responsive layouts, loading/error/empty states, and keyboard-accessible forms.

## Run locally

Requirements: Node.js 24+, npm and Docker with Compose.

```sh
cp .env.example .env
docker compose up -d postgres redis
npm ci
npm run db:migrate
npm run dev
```

In a second terminal:

```sh
npm run worker
```

Open `http://127.0.0.1:4188`. Create your own account or choose **Explore a sample workspace** to browse without signing in. The database and Redis use project-specific Docker volumes. The sample credentials in Compose are for loopback development.

To run everything in Docker instead:

```sh
docker compose --profile full up --build
```

Stop a previously running host dev server/worker first to avoid a port conflict. The app runs migrations, waits for PostgreSQL and Redis, and the worker waits for the app health check. `docker compose down` stops this project's services and preserves its data volumes.

## Verify

```sh
npm test
npm run build
```

The tests require the isolated local PostgreSQL and Redis services. They create disposable users and clean up their own database rows. They cover authentication, authorization, cache invalidation, stale edits, concurrency, invalid batches, dates, queue processing, CSV safety, sign-out, persistence across API instances and inline exports.

The GitHub Actions workflow includes PostgreSQL and Redis services and runs migrations, tests and the build. The initial GitHub Actions run passed migrations, tests and the production build on Node.js 24.

## Automatic production deployments

The repository is connected to its Vercel project. Every push to `main` triggers a production build. Vercel runs `npm run vercel-build` to apply the idempotent schema migration, check TypeScript and build the frontend, then updates the live application after a successful build.

GitHub Actions also runs the 11 automated tests and the build on pushes and pull requests. The production `DATABASE_URL` stays in Vercel's sensitive environment variables. Database-backed deployments from other branches need an isolated `DATABASE_URL` in Vercel's Preview environment.

## Vercel deployment

The live frontend and Express API run on Vercel with persistent Prisma PostgreSQL storage. Public access and authenticated workflows were verified on 26 October 2026. The hosted deployment uses inline CSV exports; Redis caching and the BullMQ worker are included and tested through Docker and GitHub Actions.

1. Connect the project source to Vercel, or run the Vercel CLI from this folder after signing in.
2. Configure `DATABASE_URL` with a hosted, pooled PostgreSQL connection string. Keep credentials in Vercel environment variables.
3. Set `REPORT_MODE=inline` for the simplest complete deployment. This generates small CSV reports in the request; it does not pretend a BullMQ worker is running.
4. If using Redis caching, configure `REDIS_URL` for a reachable Redis service. It is optional in inline mode.
5. The Vercel build applies the idempotent schema migration before compilation. Local migrations are available through `npm run db:migrate`. Use an isolated local database for integration tests.
6. Deploy using the included `vercel.json`, then set `APP_URL` to the verified production HTTPS URL and redeploy if needed.
7. Verify sign-up, task changes, sign-out and report downloads at the resulting URL.

For queued report processing in production, set `REPORT_MODE=queue`, configure `REDIS_URL` and run `npm run worker` as a separate long-running service against the same PostgreSQL/Redis. It is not started inside a serverless request. The same worker is included in Docker Compose.

The Vercel adapter is `api/index.ts`; the frontend output is `dist/`. Vercel builds run the idempotent schema migration before compiling the app. Migrations are not run on HTTP requests. The app's PostgreSQL connection pool is capped at five connections per instance. Evaluate a provider's pooler for the expected traffic.

## Architecture

```text
React + TypeScript
        |
  Express REST API ---- Redis read cache
        |                     |
    PostgreSQL        BullMQ export queue
        ^                     |
        +--------- Report worker
```

The inline export path writes the same report records without requiring the worker. A downloaded report is authorized by its owner, and only completed reports can be downloaded.

## Implemented scope

Each account has its own projects. Shared-team invitations, live collaboration, email verification/password reset, billing and large-scale pagination are not implemented. The workspace response currently includes up to 500 tasks. Production deployment and provider configuration must be verified separately from the local test results.

## Official references

- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)
- [Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js)
- [Why local SQLite is unsuitable for Vercel persistence](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
- [BullMQ deployment guidance](https://docs.bullmq.io/guide/going-to-production)
