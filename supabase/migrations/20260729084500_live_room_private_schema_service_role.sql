begin;

-- Service-only membership RPCs call helpers in the private schema. PostgreSQL
-- requires schema USAGE in addition to each helper's explicit EXECUTE grant.
grant usage on schema private to service_role;

commit;
