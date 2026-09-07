-- Ownership detail rows now come from the preserved, verified SEC XML through
-- the production Ownership parser. The existing service-only tables and
-- atomic event-scoped replacement RPC remain unchanged.

comment on table public.event_form4_transactions is
  'One row per verified SEC XML Form 4 transaction. Source rows are not netted or assigned to one reporter when the filing supplies only a reporter set; LLM output is not the canonical numeric source.';

comment on table public.event_form144_proposed_sales is
  'One row per verified SEC XML Form 144 proposed-sale notice. Proposed sales remain distinct from executed Form 4 transactions; LLM output and blind unit-percentage division are not canonical.';

comment on function public.replace_event_ownership_facts(uuid, jsonb, jsonb) is
  'Atomically replaces one event Ownership detail domain. Product callers supply verified SEC XML/parser rows; successful replay is idempotent and any validation or insert error rolls all row changes back.';
