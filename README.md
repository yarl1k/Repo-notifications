# [Repo Notify](https://yarl1k.tech/)

A monolith service that monitors GitHub repositories for new releases and sends email notifications to subscribers.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24, TypeScript 6 |
| Framework | Express 5 |
| Database | PostgreSQL 17 (Prisma 7 ORM) |
| Queue | BullMQ (Redis-backed) |
| Email | Resend API |
| GitHub | Octokit REST |
| Caching | Redis (ioredis), 10 min TTL |
| Scheduler | Croner |
| Monitoring | Prometheus (prom-client) |
| Security | Helmet, express-rate-limit |
| Testing | Vitest |
| CI | GitHub Actions |
| Container | Docker, Docker Compose |

## How It Works

### Subscription Flow

1. User submits their email and a GitHub repo (`owner/repo`) via the web UI or the API.
2. The input is validated: email must be a valid format (`user@domain.tld`), repo must match GitHub naming rules. Invalid input is rejected **before** any external API call.
3. The repo is verified against the **GitHub API** (response cached in Redis for 10 minutes to reduce rate limit consumption).
4. A **6-digit confirmation code** is sent to the user's email via BullMQ queue → Resend API. A **30-second cooldown** prevents spam — if the user resubmits during this window, the existing code stays valid and no duplicate email is sent.
5. User enters the code to confirm. The code expires after **30 minutes**. Once confirmed, the subscription becomes active and receives a unique 6-digit unsubscribe token.

### Release Scanner

A **cron job runs every 5 minutes**, checking the GitHub API for new releases on all repositories that have at least one confirmed subscriber. It uses **ETags** for conditional requests — if nothing changed, GitHub returns `304 Not Modified` without charging the rate limit is. When a new release tag is detected (different from `lastSeenTag`), notification emails are queued in bulk for all subscribers of that repo.

### Email Queue

All emails go through a **BullMQ queue** with:
- 3 retry attempts with exponential backoff
- Automatic cleanup (completed jobs kept for 10 min, failed for 24h)
- Prometheus counter tracking (`emails_sent_total`)

Two email types: `subscription_confirmation` and `release_notification`, each using HTML templates.

### Hosting

You can find basic example of Full-Stack application with simple html web-page here: [Repo Notify](https://yarl1k.tech/). It locates on digitalOcean, and all code is conterenized in Docker.

## API

Four endpoints under `/api`:

- `POST /subscribe` — subscribe to release notifications
- `GET /confirm/:token` — confirm with the 6-digit code
- `GET /unsubscribe/:token` — unsubscribe with the 6-digit token
- `GET /subscriptions?email=` — list active subscriptions

Full request/response documentation is available via **Swagger UI** at `/api-docs` when running in development mode. The API contract is defined in `app/backend/swagger.yaml`.

Additionally, `GET /metrics` exposes Prometheus metrics (protected by `X-API-KEY` header).

You can also view it using [Swagger Editor](https://editor.swagger.io/). 

## Getting Started

### Prerequisites

- Docker & Docker Compose
- [Resend](https://resend.com) API key
- [GitHub Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

### Environment Variables

Create a `.env` file in the project root, according to `.env.example`:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_DB=repo_notifications

PORT=3000

GITHUB_TOKEN=ghp_xxxxxxxxxxxx

RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_USER_FROM="RepoNotify" <noreply@yourdomain.com>

REDIS_HOST="redis"
REDIS_PORT=6379

ADMIN_API_KEY=your_secret_key
```

### Run with Docker

```bash
docker compose up -d --build
```

This starts three containers: PostgreSQL, Redis, and the app. Prisma migrations run automatically on startup. The app is available at `http://localhost:3000`.

### Local Development

```bash
# Install dependencies
pnpm install

# Generate prisma client
pnpm --filter ./app/backend exec prisma generate

# Run in dev mode (Requires external Postgres and Redis)
pnpm --filter ./app/backend run dev
```

Swagger UI will be available at `http://localhost:3000/api-docs` (dev mode only).

### Testing

```bash
pnpm --filter ./app/backend run test
```

### CI

GitHub Actions runs on every push/PR to `main` and `dev`: installs dependencies, generates Prisma client, runs the linter (`tsc --noEmit`), and runs the test suite.
