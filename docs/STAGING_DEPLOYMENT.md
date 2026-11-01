# Staging Deployment Runbook

## Decision

Staging uses **Option B**:

- custom staging domain, for example `staging.example.com`
- separate Cloudflare Worker named `inventory-mgt-staging`
- separate Supabase staging project/database
- no production credentials or customer data
- same-origin React SPA + `/v1/*` API on the staging hostname
- `workers.dev` is disabled for the staging Worker

This keeps staging close to the eventual production topology while preserving strict environment isolation.

## Why one staging origin

The staging Worker serves both:

- the built React/Vite SPA as Cloudflare static assets
- Hono API routes under `/v1/*` and `/health`

Benefits:

- no cross-origin API dependency in staging
- simpler cookie/CORS/auth behavior
- production-like routing and TLS
- one hostname for Playwright and OWASP ZAP
- fewer DNS and deployment moving parts

Cloudflare SPA fallback is configured with `not_found_handling: single-page-application`; `/v1/*` and `/health` explicitly run the Worker first.

## Files

- `apps/api/wrangler.staging.jsonc` — isolated staging Worker + SPA asset routing
- `.github/workflows/staging-deploy.yml` — guarded manual staging deploy
- `apps/api/wrangler.jsonc` — local/default Worker configuration; do not repurpose it for staging

## Required external setup

### 1. Domain

Own a domain whose DNS is managed by the intended Cloudflare account.

Choose a staging hostname, for example:

`staging.example.com`

Do not include `https://` in the GitHub variable.

### 2. Supabase staging project

Create a **new Supabase project dedicated to staging**.

Do not reuse a production project or production database.

The deployment pipeline applies the repository's versioned SQL migrations to this database. Avoid ad-hoc schema changes in the hosted dashboard once migration-based deployment starts.

### 3. GitHub environment

Create a GitHub Actions environment named:

`staging`

Recommended protection:

- require manual approval before deployment if the repository plan supports it
- restrict secrets to this environment
- do not duplicate production secrets into staging

Configure these **environment variables**:

- `STAGING_DOMAIN` — hostname only, e.g. `staging.example.com`
- `STAGING_SUPABASE_URL` — e.g. `https://PROJECT_REF.supabase.co`

Configure these **environment secrets**:

- `STAGING_SUPABASE_DB_URL` — percent-encoded direct database connection string used by Supabase CLI migrations
- `STAGING_SUPABASE_PUBLISHABLE_KEY` — staging project's publishable/browser key
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account containing the zone
- `CLOUDFLARE_API_TOKEN` — least-privilege token that can deploy the Worker and manage the chosen Worker custom domain

The application does **not** require a Supabase service-role key for normal business traffic.

## Deployment behavior

The `Deploy Staging` workflow is manual-only.

To run it:

1. Open GitHub Actions.
2. Select **Deploy Staging**.
3. Select **Run workflow** on `foundation/bootstrap`.
4. Enter exactly `DEPLOY-STAGING` in the confirmation field.
5. Approve the `staging` environment if environment protection is enabled.

The workflow then:

1. validates required configuration
2. installs locked dependencies
3. runs TypeScript checks
4. runs unit/contract tests
5. builds the React app with staging Supabase values
6. dry-runs the staging Worker bundle
7. dry-runs pending Supabase migrations
8. applies versioned migrations to the staging database
9. verifies migration history
10. deploys the Worker + SPA to the custom staging domain
11. checks `/health`
12. checks SPA routing at `/login`
13. verifies unauthenticated `/v1/me` returns `401`
14. verifies critical API security headers

## Secret handling

- `STAGING_SUPABASE_PUBLISHABLE_KEY` is browser-safe by design but remains environment-scoped for clean separation.
- Database credentials and Cloudflare credentials are GitHub environment secrets.
- The pipeline creates a temporary Worker secrets file with restrictive permissions and deletes it after deployment.
- No staging or production credentials should be committed to Git.

## Supabase Auth configuration after first deploy

In the staging Supabase project's Auth URL configuration, set the staging site/redirect URLs to the final HTTPS staging hostname as required by the application's auth flow.

Do not add production domains to the staging project's redirect allow-list unless there is a specific tested reason.

## Acceptance gate after deployment

A successful deployment is **not** enough for production readiness.

Before production planning, complete:

1. real hosted Playwright critical-path E2E against the staging URL
2. OWASP ZAP baseline/HTTP security scan against staging
3. database backup and restore drill
4. monitoring/error-tracking/alerting setup
5. privileged-account MFA policy review
6. staging acceptance review

Only after those gates should production domain/TLS and pilot rollout be planned.

## Safety rules

- never point staging at a production Supabase database
- never copy real customer data into staging by default
- never merge `foundation/bootstrap` into `main` without explicit user authorization
- never bypass migrations for hosted schema changes
- never expose database passwords or service-role credentials to Vite/browser variables
- keep `workers.dev` disabled for this staging Worker unless the architecture decision is explicitly changed later
