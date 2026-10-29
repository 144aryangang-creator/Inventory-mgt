-- Internal snapshot construction must never be a client-callable trust bypass.
revoke all on function app_private.organization_billing_profile_snapshot(uuid, uuid) from public;
