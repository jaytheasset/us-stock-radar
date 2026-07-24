-- Stock Radar keeps database access behind server-side API routes.
-- The browser-facing anon/authenticated roles must not access public tables,
-- sequences, or RPCs directly.

create schema if not exists private;

revoke all privileges on schema private
from public, anon, authenticated;

create or replace function private.enable_rls_for_new_public_tables()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  created_object record;
begin
  for created_object in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
      and schema_name = 'public'
  loop
    execute format(
      'alter table if exists %s enable row level security',
      created_object.object_identity
    );
  end loop;
end
$$;

revoke all privileges on function private.enable_rls_for_new_public_tables()
from public, anon, authenticated;

drop event trigger if exists stock_radar_enable_public_table_rls;

create event trigger stock_radar_enable_public_table_rls
on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
execute function private.enable_rls_for_new_public_tables();

do $$
declare
  target_table record;
begin
  for target_table in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table %I.%I enable row level security',
      target_table.schema_name,
      target_table.table_name
    );
  end loop;
end
$$;

revoke all privileges on all tables in schema public
from public, anon, authenticated;

revoke all privileges on all sequences in schema public
from public, anon, authenticated;

revoke execute on all functions in schema public
from public, anon, authenticated;

grant all privileges on all tables in schema public
to service_role;

grant all privileges on all sequences in schema public
to service_role;

grant execute on all functions in schema public
to service_role;

alter default privileges for role postgres in schema public
revoke all privileges on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
revoke all privileges on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
grant all privileges on tables to service_role;

alter default privileges for role postgres in schema public
grant all privileges on sequences to service_role;

alter default privileges for role postgres in schema public
grant execute on functions to service_role;

alter function public.acquire_alert_delivery_job_lock(text, integer, text)
set search_path = pg_catalog, public;

alter function public.release_alert_delivery_job_lock(text, text)
set search_path = pg_catalog, public;

alter function public.set_alert_delivery_event_runs_updated_at()
set search_path = pg_catalog, public;

alter function public.set_user_alert_updated_at()
set search_path = pg_catalog, public;
