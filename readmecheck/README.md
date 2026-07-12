# readmecheck

A [Street](https://hassanmubiru.github.io/StreetJS) framework application.

## Prerequisites

- Node.js >= 22.0.0
- PostgreSQL >= 14 (optional, for database features)

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
street dev
```

## Available Commands

| Command                    | Description                        |
| -------------------------- | ---------------------------------- |
| `street dev`              | Start development server           |
| `street build`            | Compile for production             |
| `street start`            | Start production server            |
| `street test`             | Run tests                          |
| `street migrate:run`      | Run pending migrations             |
| `street migrate:create`   | Create a new migration file        |

## Project Structure

```
readmecheck/
├── src/
│   ├── controllers/    # HTTP request handlers
│   ├── services/       # Business logic
│   ├── repositories/   # Data access layer
│   ├── middleware/     # Custom middleware
│   ├── gateways/       # WebSocket handlers
│   └── main.ts         # Application entry point
├── tests/              # Integration and unit tests
├── migrations/         # SQL migration files
├── uploads/            # File upload storage
├── package.json
├── tsconfig.json
├── Dockerfile
├── street.config.ts
└── README.md
```

## Scripts

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Production start
npm run test         # Run tests
npm run migrate      # Run migrations
```

## Deploy with Docker

**Local (zero-config):** `docker compose up --build` runs the app in development
mode — JWT/session keys are auto-generated and CORS allows all origins. Good for
trying it out; not for production.

**Production:** the `Dockerfile` sets `NODE_ENV=production`, so the app
**fails fast** if required secrets are missing (this is intentional — no insecure
defaults in production). Build once, then run with the secrets supplied:

```bash
docker build -t readmecheck:latest .

docker run -p 3000:3000 \
  -e JWT_SECRET="$(openssl rand -hex 24)" \      # ≥ 32 chars
  -e SESSION_KEY="$(openssl rand -hex 32)" \     # 64 hex chars
  -e CORS_ORIGINS="https://app.example.com" \    # comma-separated allowlist
  readmecheck:latest
```

In real deployments, inject these from your platform's secret store (Kubernetes
Secrets, ECS task secrets, Docker secrets) rather than the command line, and set
`DB_DRIVER=postgres` + `PG_*` for a managed database. `GET /health` returns
`200` once the app is serving.
