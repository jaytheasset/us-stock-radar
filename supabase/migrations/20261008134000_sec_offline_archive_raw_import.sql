-- Verified offline SEC source acquisition only.
-- Inserts canonical raw_items through the existing SEC raw contract; it does not
-- create cover observations, ticker candidates, human judgments, or ticker writes.
create or replace function public.import_sec_offline_archive_raw(
  p_run_id uuid,
  p_manifest_sha256 text,
  p_bundle_sha256 text,
  p_started_at timestamptz,
  p_items jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_raw jsonb;
  v_payload jsonb;
  v_metadata jsonb;
  v_existing public.raw_items%rowtype;
  v_existing_run public.source_runs%rowtype;
  v_existing_accepted_at timestamptz;
  v_accession text;
  v_raw_id uuid;
  v_source_sha256 text;
  v_source_byte_count integer;
  v_source_html text;
  v_source_group text;
  v_results jsonb := '[]'::jsonb;
  v_inserted_count integer := 0;
  v_replayed_count integer := 0;
  v_total_source_byte_count bigint := 0;
  v_item_count integer;
  v_run_exists boolean := false;
  v_status text;
begin
  if p_run_id is null
     or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
     or p_bundle_sha256 !~ '^[0-9a-f]{64}$'
     or p_started_at is null
     or not pg_catalog.isfinite(p_started_at)
     or pg_catalog.jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
  end if;

  v_item_count := pg_catalog.jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 100 then
    raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
  end if;

  if (
    select pg_catalog.count(*) <> pg_catalog.count(distinct item #>> '{rawItem,source_unique_id}')
    from pg_catalog.jsonb_array_elements(p_items) as rows(item)
  ) then
    raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
  end if;

  -- Fixed accession lock order prevents two equivalent batches from interleaving.
  for v_accession in
    select item #>> '{rawItem,source_unique_id}'
    from pg_catalog.jsonb_array_elements(p_items) as rows(item)
    order by item #>> '{rawItem,source_unique_id}' collate "C"
  loop
    if v_accession is null or v_accession !~ '^\d{10}-\d{2}-\d{6}$' then
      raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('sec-offline-archive-raw:' || v_accession, 0)
    );
  end loop;

  -- Validate and classify the complete batch before any insert.
  for v_item in
    select item
    from pg_catalog.jsonb_array_elements(p_items) as rows(item)
    order by item #>> '{rawItem,source_unique_id}' collate "C"
  loop
    v_raw := v_item -> 'rawItem';
    v_payload := v_raw -> 'raw_payload';
    v_metadata := v_raw -> 'metadata';
    v_accession := v_raw ->> 'source_unique_id';
    v_source_sha256 := v_item ->> 'sourceSha256';

    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_raw) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_payload) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_metadata) is distinct from 'object'
       or v_raw ->> 'id' is null
       or (v_raw ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_accession is null
       or v_accession !~ '^\d{10}-\d{2}-\d{6}$'
       or v_source_sha256 is null
       or v_source_sha256 !~ '^[0-9a-f]{64}$'
       or v_item ->> 'sourceUtf8ByteCount' is null
       or (v_item ->> 'sourceUtf8ByteCount') !~ '^[1-9][0-9]{0,7}$' then
      raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
    end if;

    v_raw_id := (v_raw ->> 'id')::uuid;
    v_source_byte_count := (v_item ->> 'sourceUtf8ByteCount')::integer;
    v_total_source_byte_count := v_total_source_byte_count + v_source_byte_count;
    if v_total_source_byte_count > 20000000 then
      raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
    end if;
    v_source_html := v_payload ->> 'primary_document_html';
    v_source_group := v_raw ->> 'source_group';

    if v_raw ->> 'source_code' is distinct from 'sec_edgar'
       or v_source_group is distinct from 'filings'
       or v_raw ->> 'dedupe_key' is distinct from 'sec_edgar:' || v_accession
       or v_raw ->> 'title' is null
       or pg_catalog.btrim(v_raw ->> 'title') = ''
       or pg_catalog.char_length(v_raw ->> 'title') > 2000
       or v_raw ->> 'body_text' is null
       or pg_catalog.btrim(v_raw ->> 'body_text') = ''
       or v_raw ->> 'analysis_text' is distinct from v_raw ->> 'body_text'
       or pg_catalog.octet_length(v_raw ->> 'body_text') > 2000000
       or v_raw ->> 'published_at' is null
       or (v_raw ->> 'published_at') !~ '^\d{4}-\d{2}-\d{2}T'
       or v_raw ->> 'fetched_at' is null
       or (v_raw ->> 'fetched_at') !~ '^\d{4}-\d{2}-\d{2}T'
       or v_raw ->> 'source_url' is null
       or (v_raw ->> 'source_url') !~ '^https://www\.sec\.gov/Archives/edgar/data/[0-9]+/[0-9]{18}/[0-9]{10}-[0-9]{2}-[0-9]{6}-index\.html$'
       or pg_catalog.strpos(v_raw ->> 'source_url', pg_catalog.replace(v_accession, '-', '')) = 0 then
      raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
    end if;

    if coalesce(v_payload ->> 'form_type', '') not in ('8-K', '8-K/A') then
      raise exception using errcode = '22023', message = 'filing_form_unsupported_for_offline_import_v1';
    end if;

    if v_payload ->> 'accession_number' is distinct from v_accession
       or v_payload ->> 'accession_no_dashes' is distinct from pg_catalog.replace(v_accession, '-', '')
       or v_payload ->> 'cik' is null
       or (v_payload ->> 'cik') !~ '^\d{10}$'
       or v_payload ->> 'cik_padded' is distinct from v_payload ->> 'cik'
       or v_payload ->> 'form_type' is null
       or pg_catalog.btrim(v_payload ->> 'form_type') = ''
       or v_payload ->> 'filing_date' is null
       or (v_payload ->> 'filing_date') !~ '^\d{4}-\d{2}-\d{2}$'
       or v_payload ->> 'accepted_at' is null
       or (v_payload ->> 'accepted_at') !~ '^\d{4}-\d{2}-\d{2}T'
       or v_payload ->> 'primary_document_url' is null
       or v_payload ->> 'primary_document_url' !~ '^https://www\.sec\.gov/Archives/edgar/data/[0-9]+/[0-9]{18}/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'
       or pg_catalog.strpos(v_payload ->> 'primary_document_url', pg_catalog.replace(v_accession, '-', '')) = 0
       or v_payload ->> 'primary_document_html_truncated' is distinct from 'false'
       or v_payload ->> 'primary_document_sha256' is distinct from v_source_sha256
       or v_payload ->> 'primary_document_html_utf8_byte_count' is distinct from v_source_byte_count::text
       or v_source_html is null
       or pg_catalog.char_length(v_source_html) < 1
       or pg_catalog.char_length(v_source_html) > 2000000
       or pg_catalog.octet_length(pg_catalog.convert_to(v_source_html, 'UTF8')) is distinct from v_source_byte_count
       or pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_source_html, 'UTF8'), 'sha256'), 'hex') is distinct from v_source_sha256 then
      raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
    end if;

    if v_payload #>> '{offline_archive_import,version}' is distinct from 'sec-offline-archive-import-v1'
       or v_payload #>> '{offline_archive_import,acquisitionMethod}' is distinct from 'offline_archive'
       or v_payload #>> '{offline_archive_import,manifestSha256}' is distinct from p_manifest_sha256
       or v_payload #>> '{offline_archive_import,bundleSha256}' is distinct from p_bundle_sha256
       or v_payload #>> '{offline_archive_import,sourceSha256}' is distinct from v_source_sha256
       or v_payload #>> '{offline_archive_import,sourceUtf8ByteCount}' is distinct from v_source_byte_count::text
       or v_payload #>> '{offline_archive_import,capturedAt}' is null
       or v_payload #>> '{offline_archive_import,capturedAt}' !~ '^\d{4}-\d{2}-\d{2}T'
       or v_metadata #>> '{offline_archive_import,version}' is distinct from 'sec-offline-archive-import-v1'
       or v_metadata #>> '{offline_archive_import,acquisitionMethod}' is distinct from 'offline_archive'
       or v_metadata #>> '{offline_archive_import,manifestSha256}' is distinct from p_manifest_sha256
       or v_metadata #>> '{offline_archive_import,bundleSha256}' is distinct from p_bundle_sha256
       or v_metadata #>> '{offline_archive_import,sourceSha256}' is distinct from v_source_sha256
       or v_metadata #>> '{offline_archive_import,sourceUtf8ByteCount}' is distinct from v_source_byte_count::text
       or v_metadata #>> '{offline_archive_import,capturedAt}' is distinct from v_payload #>> '{offline_archive_import,capturedAt}' then
      raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
    end if;

    begin
      if not pg_catalog.isfinite((v_raw ->> 'published_at')::timestamptz)
         or not pg_catalog.isfinite((v_raw ->> 'fetched_at')::timestamptz)
         or not pg_catalog.isfinite((v_payload ->> 'accepted_at')::timestamptz)
         or not pg_catalog.isfinite((v_payload #>> '{offline_archive_import,capturedAt}')::timestamptz)
         or (v_raw ->> 'published_at')::timestamptz
            is distinct from (v_payload ->> 'accepted_at')::timestamptz
         or (v_raw ->> 'fetched_at')::timestamptz
            is distinct from (v_payload #>> '{offline_archive_import,capturedAt}')::timestamptz then
        raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
      end if;
      perform (v_payload ->> 'filing_date')::date;
    exception when others then
      raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_INPUT_INVALID';
    end;

    select * into v_existing
    from public.raw_items
    where source_code = 'sec_edgar' and source_unique_id = v_accession;

    if found then
      begin
        v_existing_accepted_at := (v_existing.raw_payload ->> 'accepted_at')::timestamptz;
        if not pg_catalog.isfinite(v_existing_accepted_at) then
          raise exception using errcode = '22023', message = 'SEC_OFFLINE_ARCHIVE_RAW_CONFLICT';
        end if;
      exception when others then
        raise exception using errcode = '23505', message = 'SEC_OFFLINE_ARCHIVE_RAW_CONFLICT:' || v_accession;
      end;

      if v_existing.source_group::text is distinct from 'filings'
         or v_existing.source_url is distinct from v_raw ->> 'source_url'
         or v_existing.dedupe_key is distinct from v_raw ->> 'dedupe_key'
         or v_existing.raw_payload ->> 'accession_number' is distinct from v_accession
         or pg_catalog.lpad(v_existing.raw_payload ->> 'cik', 10, '0') is distinct from v_payload ->> 'cik'
         or pg_catalog.upper(pg_catalog.regexp_replace(v_existing.raw_payload ->> 'form_type', '\s+', ' ', 'g'))
            is distinct from pg_catalog.upper(pg_catalog.regexp_replace(v_payload ->> 'form_type', '\s+', ' ', 'g'))
         or v_existing.raw_payload ->> 'filing_date' is distinct from v_payload ->> 'filing_date'
         or v_existing_accepted_at is distinct from (v_payload ->> 'accepted_at')::timestamptz
         or v_existing.raw_payload ->> 'primary_document_url' is distinct from v_payload ->> 'primary_document_url'
         or v_existing.raw_payload ->> 'primary_document_html_truncated' is distinct from 'false'
         or v_existing.raw_payload ->> 'primary_document_html' is null
         or pg_catalog.octet_length(pg_catalog.convert_to(v_existing.raw_payload ->> 'primary_document_html', 'UTF8')) is distinct from v_source_byte_count
         or pg_catalog.encode(
              extensions.digest(
                pg_catalog.convert_to(v_existing.raw_payload ->> 'primary_document_html', 'UTF8'),
                'sha256'
              ),
              'hex'
            ) is distinct from v_source_sha256 then
        raise exception using errcode = '23505', message = 'SEC_OFFLINE_ARCHIVE_RAW_CONFLICT:' || v_accession;
      end if;
      v_replayed_count := v_replayed_count + 1;
      v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'accession_number', v_accession,
        'raw_item_id', v_existing.id,
        'status', 'replayed'
      ));
    else
      if exists(select 1 from public.raw_items where id = v_raw_id) then
        raise exception using errcode = '23505', message = 'SEC_OFFLINE_ARCHIVE_RAW_CONFLICT:' || v_accession;
      end if;
      v_inserted_count := v_inserted_count + 1;
      v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'accession_number', v_accession,
        'raw_item_id', v_raw_id,
        'status', 'inserted'
      ));
    end if;
  end loop;

  select * into v_existing_run from public.source_runs where id = p_run_id;
  v_run_exists := found;
  if v_run_exists then
    if v_existing_run.source_code is distinct from 'sec_edgar'
       or v_existing_run.source_group::text is distinct from 'filings'
       or v_existing_run.run_type is distinct from 'offline_archive_import'
       or v_existing_run.status::text is distinct from 'completed'
       or v_existing_run.metadata ->> 'manifest_sha256' is distinct from p_manifest_sha256
       or v_existing_run.metadata ->> 'bundle_sha256' is distinct from p_bundle_sha256
       or v_inserted_count <> 0 then
      raise exception using errcode = '23505', message = 'SEC_OFFLINE_ARCHIVE_RUN_CONFLICT';
    end if;
  end if;

  if exists(select 1 from public.sources where code = 'sec_edgar' and source_group::text <> 'filings') then
    raise exception using errcode = '23505', message = 'SEC_OFFLINE_ARCHIVE_RUN_CONFLICT';
  end if;
  insert into public.sources(code,name,source_group,runtime_owner,enabled,metadata)
  values(
    'sec_edgar','SEC EDGAR','filings','external',true,
    pg_catalog.jsonb_build_object(
      'source_url','https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom',
      'parser','sec_edgar_raw_parser_v1'
    )
  )
  on conflict (code) do nothing;

  if not v_run_exists then
    insert into public.source_runs(
      id,source_code,source_group,run_type,status,started_at,finished_at,stats,metadata
    ) values (
      p_run_id,'sec_edgar','filings','offline_archive_import','completed',p_started_at,p_started_at,
      pg_catalog.jsonb_build_object(
        'requested_count',v_item_count,
        'inserted_count',v_inserted_count,
        'replayed_count',v_replayed_count,
        'failed_count',0,
        'network_requests',0,
        'downstream_triggered',false
      ),
      pg_catalog.jsonb_build_object(
        'version','sec-offline-archive-import-v1',
        'manifest_sha256',p_manifest_sha256,
        'bundle_sha256',p_bundle_sha256,
        'network_requests',0,
        'downstream_triggered',false
      )
    );
  end if;

  -- The accession locks remain held, so a second existence check is stable.
  for v_item in
    select item
    from pg_catalog.jsonb_array_elements(p_items) as rows(item)
    order by item #>> '{rawItem,source_unique_id}' collate "C"
  loop
    v_raw := v_item -> 'rawItem';
    v_accession := v_raw ->> 'source_unique_id';
    if not exists(
      select 1 from public.raw_items
      where source_code = 'sec_edgar' and source_unique_id = v_accession
    ) then
      insert into public.raw_items(
        id,run_id,source_code,source_group,source_unique_id,source_url,title,
        published_at,fetched_at,body_text,analysis_text,raw_payload,metadata,dedupe_key
      ) values (
        (v_raw ->> 'id')::uuid,
        p_run_id,
        v_raw ->> 'source_code',
        (v_raw ->> 'source_group')::public.source_group,
        v_accession,
        v_raw ->> 'source_url',
        v_raw ->> 'title',
        (v_raw ->> 'published_at')::timestamptz,
        (v_raw ->> 'fetched_at')::timestamptz,
        v_raw ->> 'body_text',
        v_raw ->> 'analysis_text',
        v_raw -> 'raw_payload',
        v_raw -> 'metadata',
        v_raw ->> 'dedupe_key'
      );
    end if;
  end loop;

  v_status := case
    when v_inserted_count = 0 then 'replayed'
    when v_replayed_count = 0 then 'inserted'
    else 'mixed'
  end;

  return pg_catalog.jsonb_build_object(
    'status',v_status,
    'run_id',p_run_id,
    'manifest_sha256',p_manifest_sha256,
    'bundle_sha256',p_bundle_sha256,
    'inserted_count',v_inserted_count,
    'replayed_count',v_replayed_count,
    'items',v_results
  );
end;
$function$;

revoke all on function public.import_sec_offline_archive_raw(uuid,text,text,timestamptz,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.import_sec_offline_archive_raw(uuid,text,text,timestamptz,jsonb)
  to service_role;

comment on function public.import_sec_offline_archive_raw(uuid,text,text,timestamptz,jsonb) is
  'Atomically imports SHA-verified offline SEC originals into existing raw_items. Exact accession/source replay is a no-op; conflicts abort the full batch. No downstream derivation is triggered.';
