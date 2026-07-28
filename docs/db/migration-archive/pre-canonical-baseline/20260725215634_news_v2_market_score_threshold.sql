-- News V2 visibility policy:
-- - Company news keeps the existing non-archive contract at every score.
-- - Sector, theme, and macro news is visible only at coalesce(score, 50) >= 75.
-- - Both RPCs receive the same predicate in their normalized base CTE so page
--   rows, total, cursor, statistics, and facets cannot diverge.
-- - No events are rewritten. The existing broader partial indexes remain
--   usable because this policy only adds a narrower predicate.

do $migration$
declare
  search_definition text;
  facets_definition text;
  anchor text := 'and e.delivery_level <> ''archive''';
  visible_anchor text := $policy$and e.delivery_level <> 'archive'
    and (
      coalesce(
        nullif(lower(btrim(e.market_scope::text)), ''),
        'company'
      ) not in ('sector', 'theme', 'macro')
      or coalesce(e.score, 50) >= 75
    )$policy$;
begin
  select pg_get_functiondef(p.oid)
  into strict search_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'search_news_v2'
    and p.pronargs = 11;

  if (
    length(search_definition) -
    length(replace(search_definition, anchor, ''))
  ) <> length(anchor) then
    raise exception 'search_news_v2 visibility anchor must occur exactly once';
  end if;

  -- pg_get_functiondef returns the existing CREATE OR REPLACE statement,
  -- preserving the complete RPC signature, result contract, and attributes.
  execute replace(search_definition, anchor, visible_anchor);

  select pg_get_functiondef(p.oid)
  into strict facets_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_news_v2_facets'
    and p.pronargs = 0;

  if (
    length(facets_definition) -
    length(replace(facets_definition, anchor, ''))
  ) <> length(anchor) then
    raise exception 'get_news_v2_facets visibility anchor must occur exactly once';
  end if;

  execute replace(facets_definition, anchor, visible_anchor);
end;
$migration$;

-- CREATE OR REPLACE preserves the existing ACL. Repeat the service-only
-- contract explicitly so fresh and existing projects converge.
revoke all on function public.search_news_v2(
  text,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[],
  timestamptz,
  uuid,
  boolean,
  integer
) from public, anon, authenticated;
grant execute on function public.search_news_v2(
  text,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[],
  timestamptz,
  uuid,
  boolean,
  integer
) to service_role;

revoke all on function public.get_news_v2_facets()
from public, anon, authenticated;
grant execute on function public.get_news_v2_facets()
to service_role;
