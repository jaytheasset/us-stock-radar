-- New targets must be resolved by the authenticated server API. An owner-supplied
-- JSON proof sent directly to PostgREST must not bypass SEC identity verification.
-- Existing owner SELECT/UPDATE/DELETE policies remain; the target is immutable.
revoke insert on table public.financial_monitors from authenticated;
