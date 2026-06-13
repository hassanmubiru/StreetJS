# StreetJS Framework — JWT Authentication Example

Demonstrates JWT-based authentication with RBAC using StreetJS Framework.

## Quick Start

```bash
npm install
npm run build
JWT_SECRET=mysecret npm start
```

## Endpoints

### POST /auth/login
Exchange credentials for a JWT token.

```bash
curl -s -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"password123"}'
# → {"token":"eyJ...","expiresIn":"1h"}
```

Demo users:
- `alice@example.com` / `password123` — roles: `admin`
- `bob@example.com` / `password456` — roles: `user`

### GET /api/me
Returns the authenticated user's profile.

```bash
curl -s http://localhost:3001/api/me \
  -H 'Authorization: Bearer <token>'
# → {"id":"user-1","email":"alice@example.com","roles":["admin"]}
```

### GET /api/admin
Admin-only endpoint (requires `admin` role).

```bash
curl -s http://localhost:3001/api/admin \
  -H 'Authorization: Bearer <token>'
# → {"message":"Welcome, admin!","user":{...}}
# bob's token → 403 Forbidden
```

## Key Concepts

- `JwtService` — Signs and verifies JWTs with HMAC-SHA256.
- `authMiddleware` — Populates `ctx.user` from the `Authorization: Bearer <token>` header.
- `requireRoles` — Middleware that throws `ForbiddenException` if the user lacks the required role.
- `RbacService` / `rbacGuard` — Hierarchical RBAC with `@Roles()` and `@Permissions()` decorators.
