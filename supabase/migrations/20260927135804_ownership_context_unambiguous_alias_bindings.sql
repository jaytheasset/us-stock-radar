-- Fail closed on ambiguous reporting-owner aliases and keep the database-side
-- beneficial-ownership recognizer aligned with the canonical TypeScript
-- validator.  These helpers validate source structure only; they do not infer
-- whether a stated legal relationship is substantively correct.

create or replace function public.ownership_context_owner_alias_candidates(
  p_xml text,
  p_owner_name text
)
returns text[]
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_owner text := public.ownership_context_normalize_words(p_owner_name);
  v_xml text := public.ownership_context_normalize_words(p_xml);
  v_owner_tokens text[];
  v_token_count integer;
  v_alias_match text[];
  v_alias text;
  v_aliases text[];
  v_reversed text;
  v_family text;
  v_title_match text[];
begin
  if pg_catalog.length(v_owner) = 0 then return '{}'::text[]; end if;
  v_aliases := array[v_owner];

  v_owner_tokens := pg_catalog.regexp_split_to_array(v_owner, '[[:space:]]+');
  v_token_count := coalesce(pg_catalog.array_length(v_owner_tokens, 1), 0);
  if v_token_count between 2 and 4
    and v_owner_tokens[v_token_count] not in (
      'co', 'corp', 'corporation', 'fund', 'holdings', 'inc', 'llc', 'lp',
      'ltd', 'partners', 'plc', 'trust'
    )
  then
    v_reversed := pg_catalog.array_to_string(
      v_owner_tokens[2:v_token_count] || v_owner_tokens[1],
      ' '
    );
    if v_xml ~ (
        '(^|[[:space:]])' || pg_catalog.replace(v_reversed, ' ', '[[:space:]]+')
        || '([[:space:]]|$)'
      )
      and not (v_reversed = any(v_aliases))
    then
      v_aliases := pg_catalog.array_append(v_aliases, v_reversed);
    end if;

    foreach v_family in array array[v_owner_tokens[1], v_owner_tokens[v_token_count]]
    loop
      for v_title_match in
        select match.value
        from pg_catalog.regexp_matches(
          p_xml,
          '(^|[^[:alnum:]])(Mr|Ms|Mrs|Dr)[.]?[[:space:]]+' || v_family || '([^[:alnum:]]|$)',
          'gi'
        ) as match(value)
      loop
        v_alias := public.ownership_context_normalize_words(v_title_match[2] || ' ' || v_family);
        if pg_catalog.length(v_alias) > 0 and not (v_alias = any(v_aliases)) then
          v_aliases := pg_catalog.array_append(v_aliases, v_alias);
        end if;
      end loop;
    end loop;
  end if;

  for v_alias_match in
    select match.value
    from pg_catalog.regexp_matches(p_xml, '(?:&quot;|")([^"<&]{1,80})(?:&quot;|")', 'gi') as match(value)
  loop
    v_alias := public.ownership_context_normalize_words(v_alias_match[1]);
    if pg_catalog.length(v_alias) > 0
      and pg_catalog.strpos(v_xml, v_owner || ' quot ' || v_alias || ' quot') > 0
      and not (v_alias = any(v_aliases))
    then
      v_aliases := pg_catalog.array_append(v_aliases, v_alias);
    end if;
  end loop;
  return v_aliases;
end;
$function$;

create or replace function public.ownership_context_owner_aliases(p_xml text, p_owner_name text)
returns text[]
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_alias text;
  v_aliases text[] := '{}'::text[];
  v_candidate_aliases text[] := public.ownership_context_owner_alias_candidates(p_xml, p_owner_name);
  v_claim_count integer;
  v_document xml;
  v_node xml;
  v_owner text;
  v_owner_key text;
  v_requested_owner_key text := public.ownership_context_normalize_words(p_owner_name);
  v_seen_owner_keys text[] := '{}'::text[];
begin
  v_document := xmlparse(document pg_catalog.regexp_replace(
    p_xml,
    '^[[:space:]]*<\?xml[^>]*\?>',
    '',
    'i'
  ));

  foreach v_alias in array v_candidate_aliases
  loop
    v_claim_count := 0;
    v_seen_owner_keys := '{}'::text[];
    foreach v_node in array xpath('//*[local-name()="rptOwnerName"]', v_document)
    loop
      v_owner := public.ownership_context_normalize_words(
        pg_catalog.regexp_replace(v_node::text, '<[^>]+>', ' ', 'g')
      );
      v_owner_key := public.ownership_context_normalize_words(v_owner);
      if pg_catalog.length(v_owner_key) = 0 or v_owner_key = any(v_seen_owner_keys) then
        continue;
      end if;
      v_seen_owner_keys := pg_catalog.array_append(v_seen_owner_keys, v_owner_key);
      if v_alias = any(public.ownership_context_owner_alias_candidates(p_xml, v_owner)) then
        v_claim_count := v_claim_count + 1;
      end if;
    end loop;

    -- Keep exact-name helper calls deterministic even when the requested name
    -- is not itself one of the filing's reporting owners.
    if not (v_requested_owner_key = any(v_seen_owner_keys))
      and v_alias = any(public.ownership_context_owner_alias_candidates(p_xml, p_owner_name))
    then
      v_claim_count := v_claim_count + 1;
    end if;

    if v_claim_count = 1 and not (v_alias = any(v_aliases)) then
      v_aliases := pg_catalog.array_append(v_aliases, v_alias);
    end if;
  end loop;
  return v_aliases;
exception when others then
  return '{}'::text[];
end;
$function$;

create or replace function public.ownership_context_owner_relation_supported(
  p_xml text,
  p_footnote_id text,
  p_owner_name text,
  p_relation text
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_text text := public.ownership_context_xml_footnote_text(p_xml, p_footnote_id);
  v_clause_source text;
  v_clause_part record;
  v_clause text;
  v_alias text;
  v_alias_pattern text;
  v_raw_alias_pattern text;
  v_relation text;
  v_opposite text;
  v_marker text := 'may be deemed to beneficially own';
  v_marker_at integer;
  v_raw_before text;
  v_before text;
  v_after text;
  v_group_match text[];
begin
  if v_text is null or p_relation not in ('direct', 'indirect') then return false; end if;
  v_relation := p_relation || 'ly';
  v_opposite := case p_relation when 'direct' then 'indirectly' else 'directly' end;
  v_clause_source := pg_catalog.regexp_replace(
    v_text,
    '(^|[[:space:]])(Mr|Ms|Mrs|Dr)[.][[:space:]]+',
    '\1\2 ',
    'gi'
  );

  foreach v_alias in array public.ownership_context_owner_aliases(p_xml, p_owner_name)
  loop
    v_alias_pattern := pg_catalog.replace(v_alias, ' ', '[[:space:]]+');
    v_raw_alias_pattern := pg_catalog.replace(v_alias, ' ', '[[:space:].,''-]+');
    for v_clause_part in
      select part.value as raw_clause,
        public.ownership_context_normalize_words(part.value) as normalized_clause
      from pg_catalog.regexp_split_to_table(v_clause_source, '[.;]') as part(value)
    loop
      v_clause := v_clause_part.normalized_clause;
      if pg_catalog.lower(v_clause_part.raw_clause) ~ (
          '(^|[[:space:]])(held[[:space:]]+|owned[[:space:]]+)?'
          || v_relation || '[[:space:]]+by[[:space:]]+' || v_raw_alias_pattern
          || '($|[.,;()]+|[[:space:]]+[(]|[[:space:]]+(a|an|as|the|which|who)([[:space:]]|$))'
        )
        and pg_catalog.lower(v_clause_part.raw_clause) !~ (
          '(^|[[:space:]])(held[[:space:]]+|owned[[:space:]]+)?'
          || v_opposite || '[[:space:]]+by[[:space:]]+' || v_raw_alias_pattern
          || '($|[.,;()]+|[[:space:]]+[(]|[[:space:]]+(a|an|as|the|which|who)([[:space:]]|$))'
        )
        and v_clause !~ '(^|[[:space:]])(not|never|no|without|may|might|could|possibly|apparently|purportedly)([[:space:]]|$)'
      then return true; end if;

      if p_relation = 'indirect' then
        v_marker_at := pg_catalog.strpos(pg_catalog.lower(v_clause_part.raw_clause), v_marker);
        if v_marker_at > 0 then
          v_raw_before := pg_catalog.lower(pg_catalog.btrim(
            pg_catalog.substr(v_clause_part.raw_clause, 1, v_marker_at - 1)
          ));
          v_before := public.ownership_context_normalize_words(v_raw_before);
          v_after := public.ownership_context_normalize_words(
            pg_catalog.substr(v_clause_part.raw_clause, v_marker_at + pg_catalog.length(v_marker))
          );
          v_group_match := pg_catalog.regexp_match(
            v_raw_before,
            '.*[[:space:]]are[[:space:]]+(.*)[[:space:]]*,?[[:space:]]*respectively[[:space:]]*,?[[:space:]]*and[[:space:]]+each[[:space:]]*$'
          );
          if v_raw_before ~ (
              '(^|[^[:alnum:]])' || v_raw_alias_pattern
              || '($|[.,;()]+|[[:space:]]+[(]|[[:space:]]+(and|as|is|may|or|was|which|who)([[:space:]]|$))'
            )
            and v_after ~ '(^|[[:space:]])(shares|securities)([[:space:]]|$)'
            and v_after ~ '(^|[[:space:]])(held|owned)([[:space:]]+directly)?[[:space:]]+by([[:space:]]|$)'
            and (
              (
                coalesce(pg_catalog.array_length(v_group_match, 1), 0) = 1
                and v_group_match[1] ~ (
                  '(^|[^[:alnum:]])' || v_raw_alias_pattern || '([^[:alnum:]]|$)'
                )
              )
              or v_before ~ (
                '^(the[[:space:]]+)?' || v_alias_pattern
                || '([[:space:]]+is[[:space:]].*[[:space:]]+and|[[:space:]]+as[[:space:]].*)$'
              )
            )
          then return true; end if;
        end if;
      end if;
    end loop;
  end loop;
  return false;
end;
$function$;

revoke all on function public.ownership_context_owner_alias_candidates(text, text)
  from public, anon, authenticated;
grant execute on function public.ownership_context_owner_alias_candidates(text, text)
  to service_role;
