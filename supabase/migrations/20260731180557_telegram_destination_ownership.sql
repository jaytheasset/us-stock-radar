do $$
begin
  if exists (
    select 1
    from public.user_delivery_channels
    where channel = 'telegram'
      and nullif(btrim(destination), '') is not null
    group by btrim(destination)
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce Telegram destination ownership while duplicate destinations exist.';
  end if;
end
$$;

create unique index user_delivery_channels_telegram_destination_uidx
  on public.user_delivery_channels ((btrim(destination)))
  where channel = 'telegram'
    and nullif(btrim(destination), '') is not null;

comment on index public.user_delivery_channels_telegram_destination_uidx is
  'Allows each non-empty Telegram private chat destination to belong to only one Stock Radar user.';
