-- Security hardening for hosted Supabase role defaults.
--
-- Supabase can grant EXECUTE on functions in exposed schemas directly to the `anon` role.
-- Earlier migrations revoked EXECUTE from PostgreSQL's pseudo-role `public`, but a direct
-- `anon=X` ACL remains effective. No application RPC is intended to be callable without
-- an authenticated JWT, so remove anonymous execution across the exposed public schema.
--
-- Authenticated grants are intentionally preserved. Internal/legacy RPCs that were already
-- revoked from `authenticated` remain unavailable to signed-in clients as well.

revoke execute on all functions in schema public from anon;

-- Keep future functions created by the migration owner from inheriting anonymous EXECUTE.
-- Explicit authenticated grants in versioned migrations remain the application API contract.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
