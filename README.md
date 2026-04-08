# FastAIBooking

API-first monorepo for a multi-tenant salon booking SaaS.

## Repository Structure

```text
apps/
  api/    # Node.js + Express + Prisma backend API
  admin/  # Platform admin frontend (React + Vite)
  app/    # Shared salon owner + staff frontend (React + Vite)
infra/
  nginx/
  scripts/
docker-compose.yml
```

## Stack

- Backend: Node.js, Express, TypeScript
- Frontend: React, Vite, TypeScript
- Database: PostgreSQL
- ORM and migrations: Prisma
- Auth: JWT access/refresh tokens
- Validation: Zod
- Logging: Pino
- Infra: Docker Compose + Nginx

## API Coverage

- Auth
  - owner registration and onboarding
  - login, token refresh, logout
  - forgot/reset password
  - change password
  - current user profile
- Roles
  - `PLATFORM_ADMIN`
  - `SALON_OWNER`
  - `STAFF`
- Salon
  - profile read/update
  - settings read/update
- Staff
  - list/create/update
  - deactivate/reactivate
  - billing usage updates
- Billing usage
  - centralized free limit and extra staff calculation
  - current period and history endpoint
- Services
  - list/create/update
  - activate/deactivate
  - optional staff-service mapping
- Business hours
  - list/update weekly schedule
- Customers
  - create/search/detail
  - appointment history
- Appointments
  - create/update/detail/list
  - cancel/reschedule
  - AI source flow endpoint
  - status history tracking
- Scheduling and availability
  - business-hours-aware slot validation
  - overlap prevention
  - available slots API
- Platform admin
  - admin login
  - list salons
  - salon detail
  - owner detail
  - overview metrics
- Ops
  - `GET /health`
  - `GET /health/liveness`
  - `GET /health/ready`
  - `GET /health/readiness`
  - structured logging
  - centralized error format
  - audit log records for key actions

## Billing Rule

The billing usage logic is centralized in `apps/api/src/modules/billing/billing.service.ts`:

- first `FREE_STAFF_LIMIT` active staff are included
- extra active staff are billable
- `EXTRA_STAFF_PRICE` (USD) is configuration-driven
- API exposes:
  - free staff limit
  - active staff count
  - included staff count
  - billable extra staff count
  - extra staff unit price (cents)
  - estimated extra cost (cents)

## Key Environment Variables

Copy `.env.example` to `.env` and set production-safe values.
For EC2 production, use `.env.production.example` as the baseline.

Required groups:

- app:
  - `APP_NAME`, `NODE_ENV`, `PORT`, `API_BASE_URL`
  - `ADMIN_FRONTEND_URL`, `OWNER_FRONTEND_URL`
- database:
  - `DATABASE_URL` or `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_SSL`
- auth:
  - `JWT_SECRET`, `JWT_EXPIRES_IN`
  - `REFRESH_TOKEN_SECRET`, `REFRESH_TOKEN_EXPIRES_IN`
- email:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`
  - `RESET_PASSWORD_URL`, `VERIFY_EMAIL_URL`
- billing and domain:
  - `FREE_STAFF_LIMIT`, `EXTRA_STAFF_PRICE`
  - `DOMAIN_API`, `DOMAIN_ADMIN`, `DOMAIN_APP`, `SERVER_IP`

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Generate Prisma client:

```bash
npm --workspace @fastaibooking/api run prisma:generate
```

3. Start PostgreSQL, API, and Nginx using Docker Compose:

```bash
docker compose up -d --build
```

4. Run seed data:

```bash
docker compose exec -T api npm run prisma:seed
```

## Prisma Commands

```bash
npm --workspace @fastaibooking/api run prisma:migrate:deploy
npm --workspace @fastaibooking/api run prisma:seed
npm --workspace @fastaibooking/api run prisma:generate
```

## Deployment Scripts

```bash
./infra/scripts/deploy_ec2.sh
./infra/scripts/run_migrations.sh
./infra/scripts/run_seed.sh
./infra/scripts/backup_postgres.sh
./infra/scripts/enable_ssl.sh your-email@example.com
./infra/scripts/renew_ssl.sh
./infra/scripts/smoke_test_production.sh
```

## Demo Seed Accounts

- platform admin:
  - `admin@fastaibooking.local`
  - `Admin123!`
- salon owner:
  - `owner.demo@fastaibooking.local`
  - `Owner123!`

Seed includes one salon, 7 active staff (5 included + 2 extra), sample services, business hours, customers, and appointments.

## Domain and Nginx Mapping

`infra/nginx/default.conf` configures:

- `api-new-nail.kendemo.com` -> API container
- `admin-new-nail.kendemo.com` -> Admin frontend container
- `app-new-nail.kendemo.com` -> Shared owner/staff frontend container

## EC2 Deployment Notes

1. Provision Docker and Docker Compose on EC2 (`32.194.150.135`).
2. Configure DNS A records:
   - `api-new-nail.kendemo.com` -> `32.194.150.135`
   - `admin-new-nail.kendemo.com` -> `32.194.150.135`
   - `app-new-nail.kendemo.com` -> `32.194.150.135`
3. Copy `.env.example` to `.env` and set production secrets.
4. Deploy:

```bash
./infra/scripts/deploy_ec2.sh
```

Remote deploy from this workspace uses the root SSH key without overwriting the EC2 `.env` file:

```bash
EC2_USER=ubuntu ./infra/scripts/deploy_remote_ec2.sh
```

5. Verify:
   - `http://api-new-nail.kendemo.com/health/liveness`
   - `http://api-new-nail.kendemo.com/health/readiness`

## Frontend Integration Later

- Admin frontend should use `https://admin-new-nail.kendemo.com` and call admin APIs under `/api/v1/admin/*`.
- Salon owner frontend should use `https://app-new-nail.kendemo.com` and call owner APIs under `/api/v1/*`.
- API authorization and tenant isolation are already enforced in backend middleware and service-layer queries.
