-- Expand event_offering_terms so complex news/filing financings can separate
-- immediate share issuance, pre-funded warrant exposure, ordinary warrant
-- overhang, convertible exposure, and total potential share exposure.
-- Apply after 2026-05-19_event_offering_terms.sql.

alter table event_offering_terms
  add column if not exists common_shares_offered_text text,
  add column if not exists common_shares_offered numeric(28, 4),

  add column if not exists prefunded_warrant_shares_text text,
  add column if not exists prefunded_warrant_shares numeric(28, 4),
  add column if not exists prefunded_warrant_exercise_price_text text,
  add column if not exists prefunded_warrant_exercise_price numeric(24, 8),
  add column if not exists prefunded_warrant_exercise_price_currency text,

  add column if not exists common_warrant_shares_text text,
  add column if not exists common_warrant_shares numeric(28, 4),
  add column if not exists common_warrant_exercise_price_text text,
  add column if not exists common_warrant_exercise_price numeric(24, 8),
  add column if not exists common_warrant_exercise_price_currency text,

  add column if not exists convertible_principal_amount_text text,
  add column if not exists convertible_principal_amount numeric(24, 4),
  add column if not exists convertible_principal_amount_currency text,
  add column if not exists convertible_share_exposure_text text,
  add column if not exists convertible_share_exposure numeric(28, 4),

  add column if not exists total_potential_share_exposure_text text,
  add column if not exists total_potential_share_exposure numeric(28, 4),

  add column if not exists immediate_share_exposure numeric(28, 4),
  add column if not exists future_warrant_overhang_shares numeric(28, 4),
  add column if not exists immediate_float_impact_percent numeric(12, 4),
  add column if not exists total_potential_dilution_percent numeric(12, 4),
  add column if not exists total_potential_float_overhang_percent numeric(12, 4);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_offering_terms_common_shares_offered_nonnegative'
  ) then
    alter table event_offering_terms
      add constraint event_offering_terms_common_shares_offered_nonnegative
      check (common_shares_offered is null or common_shares_offered >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'event_offering_terms_prefunded_warrant_shares_nonnegative'
  ) then
    alter table event_offering_terms
      add constraint event_offering_terms_prefunded_warrant_shares_nonnegative
      check (prefunded_warrant_shares is null or prefunded_warrant_shares >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'event_offering_terms_common_warrant_shares_nonnegative'
  ) then
    alter table event_offering_terms
      add constraint event_offering_terms_common_warrant_shares_nonnegative
      check (common_warrant_shares is null or common_warrant_shares >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'event_offering_terms_convertible_share_exposure_nonnegative'
  ) then
    alter table event_offering_terms
      add constraint event_offering_terms_convertible_share_exposure_nonnegative
      check (convertible_share_exposure is null or convertible_share_exposure >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'event_offering_terms_total_potential_share_exposure_nonnegative'
  ) then
    alter table event_offering_terms
      add constraint event_offering_terms_total_potential_share_exposure_nonnegative
      check (total_potential_share_exposure is null or total_potential_share_exposure >= 0);
  end if;
end $$;

create index if not exists event_offering_terms_total_potential_exposure_idx
  on event_offering_terms(total_potential_share_exposure desc)
  where total_potential_share_exposure is not null;

create index if not exists event_offering_terms_total_potential_dilution_idx
  on event_offering_terms(total_potential_dilution_percent desc)
  where total_potential_dilution_percent is not null;
