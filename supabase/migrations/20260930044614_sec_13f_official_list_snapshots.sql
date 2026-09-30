-- SEC Official List of Section 13(f) Securities. This is a quarterly reference
-- list, not an issuer/class/ticker identity assertion.
create table public.sec_13f_official_list_snapshots (
  id bigint generated always as identity primary key,
  quarter text not null,
  quarter_end date not null,
  source_url text not null,
  source_sha256 text not null,
  source_bytes bytea not null,
  fetched_at timestamptz not null,
  parser_version text not null,
  row_count integer not null,
  created_at timestamptz not null default now(),
  constraint sec_13f_official_list_quarter_check check (quarter ~ '^[0-9]{4}Q[1-4]$'),
  constraint sec_13f_official_list_source_check check (
    source_url ~ '^https://www\.sec\.gov/files/investment/13flist[0-9]{4}q[1-4](-txt)?\.txt$'
    and source_sha256 ~ '^[0-9a-f]{64}$'
    and source_sha256 = encode(extensions.digest(source_bytes, 'sha256'), 'hex')
    and octet_length(source_bytes) > 0
    and parser_version = 'sec-13f-official-list-fixed-width-v1'
    and row_count > 0
  ),
  constraint sec_13f_official_list_snapshot_unique unique (quarter, source_sha256)
);

create table public.sec_13f_official_list_entries (
  snapshot_id bigint not null references public.sec_13f_official_list_snapshots(id) on delete restrict,
  line_number integer not null,
  cusip text not null,
  option_indicator text not null,
  issuer_name text not null,
  security_description text not null,
  status_raw text not null,
  status text not null,
  raw_line text not null,
  primary key (snapshot_id, line_number),
  constraint sec_13f_official_list_entry_line_check check (line_number > 0 and length(raw_line) = 80),
  constraint sec_13f_official_list_entry_cusip_check check (cusip ~ '^[A-Z0-9]{9}$'),
  constraint sec_13f_official_list_entry_option_check check (option_indicator in (' ', '*')),
  constraint sec_13f_official_list_entry_status_check check (
    (status_raw = '   ' and status = 'unchanged')
    or (status_raw = '*A*' and status = 'added')
    or (status_raw = '*D*' and status = 'deleted')
  ),
  constraint sec_13f_official_list_entry_fields_check check (
    cusip = substring(raw_line from 1 for 9)
    and option_indicator = substring(raw_line from 10 for 1)
    and issuer_name = btrim(substring(raw_line from 11 for 30))
    and security_description = btrim(substring(raw_line from 41 for 27))
    and status_raw = substring(raw_line from 68 for 3)
  )
);

create index sec_13f_official_list_entries_cusip_idx
  on public.sec_13f_official_list_entries (cusip, snapshot_id);

alter table public.sec_13f_official_list_snapshots enable row level security;
alter table public.sec_13f_official_list_entries enable row level security;
revoke all on public.sec_13f_official_list_snapshots, public.sec_13f_official_list_entries
  from public, anon, authenticated, service_role;
revoke all on sequence public.sec_13f_official_list_snapshots_id_seq
  from public, anon, authenticated, service_role;
grant select, insert on public.sec_13f_official_list_snapshots, public.sec_13f_official_list_entries
  to service_role;
grant usage on sequence public.sec_13f_official_list_snapshots_id_seq to service_role;

comment on table public.sec_13f_official_list_snapshots is
  'Immutable quarterly SEC 13(f) official list source versions; not a trusted CUSIP-to-ticker mapping.';
