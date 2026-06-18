# Database Access and Prisma Migrations

FastAIBooking Docker Compose service names:

- PostgreSQL service: `postgres`
- API service: `api`

The Prisma schema reads `DATABASE_URL` from the environment.

## Why `P1001` Happens

This error:

```text
P1001: Can't reach database server at `localhost:5432`
```

means Prisma resolved the database host to `localhost`, but no PostgreSQL server was reachable from the command's network context.

- From the host machine, `localhost:5432` means port `5432` on the host machine.
- From inside the `api` container, `localhost:5432` means the `api` container itself, not PostgreSQL.
- Inside the Docker Compose network, PostgreSQL is available as `postgres:5432`.

The standard Docker migration flow does not depend on a host port. It runs Prisma in the `api` container and reaches PostgreSQL as `postgres:5432`. A host command can use `localhost:5432` only when the active Compose configuration or an override explicitly publishes PostgreSQL to the host.

## How `DATABASE_URL` Is Loaded

### Local host Prisma commands

When this command runs from the repository root:

```bash
npm --prefix apps/api run prisma:migrate:deploy
```

npm runs Prisma with `apps/api` as the working directory. Prisma loads `apps/api/.env`, and `apps/api/prisma/schema.prisma` reads `DATABASE_URL`.

For a host-side migration, use this format in `apps/api/.env`:

```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/fastaibooking?schema=public
```

An already-exported shell `DATABASE_URL` can override the file value. Check both if the resolved host is unexpected.

The API application has separate runtime loading in `apps/api/src/config/env.ts`: when launched through the monorepo, it prefers the root `.env` and falls back to `apps/api/.env`. This distinction matters because Prisma CLI loads its own `.env` before the API application code starts.

### Commands inside the API container

The `api` service reads the root `.env` through Compose `env_file`, then `docker-compose.yml` explicitly sets the container's `DATABASE_URL` with the Compose database hostname:

```env
DATABASE_URL=postgresql://<user>:<password>@postgres:5432/fastaibooking?schema=public
```

The explicit Compose `environment` value takes precedence over the `env_file` value. Do not use `localhost` for PostgreSQL from inside `api`.

### Production deployment

The production deploy scripts use the root `.env` in the server checkout, normally:

```text
/home/ubuntu/fastAibooking/.env
```

or the directory configured by `EC2_APP_DIR`. `infra/scripts/deploy_remote_ec2.sh` intentionally excludes `.env` during rsync, so the production file remains on the server and must be maintained there.

`infra/scripts/deploy_ec2.sh` starts `postgres` and runs Prisma in a one-off `api` container. `infra/scripts/run_migrations.sh` runs Prisma in the existing `api` container. In both cases, the database host is `postgres`.

## Quick Diagnosis

Run from the repository root:

```bash
docker compose ps
docker compose logs postgres --tail=100
cat apps/api/.env | grep DATABASE_URL
nc -zv localhost 5432
```

The `cat ... | grep ...` command can display credentials. Do not paste its output into chat, tickets, or logs. A safer masked check is:

```bash
grep '^DATABASE_URL=' apps/api/.env | sed -E 's#(postgres(ql)?://)[^@]+@#\1<user>:<password>@#'
```

Expected results:

- `postgres` is running and preferably healthy.
- PostgreSQL logs do not show startup or authentication failures.
- Host-side `DATABASE_URL` uses `localhost:5432`.
- `nc` reports that `localhost:5432` is reachable only when a host port mapping is configured.

## Local Host Migration Flow

When PostgreSQL is explicitly published as `5432:5432` or `127.0.0.1:5432:5432`, a host command can use `localhost:5432`.

```bash
docker compose up -d postgres
npm --prefix apps/api run prisma:migrate:deploy
```

Before migrating, ensure `apps/api/.env` contains a masked-equivalent URL like:

```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/fastaibooking?schema=public
```

If `nc -zv localhost 5432` fails, use the Docker container migration flow below instead of the host command.

## Docker Container Migration Flow

Inside Docker, use the Compose service hostname `postgres`, not `localhost`.

```env
DATABASE_URL=postgresql://<user>:<password>@postgres:5432/fastaibooking?schema=public
```

Start PostgreSQL, then run Prisma inside the API container:

```bash
docker compose up -d postgres api
docker compose exec api npm run prisma:migrate:deploy
```

If `api` is not running, use the deployment-style one-off container:

```bash
docker compose up -d postgres
docker compose run --rm --no-deps api npm run prisma:migrate:deploy
```

## Production Migration Flow

On the production server:

```bash
cd /home/ubuntu/fastAibooking
test -f .env
docker compose ps
docker compose logs postgres --tail=100
docker compose exec -T postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose exec -T api node -e 'const u=new URL(process.env.DATABASE_URL); console.log({host:u.hostname,port:u.port||"5432",database:u.pathname.slice(1)})'
docker compose exec -T api npm run prisma:migrate:deploy
```

If production uses a different `EC2_APP_DIR`, change the first command to that directory.

The URL inspection command prints only the host, port, and database name. It does not print the username or password. The expected host for the Compose deployment is `postgres`.

The repository helper performs the same migration against the running API container:

```bash
./infra/scripts/run_migrations.sh
```

Do not copy a local `DATABASE_URL` containing `localhost` into an API container or another production runtime. Verify connectivity before applying migrations, and never paste the production `.env` or an unmasked URL into logs or support messages.

## Kien: Docker Migration and Deploy

Run these commands from the FastAIBooking repository root:

```bash
# 1. Check containers
docker compose ps

# 2. Start database if needed
docker compose up -d postgres

# 3. Check database logs
docker compose logs postgres --tail=100

# 4. Run migration through the Docker network
docker compose run --rm api npm run prisma:migrate:deploy

# 5. Build and start production services
docker compose up -d --build api app admin nginx
```

If the API container is already running, migrate inside it:

```bash
docker compose exec api npm run prisma:migrate:deploy
```

If Docker reports that the daemon is unavailable, start Docker Desktop first.

## Push Notification Migrations

The notification migrations already exist:

- `apps/api/prisma/migrations/202606110001_firebase_push_notifications/migration.sql` creates `PushToken`.
- `apps/api/prisma/migrations/202606110002_user_notification_inbox/migration.sql` creates `UserNotification`.

Run `prisma:migrate:deploy` against the target database so both tables exist before testing push token registration or notification inbox behavior.

## Notification Token Endpoints

The backend mounts the notifications router at `/api/v1/notifications`. The registration endpoint is:

```http
POST /api/v1/notifications/register-token
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "token": "firebase_token_here",
  "platform": "android"
}
```

The canonical field is `token`. For minimal backward compatibility, `fcmToken` is mapped to `token` only when `token` is absent. Supported platform values are `android`, `ios`, and `web`, and platform case is normalized. `deviceId` is ignored and not stored.

To unregister:

```http
POST /api/v1/notifications/unregister-token
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "token": "firebase_token_here",
  "platform": "android"
}
```

There is no `/api/v1/devices/fcm-token` backend route in this repository.

## Troubleshooting

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `postgres` is absent or stopped in `docker compose ps` | DB container is not running | Run `docker compose up -d postgres`, then inspect `docker compose logs postgres --tail=100`. |
| Container migration reports `localhost:5432` | `DATABASE_URL` has the wrong host for the container context | Use `postgres:5432` inside the `api` container. Recreate the container after env changes. |
| Host migration cannot reach `localhost:5432` | Port `5432` is not published, Docker is stopped, or another port is configured | Confirm the Compose port mapping, start Docker/PostgreSQL, and run `nc -zv localhost 5432`. |
| The same command works in one shell but fails in another | The command is running from a different context or an exported `DATABASE_URL` overrides the file | Identify whether the command runs on the host or in `api`; inspect the masked effective host and remove or correct stale shell overrides. |
| Production API or migration tries `localhost` | Production `.env` or runtime environment accidentally contains a local URL | For Compose container execution, verify the effective host is `postgres`; do not expose or paste credentials. |
| Prisma reports pending migrations but also returns `P1001` | Prisma can read migration files but cannot connect to the database | Restore DB connectivity first. Then rerun `npm run prisma:migrate:deploy` in the correct context. |
