-- Explicit successful main-Submissions refreshes only. No raw backfill.
create sequence public.sec_submissions_refresh_sequence as bigint
  start with 1 increment by 1 minvalue 1 no cycle cache 1;

create table public.sec_submissions_current (
  issuer_cik text primary key references public.sec_issuers(cik),
  source_raw_id uuid not null,
  source_kind text not null default 'submissions' check (source_kind = 'submissions'),
  refresh_sequence bigint not null check (refresh_sequence > 0),
  confirmed_at timestamptz not null check (isfinite(confirmed_at)),
  foreign key (source_raw_id, issuer_cik, source_kind)
    references public.sec_structured_raw_sources(id, cik, source_kind)
);

alter table public.sec_submissions_current enable row level security;
revoke all on table public.sec_submissions_current from public, anon, authenticated, service_role;
revoke all on sequence public.sec_submissions_refresh_sequence from public, anon, authenticated, service_role;
grant select, insert, update on table public.sec_submissions_current to service_role;
grant usage on sequence public.sec_submissions_refresh_sequence to service_role;

comment on table public.sec_submissions_current is
  'Last adopted successful explicit main Submissions refresh; not latest raw, canonical listing, or all-collector freshness.';
comment on column public.sec_submissions_current.refresh_sequence is
  'Server-allocated refresh order before HTTP, not an SEC document version.';
comment on column public.sec_submissions_current.confirmed_at is
  'Successful response acquisition/validation time, separate from immutable raw first fetched_at.';
