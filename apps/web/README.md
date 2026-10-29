# Web application

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set the Supabase project URL and browser-safe publishable key.
3. Set `VITE_API_BASE_URL` to the local API Worker, normally `http://localhost:8787`.
4. From the repository root run `npm ci`.
5. Run `npm run dev --workspace @inventory/web`.

## Security rules

- `VITE_*` values are visible to the browser. Never place private/service-role credentials in them.
- The browser session is for identity and UI state; PostgreSQL RLS remains the authorization boundary.
- API calls send the current Supabase access token as a bearer token.
- Do not implement client-side tenant filtering as a substitute for RLS.
- Do not store business secrets or privileged API keys in local storage.

## Current routes

- `/login` — email/password sign-in
- `/` — organization-aware dashboard shell
- `/inventory` — placeholder
- `/invoices` — placeholder
- `/settings` — placeholder

## Next web work

- organization selection/context
- owner onboarding / organization creation
- product and warehouse screens
- accessible form primitives
- error boundary + route-level failure UI
- Playwright E2E tests
- Cloudflare Static Assets deployment configuration
