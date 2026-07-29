begin;

select plan(9);

select set_eq(
  $$
    select enumlabel
    from pg_catalog.pg_enum
    where enumtypid = 'public.live_room_post_signal'::regtype
      and enumlabel in (
        'stock_split',
        'reverse_split',
        'direction_bullish',
        'direction_bearish',
        'direction_volatile',
        'direction_neutral'
      )
  $$,
  $$
    values
      ('stock_split'),
      ('reverse_split'),
      ('direction_bullish'),
      ('direction_bearish'),
      ('direction_volatile'),
      ('direction_neutral')
  $$,
  'split signals and direction metadata tags are available'
);

select ok(
  public.live_room_post_signals_valid(
    array[
      'stock_split',
      'earnings_beat',
      'positive_catalyst',
      'direction_bullish'
    ]::public.live_room_post_signal[]
  ),
  'three signals and one direction are valid together'
);

select ok(
  public.live_room_post_signals_valid(
    array[]::public.live_room_post_signal[]
  ),
  'signals and direction remain optional'
);

select ok(
  not public.live_room_post_signals_valid(
    array[
      'stock_split',
      'reverse_split',
      'earnings_beat',
      'positive_catalyst'
    ]::public.live_room_post_signal[]
  ),
  'four user-facing signals remain invalid'
);

select ok(
  not public.live_room_post_signals_valid(
    array[
      'direction_bullish',
      'direction_volatile'
    ]::public.live_room_post_signal[]
  ),
  'more than one direction is invalid'
);

select ok(
  not public.live_room_post_signals_valid(
    array[
      'stock_split',
      'stock_split'
    ]::public.live_room_post_signal[]
  ),
  'duplicate metadata values remain invalid'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.live_room_post_signals_valid(public.live_room_post_signal[])',
    'execute'
  ),
  'service role can validate post metadata'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.live_room_post_signals_valid(public.live_room_post_signal[])',
    'execute'
  ),
  'anonymous browser role cannot execute the validator'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.live_room_post_signals_valid(public.live_room_post_signal[])',
    'execute'
  ),
  'authenticated browser role cannot execute the validator'
);

select * from finish();

rollback;
