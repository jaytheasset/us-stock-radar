-- The SEC-linked 2025 Q3 TXT duplicates Q1. Retain the official Q3 PDF as a
-- distinct, explicitly marked source without changing normal TXT ingestion.
alter table public.sec_13f_official_list_snapshots
  add column source_format text not null default 'txt';

alter table public.sec_13f_official_list_snapshots
  drop constraint sec_13f_official_list_source_check;
alter table public.sec_13f_official_list_snapshots
  add constraint sec_13f_official_list_source_check check (
    (
      source_format = 'txt'
      and source_url ~ '^https://www\.sec\.gov/files/investment/13flist[0-9]{4}q[1-4](-txt)?\.txt$'
      and parser_version = 'sec-13f-official-list-fixed-width-v1'
    ) or (
      source_format = 'pdf'
      and quarter = '2025Q3'
      and quarter_end = '2025-09-30'
      and source_url = 'https://www.sec.gov/files/investment/13flist2025q3.pdf'
      and parser_version = 'sec-13f-official-list-2025q3-pdf-v1'
    )
  );
alter table public.sec_13f_official_list_snapshots
  add constraint sec_13f_official_list_source_integrity_check check (
    source_sha256 ~ '^[0-9a-f]{64}$'
    and source_sha256 = encode(extensions.digest(source_bytes, 'sha256'), 'hex')
    and octet_length(source_bytes) > 0
    and row_count > 0
  );

alter table public.sec_13f_official_list_entries
  add column source_page integer;

alter table public.sec_13f_official_list_entries
  drop constraint sec_13f_official_list_entry_line_check;
alter table public.sec_13f_official_list_entries
  add constraint sec_13f_official_list_entry_line_check check (
    line_number > 0
    and ((source_page is null and length(raw_line) = 80)
      or (source_page >= 3 and length(raw_line) > 0))
  );

alter table public.sec_13f_official_list_entries
  drop constraint sec_13f_official_list_entry_status_check;
alter table public.sec_13f_official_list_entries
  add constraint sec_13f_official_list_entry_status_check check (
    (source_page is null and (
      (status_raw = '   ' and status = 'unchanged')
      or (status_raw = '*A*' and status = 'added')
      or (status_raw = '*D*' and status = 'deleted')
    )) or (source_page is not null and (
      (status_raw = '' and status = 'unchanged')
      or (status_raw = 'ADDED' and status = 'added')
      or (status_raw = 'DELETED' and status = 'deleted')
    ))
  );

alter table public.sec_13f_official_list_entries
  drop constraint sec_13f_official_list_entry_fields_check;
alter table public.sec_13f_official_list_entries
  add constraint sec_13f_official_list_entry_fields_check check (
    (source_page is null
      and cusip = substring(raw_line from 1 for 9)
      and option_indicator = substring(raw_line from 10 for 1)
      and issuer_name = btrim(substring(raw_line from 11 for 30))
      and security_description = btrim(substring(raw_line from 41 for 27))
      and status_raw = substring(raw_line from 68 for 3)
    ) or (source_page is not null
      and left(regexp_replace(raw_line, '\s+', '', 'g'), 9) = cusip
      and position(issuer_name in raw_line) > 0
      and position(security_description in raw_line) > 0
      and (status_raw = '' or position(status_raw in raw_line) > 0)
    )
  );
