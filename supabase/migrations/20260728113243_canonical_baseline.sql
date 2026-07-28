-- Canonical schema-only baseline for the pre-release Stock Radar database.
-- Generated with Supabase CLI 2.110.0 from the hosted development database:
--   supabase db dump --db-url <REDACTED_CONNECTION_URL> --schema public,private
-- This migration intentionally contains no table data, auth users, or secrets.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- pg_stat_statements and supabase_vault are managed by the Supabase platform.
-- These application-level extensions match the hosted development database.
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."classification_method" AS ENUM (
    'rule',
    'llm',
    'manual',
    'unknown'
);


ALTER TYPE "public"."classification_method" OWNER TO "postgres";


CREATE TYPE "public"."delivery_status" AS ENUM (
    'pending',
    'sent',
    'failed',
    'skipped'
);


ALTER TYPE "public"."delivery_status" OWNER TO "postgres";


CREATE TYPE "public"."event_delivery_level" AS ENUM (
    'archive',
    'feed',
    'alert'
);


ALTER TYPE "public"."event_delivery_level" OWNER TO "postgres";


CREATE TYPE "public"."event_impact" AS ENUM (
    'high',
    'medium',
    'low'
);


ALTER TYPE "public"."event_impact" OWNER TO "postgres";


CREATE TYPE "public"."event_market_scope" AS ENUM (
    'company',
    'sector',
    'theme',
    'macro'
);


ALTER TYPE "public"."event_market_scope" OWNER TO "postgres";


CREATE TYPE "public"."event_signal" AS ENUM (
    'bullish',
    'bearish',
    'volatile',
    'neutral'
);


ALTER TYPE "public"."event_signal" OWNER TO "postgres";


CREATE TYPE "public"."run_status" AS ENUM (
    'queued',
    'running',
    'completed',
    'failed',
    'skipped'
);


ALTER TYPE "public"."run_status" OWNER TO "postgres";


CREATE TYPE "public"."runtime_owner" AS ENUM (
    'render',
    'nas',
    'external',
    'manual'
);


ALTER TYPE "public"."runtime_owner" OWNER TO "postgres";


CREATE TYPE "public"."source_group" AS ENUM (
    'news',
    'filings',
    'market'
);


ALTER TYPE "public"."source_group" OWNER TO "postgres";


CREATE TYPE "public"."theme_group_status" AS ENUM (
    'implemented',
    'planned'
);


ALTER TYPE "public"."theme_group_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."broadcast_live_room_message_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_room_topic text;
  v_action text;
begin
  select
    case
      when room.room_kind = 'company' then room.ticker
      when room.room_kind = 'community' then
        'community:' || community.slug
      else null
    end
  into v_room_topic
  from public.live_room_rooms as room
  left join public.live_room_community_rooms as community
    on community.room_id = room.id
  where room.id = new.room_id;

  if v_room_topic is null then
    return new;
  end if;

  v_action := case
    when tg_op = 'INSERT' then 'created'
    else new.visibility_status
  end;

  perform realtime.send(
    pg_catalog.jsonb_build_object(
      'roomId', new.room_id,
      'messageId', new.id,
      'action', v_action
    ),
    'live-room-changed',
    'live-room:' || v_room_topic,
    false
  );

  return new;
end
$$;


ALTER FUNCTION "private"."broadcast_live_room_message_change"() OWNER TO "postgres";


COMMENT ON FUNCTION "private"."broadcast_live_room_message_change"() IS 'Public Realtime refresh hint only. Payload must never include body or actor identifiers.';



CREATE OR REPLACE FUNCTION "private"."enable_rls_for_new_public_tables"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
declare
  created_object record;
begin
  for created_object in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
      and schema_name = 'public'
  loop
    execute format(
      'alter table if exists %s enable row level security',
      created_object.object_identity
    );
  end loop;
end
$$;


ALTER FUNCTION "private"."enable_rls_for_new_public_tables"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."enqueue_live_room_comment_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_post public.live_room_posts;
  v_parent_author_user_id uuid;
begin
  if new.visibility_status <> 'visible' then
    return new;
  end if;

  select post.*
  into v_post
  from public.live_room_posts as post
  where post.id = new.post_id
    and post.visibility_status = 'visible';

  if v_post.id is null then
    return new;
  end if;

  if new.parent_comment_id is not null then
    select comment.author_user_id
    into v_parent_author_user_id
    from public.live_room_post_comments as comment
    where comment.id = new.parent_comment_id
      and comment.visibility_status = 'visible';

    if v_parent_author_user_id is distinct from new.author_user_id then
      insert into public.live_room_post_activity (
        recipient_user_id,
        actor_user_id,
        activity_kind,
        source_id,
        post_id,
        comment_id,
        room_id
      )
      values (
        v_parent_author_user_id,
        new.author_user_id,
        'comment_reply',
        new.id,
        new.post_id,
        new.id,
        v_post.room_id
      )
      on conflict (recipient_user_id, source_id) do nothing;
    end if;
  end if;

  if v_post.author_user_id is distinct from new.author_user_id
    and (
      v_parent_author_user_id is null
      or v_post.author_user_id is distinct from v_parent_author_user_id
    )
  then
    insert into public.live_room_post_activity (
      recipient_user_id,
      actor_user_id,
      activity_kind,
      source_id,
      post_id,
      comment_id,
      room_id
    )
    values (
      v_post.author_user_id,
      new.author_user_id,
      'post_comment',
      new.id,
      new.post_id,
      new.id,
      v_post.room_id
    )
    on conflict (recipient_user_id, source_id) do nothing;
  end if;

  return new;
end
$$;


ALTER FUNCTION "private"."enqueue_live_room_comment_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."enqueue_live_room_post_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.visibility_status <> 'visible' then
    return new;
  end if;

  with candidates as (
    select
      follow.follower_user_id as recipient_user_id,
      'followed_member_post'::text as activity_kind,
      1 as priority
    from public.live_room_member_follows as follow
    where follow.followed_user_id = new.author_user_id
      and follow.follower_user_id <> new.author_user_id

    union all

    select
      follow.member_user_id as recipient_user_id,
      'followed_room_post'::text as activity_kind,
      2 as priority
    from public.live_room_follows as follow
    where follow.room_id = new.room_id
      and follow.actor_kind = 'member'
      and follow.member_user_id is not null
      and follow.followed = true
      and follow.member_user_id <> new.author_user_id
  ),
  eligible as (
    select distinct on (candidate.recipient_user_id)
      candidate.recipient_user_id,
      candidate.activity_kind
    from candidates as candidate
    where not exists (
      select 1
      from public.live_room_actor_blocks as block
      where block.blocker_kind = 'member'
        and block.blocked_kind = 'member'
        and (
          (
            block.blocker_member_user_id = candidate.recipient_user_id
            and block.blocked_member_user_id = new.author_user_id
          )
          or
          (
            block.blocker_member_user_id = new.author_user_id
            and block.blocked_member_user_id = candidate.recipient_user_id
          )
        )
    )
    order by candidate.recipient_user_id, candidate.priority
  )
  insert into public.live_room_post_activity (
    recipient_user_id,
    actor_user_id,
    activity_kind,
    source_id,
    post_id,
    room_id
  )
  select
    eligible.recipient_user_id,
    new.author_user_id,
    eligible.activity_kind,
    new.id,
    new.id,
    new.room_id
  from eligible
  on conflict (recipient_user_id, source_id) do nothing;

  return new;
end
$$;


ALTER FUNCTION "private"."enqueue_live_room_post_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_live_room_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog'
    AS $$
begin
  new.updated_at = now();
  return new;
end
$$;


ALTER FUNCTION "private"."set_live_room_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."touch_live_room_community_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.visibility_status = 'visible' then
    update public.live_room_community_rooms as room
    set
      last_activity_at = case
        when room.last_activity_at < new.created_at then new.created_at
        else room.last_activity_at
      end,
      updated_at = pg_catalog.now()
    where room.room_id = new.room_id;
  end if;
  return new;
end
$$;


ALTER FUNCTION "private"."touch_live_room_community_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."validate_live_room_post_comment_parent"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_parent public.live_room_post_comments;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  if new.parent_comment_id = new.id then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_INVALID_PARENT';
  end if;

  select comment.*
  into v_parent
  from public.live_room_post_comments as comment
  where comment.id = new.parent_comment_id;

  if v_parent.id is null
    or v_parent.post_id <> new.post_id
    or v_parent.parent_comment_id is not null
    or v_parent.visibility_status <> 'visible'
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_INVALID_PARENT';
  end if;

  return new;
end
$$;


ALTER FUNCTION "private"."validate_live_room_post_comment_parent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acquire_alert_delivery_job_lock"("p_job_name" "text", "p_ttl_seconds" integer, "p_locked_by" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row_count int := 0;
begin
  insert into alert_delivery_job_locks (job_name, locked_until, locked_by, updated_at, created_at)
  values (p_job_name, now() + make_interval(secs => greatest(p_ttl_seconds, 1)), p_locked_by, now(), now())
  on conflict (job_name) do update
    set locked_until = now() + make_interval(secs => greatest(p_ttl_seconds, 1)),
        locked_by = p_locked_by,
        updated_at = now()
    where alert_delivery_job_locks.locked_until <= now()
       or alert_delivery_job_locks.locked_by = p_locked_by;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;


ALTER FUNCTION "public"."acquire_alert_delivery_job_lock"("p_job_name" "text", "p_ttl_seconds" integer, "p_locked_by" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."acquire_alert_delivery_job_lock"("p_job_name" "text", "p_ttl_seconds" integer, "p_locked_by" "text") IS 'Atomically acquires an alert delivery job lease when no current lease is active.';



CREATE OR REPLACE FUNCTION "public"."acquire_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text", "p_ttl_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_acquired boolean := false;
begin
  if nullif(btrim(p_lock_key), '') is null or nullif(btrim(p_lock_owner), '') is null then
    raise exception 'lock key and owner are required';
  end if;

  insert into public.ingest_workflow_locks (
    lock_key,
    lock_owner,
    locked_until,
    updated_at
  )
  values (
    p_lock_key,
    p_lock_owner,
    now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 7200), 21600))),
    now()
  )
  on conflict (lock_key) do update
  set
    lock_owner = excluded.lock_owner,
    locked_until = excluded.locked_until,
    updated_at = now()
  where public.ingest_workflow_locks.locked_until <= now()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;


ALTER FUNCTION "public"."acquire_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text", "p_ttl_seconds" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."live_room_actor_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "blocker_kind" "text" NOT NULL,
    "blocker_member_user_id" "uuid",
    "blocker_guest_session_id" "uuid",
    "blocker_actor_id" "uuid" GENERATED ALWAYS AS (COALESCE("blocker_member_user_id", "blocker_guest_session_id")) STORED,
    "blocked_kind" "text" NOT NULL,
    "blocked_member_user_id" "uuid",
    "blocked_guest_session_id" "uuid",
    "blocked_actor_id" "uuid" GENERATED ALWAYS AS (COALESCE("blocked_member_user_id", "blocked_guest_session_id")) STORED,
    "blocked_display_name" "text" NOT NULL,
    "blocked_emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_actor_blocks_blocked_display_name_check" CHECK ((("char_length"("blocked_display_name") >= 1) AND ("char_length"("blocked_display_name") <= 24))),
    CONSTRAINT "live_room_actor_blocks_blocked_kind_check" CHECK (("blocked_kind" = ANY (ARRAY['member'::"text", 'guest'::"text"]))),
    CONSTRAINT "live_room_actor_blocks_blocker_kind_check" CHECK (("blocker_kind" = ANY (ARRAY['member'::"text", 'guest'::"text"]))),
    CONSTRAINT "live_room_actor_blocks_check" CHECK (((("blocker_kind" = 'member'::"text") AND ("blocker_member_user_id" IS NOT NULL) AND ("blocker_guest_session_id" IS NULL)) OR (("blocker_kind" = 'guest'::"text") AND ("blocker_guest_session_id" IS NOT NULL) AND ("blocker_member_user_id" IS NULL)))),
    CONSTRAINT "live_room_actor_blocks_check1" CHECK (((("blocked_kind" = 'member'::"text") AND ("blocked_member_user_id" IS NOT NULL) AND ("blocked_guest_session_id" IS NULL)) OR (("blocked_kind" = 'guest'::"text") AND ("blocked_guest_session_id" IS NOT NULL) AND ("blocked_member_user_id" IS NULL)))),
    CONSTRAINT "live_room_actor_blocks_check2" CHECK ((("blocker_kind" <> "blocked_kind") OR ("blocker_actor_id" <> "blocked_actor_id")))
);


ALTER TABLE "public"."live_room_actor_blocks" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_live_room_message_author"("p_room_id" "uuid", "p_message_id" "uuid", "p_blocker_kind" "text", "p_blocker_member_user_id" "uuid", "p_blocker_guest_session_id" "uuid") RETURNS "public"."live_room_actor_blocks"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_block public.live_room_actor_blocks;
  v_message public.live_room_messages;
  v_blocker_actor_id uuid := coalesce(
    p_blocker_member_user_id,
    p_blocker_guest_session_id
  );
begin
  select message.*
  into v_message
  from public.live_room_messages as message
  where message.id = p_message_id
    and message.room_id = p_room_id
    and message.visibility_status = 'visible';

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  if v_message.actor_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_BLOCK_TARGET_UNAVAILABLE';
  end if;

  if p_blocker_kind = v_message.author_kind
    and v_blocker_actor_id = v_message.actor_id
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_CANNOT_BLOCK_SELF';
  end if;

  insert into public.live_room_actor_blocks (
    blocker_kind,
    blocker_member_user_id,
    blocker_guest_session_id,
    blocked_kind,
    blocked_member_user_id,
    blocked_guest_session_id,
    blocked_display_name,
    blocked_emoji
  )
  values (
    p_blocker_kind,
    p_blocker_member_user_id,
    p_blocker_guest_session_id,
    v_message.author_kind,
    case
      when v_message.author_kind = 'member'
      then v_message.member_user_id
      else null
    end,
    case
      when v_message.author_kind = 'guest'
      then v_message.guest_session_id
      else null
    end,
    v_message.author_display_name,
    v_message.author_emoji
  )
  on conflict (
    blocker_kind,
    blocker_actor_id,
    blocked_kind,
    blocked_actor_id
  )
  do update set
    blocked_display_name = excluded.blocked_display_name,
    blocked_emoji = excluded.blocked_emoji
  returning * into v_block;

  return v_block;
end
$$;


ALTER FUNCTION "public"."block_live_room_message_author"("p_room_id" "uuid", "p_message_id" "uuid", "p_blocker_kind" "text", "p_blocker_member_user_id" "uuid", "p_blocker_guest_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_live_room_post_author"("p_post_id" "uuid", "p_blocker_kind" "text", "p_blocker_member_user_id" "uuid", "p_blocker_guest_session_id" "uuid") RETURNS "public"."live_room_actor_blocks"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_post public.live_room_posts;
  v_profile public.live_room_member_profiles;
  v_block public.live_room_actor_blocks;
  v_blocker_actor_id uuid := coalesce(
    p_blocker_member_user_id,
    p_blocker_guest_session_id
  );
begin
  select post.*
  into v_post
  from public.live_room_posts as post
  where post.id = p_post_id
    and post.visibility_status = 'visible';

  if v_post.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  if v_blocker_actor_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_ACTOR';
  end if;

  if p_blocker_kind = 'member'
    and p_blocker_member_user_id = v_post.author_user_id
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_CANNOT_BLOCK_SELF';
  end if;

  select profile.*
  into v_profile
  from public.live_room_member_profiles as profile
  where profile.user_id = v_post.author_user_id;

  insert into public.live_room_actor_blocks (
    blocker_kind,
    blocker_member_user_id,
    blocker_guest_session_id,
    blocked_kind,
    blocked_member_user_id,
    blocked_guest_session_id,
    blocked_display_name,
    blocked_emoji
  )
  values (
    p_blocker_kind,
    p_blocker_member_user_id,
    p_blocker_guest_session_id,
    'member',
    v_post.author_user_id,
    null,
    coalesce(v_profile.display_name, 'Member'),
    coalesce(v_profile.emoji, '👋')
  )
  on conflict (
    blocker_kind,
    blocker_actor_id,
    blocked_kind,
    blocked_actor_id
  )
  do update set
    blocked_display_name = excluded.blocked_display_name,
    blocked_emoji = excluded.blocked_emoji
  returning * into v_block;

  return v_block;
end
$$;


ALTER FUNCTION "public"."block_live_room_post_author"("p_post_id" "uuid", "p_blocker_kind" "text", "p_blocker_member_user_id" "uuid", "p_blocker_guest_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_live_room_community_room"("p_owner_user_id" "uuid", "p_slug" "text", "p_name" "text", "p_summary" "text", "p_topic" "text", "p_room_style" "text", "p_focus_tags" "text"[], "p_language" "text", "p_related_tickers" "text"[], "p_themes" "text"[], "p_industries" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  v_now timestamptz := pg_catalog.now();
  v_room_id uuid;
  v_slug text := pg_catalog.lower(pg_catalog.btrim(p_slug));
  v_name text := pg_catalog.btrim(p_name);
  v_summary text := pg_catalog.btrim(p_summary);
  v_related_tickers text[] :=
    coalesce(p_related_tickers, array[]::text[]);
  v_themes text[] := coalesce(p_themes, array[]::text[]);
  v_industries text[] := coalesce(p_industries, array[]::text[]);
begin
  if p_owner_user_id is null
    or not exists (
      select 1
      from public.user_profiles as profile
      where profile.id = p_owner_user_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_MEMBER_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'community-room-owner:' || p_owner_user_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.live_room_community_rooms as room
    where room.owner_user_id = p_owner_user_id
      and room.created_at >= v_now - interval '5 minutes'
  )
  or (
    select pg_catalog.count(*)
    from public.live_room_community_rooms as room
    where room.owner_user_id = p_owner_user_id
      and room.created_at >= v_now - interval '24 hours'
  ) >= 5
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_CREATE_RATE_LIMIT';
  end if;

  if pg_catalog.char_length(v_slug) not between 8 and 64
    or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SLUG';
  end if;

  if exists (
    select 1
    from public.live_room_community_rooms as room
    where room.slug = v_slug
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_SLUG_TAKEN';
  end if;

  if pg_catalog.char_length(v_name) not between 4 and 60
    or v_name ~ '[[:cntrl:]]'
    or v_name ~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_NAME';
  end if;

  if pg_catalog.char_length(v_summary) not between 12 and 160
    or v_summary ~ '[[:cntrl:]]'
    or v_summary ~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SUMMARY';
  end if;

  if p_topic not in (
    'market_macro',
    'sector_industry',
    'events_catalysts',
    'trading_strategy',
    'learning_qna',
    'creator_community'
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_TOPIC';
  end if;

  if p_room_style not in (
    'live_reaction',
    'deep_research',
    'beginner_friendly',
    'open_discussion'
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_STYLE';
  end if;

  if p_language not in ('en', 'ko', 'ja') then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_LANGUAGE';
  end if;

  if not public.live_room_community_focus_tags_valid(p_focus_tags) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_FOCUS_TAGS';
  end if;

  if not public.live_room_community_tickers_valid(v_related_tickers) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_RELATED_TICKERS';
  end if;

  if not public.live_room_community_themes_valid(v_themes) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_THEMES';
  end if;

  if not public.live_room_community_industries_valid(v_industries) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_INDUSTRIES';
  end if;

  if pg_catalog.cardinality(v_related_tickers) = 0
    and pg_catalog.cardinality(v_themes) = 0
    and pg_catalog.cardinality(v_industries) = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_DISCOVERY_ANCHOR_REQUIRED';
  end if;

  insert into public.live_room_rooms (ticker, issuer_id, room_kind)
  values (null, null, 'community')
  returning id into v_room_id;

  insert into public.live_room_community_rooms (
    room_id,
    slug,
    owner_user_id,
    name,
    summary,
    topic,
    room_style,
    focus_tags,
    language,
    related_tickers,
    themes,
    industries,
    last_activity_at,
    created_at,
    updated_at
  )
  values (
    v_room_id,
    v_slug,
    p_owner_user_id,
    v_name,
    v_summary,
    p_topic,
    p_room_style,
    p_focus_tags,
    p_language,
    v_related_tickers,
    v_themes,
    v_industries,
    v_now,
    v_now,
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'slug', v_slug,
    'name', v_name,
    'summary', v_summary,
    'topic', p_topic,
    'roomStyle', p_room_style,
    'focusTags', p_focus_tags,
    'language', p_language,
    'relatedTickers', v_related_tickers,
    'themes', v_themes,
    'industries', v_industries,
    'lastActivityAt', v_now,
    'createdAt', v_now
  );
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_SLUG_TAKEN';
end
$_$;


ALTER FUNCTION "public"."create_live_room_community_room"("p_owner_user_id" "uuid", "p_slug" "text", "p_name" "text", "p_summary" "text", "p_topic" "text", "p_room_style" "text", "p_focus_tags" "text"[], "p_language" "text", "p_related_tickers" "text"[], "p_themes" "text"[], "p_industries" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."live_room_community_tickers_valid"("p_values" "text"[]) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) between 0 and 5
    and pg_catalog.array_position(p_values, null) is null
    and not exists (
      select 1
      from pg_catalog.unnest(p_values) as ticker
      where ticker <> pg_catalog.upper(pg_catalog.btrim(ticker))
        or ticker !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'
    )
    and (
      select pg_catalog.count(distinct ticker)
      from pg_catalog.unnest(p_values) as ticker
    ) = pg_catalog.cardinality(p_values)
$_$;


ALTER FUNCTION "public"."live_room_community_tickers_valid"("p_values" "text"[]) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "author_user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "related_tickers" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "referenced_event_id" "uuid",
    "visibility_status" "text" DEFAULT 'visible'::"text" NOT NULL,
    "moderation_reason" "text",
    "hidden_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_posts_body_check" CHECK (((("char_length"("body") >= 20) AND ("char_length"("body") <= 10000)) AND ("body" = "btrim"("body")))),
    CONSTRAINT "live_room_posts_related_tickers_check" CHECK ("public"."live_room_community_tickers_valid"("related_tickers")),
    CONSTRAINT "live_room_posts_title_check" CHECK (((("char_length"("title") >= 4) AND ("char_length"("title") <= 120)) AND ("title" = "btrim"("title")) AND ("title" !~ '[[:cntrl:]]'::"text"))),
    CONSTRAINT "live_room_posts_visibility_status_check" CHECK (("visibility_status" = ANY (ARRAY['visible'::"text", 'hidden'::"text", 'deleted'::"text"])))
);


ALTER TABLE "public"."live_room_posts" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_posts" IS 'Canonical Live Room post originals. Room/profile/chat surfaces reference these rows; they do not copy title or body.';



CREATE OR REPLACE FUNCTION "public"."create_live_room_post"("p_room_id" "uuid", "p_author_user_id" "uuid", "p_title" "text", "p_body" "text", "p_related_tickers" "text"[] DEFAULT ARRAY[]::"text"[], "p_referenced_event_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."live_room_posts"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_tickers text[] := coalesce(
    p_related_tickers,
    array[]::text[]
  );
  v_room public.live_room_rooms;
  v_event_ticker text;
  v_event_delivery_level text;
  v_community_tickers text[];
  v_post public.live_room_posts;
begin
  select room.*
  into v_room
  from public.live_room_rooms as room
  where room.id = p_room_id;

  if v_room.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_UNAVAILABLE';
  end if;

  if not exists (
    select 1
    from public.live_room_member_profiles as profile
    where profile.user_id = p_author_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;

  if not public.live_room_community_tickers_valid(v_tickers) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_INVALID_TICKERS';
  end if;

  if p_referenced_event_id is not null then
    select
      pg_catalog.upper(pg_catalog.btrim(event.ticker)),
      event.delivery_level::text
    into v_event_ticker, v_event_delivery_level
    from public.events as event
    where event.id = p_referenced_event_id
      and event.source_group::text in ('news', 'filings');

    if v_event_ticker is null or v_event_delivery_level = 'archive' then
      raise exception using
        errcode = 'P0001',
        message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
    end if;

    if v_room.room_kind = 'company'
      and v_event_ticker <> v_room.ticker
    then
      raise exception using
        errcode = 'P0001',
        message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
    elsif v_room.room_kind = 'community' then
      select community.related_tickers
      into v_community_tickers
      from public.live_room_community_rooms as community
      where community.room_id = p_room_id;

      if not (v_event_ticker = any(
        coalesce(v_community_tickers, array[]::text[])
      )) then
        raise exception using
          errcode = 'P0001',
          message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
      end if;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'live-room-post:' || p_author_user_id::text,
      0
    )
  );

  if (
    select pg_catalog.count(*)
    from public.live_room_posts as post
    where post.author_user_id = p_author_user_id
      and post.created_at >= pg_catalog.now() - interval '10 minutes'
  ) >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_RATE_LIMIT';
  end if;

  if exists (
    select 1
    from public.live_room_posts as post
    where post.author_user_id = p_author_user_id
      and post.visibility_status = 'visible'
      and post.created_at >= pg_catalog.now() - interval '10 minutes'
      and pg_catalog.lower(post.title) = pg_catalog.lower(v_title)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_DUPLICATE';
  end if;

  insert into public.live_room_posts (
    room_id,
    author_user_id,
    title,
    body,
    related_tickers,
    referenced_event_id
  )
  values (
    p_room_id,
    p_author_user_id,
    v_title,
    v_body,
    v_tickers,
    p_referenced_event_id
  )
  returning * into v_post;

  return v_post;
end
$$;


ALTER FUNCTION "public"."create_live_room_post"("p_room_id" "uuid", "p_author_user_id" "uuid", "p_title" "text", "p_body" "text", "p_related_tickers" "text"[], "p_referenced_event_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_post_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "author_user_id" "uuid" NOT NULL,
    "parent_comment_id" "uuid",
    "body" "text" NOT NULL,
    "visibility_status" "text" DEFAULT 'visible'::"text" NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_post_comments_body_check" CHECK (((("char_length"("body") >= 1) AND ("char_length"("body") <= 2000)) AND ("body" = "btrim"("body")))),
    CONSTRAINT "live_room_post_comments_visibility_status_check" CHECK (("visibility_status" = ANY (ARRAY['visible'::"text", 'hidden'::"text", 'deleted'::"text"])))
);


ALTER TABLE "public"."live_room_post_comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_post_comments" IS 'Canonical post comments and one-level replies shared by every cross-post exposure of a Live Room post.';



CREATE OR REPLACE FUNCTION "public"."create_live_room_post_comment"("p_post_id" "uuid", "p_author_user_id" "uuid", "p_body" "text", "p_parent_comment_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."live_room_post_comments"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_comment public.live_room_post_comments;
begin
  if not exists (
    select 1
    from public.live_room_posts as post
    where post.id = p_post_id
      and post.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.live_room_member_profiles as profile
    where profile.user_id = p_author_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'live-room-post-comment:' || p_author_user_id::text,
      0
    )
  );

  if (
    select pg_catalog.count(*)
    from public.live_room_post_comments as comment
    where comment.author_user_id = p_author_user_id
      and comment.created_at >= pg_catalog.now() - interval '10 minutes'
  ) >= 30 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_RATE_LIMIT';
  end if;

  if exists (
    select 1
    from public.live_room_post_comments as comment
    where comment.post_id = p_post_id
      and comment.author_user_id = p_author_user_id
      and comment.visibility_status = 'visible'
      and comment.created_at >= pg_catalog.now() - interval '1 minute'
      and comment.parent_comment_id is not distinct from p_parent_comment_id
      and pg_catalog.lower(comment.body) = pg_catalog.lower(v_body)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_DUPLICATE';
  end if;

  insert into public.live_room_post_comments (
    post_id,
    author_user_id,
    parent_comment_id,
    body
  )
  values (
    p_post_id,
    p_author_user_id,
    p_parent_comment_id,
    v_body
  )
  returning * into v_comment;

  return v_comment;
end
$$;


ALTER FUNCTION "public"."create_live_room_post_comment"("p_post_id" "uuid", "p_author_user_id" "uuid", "p_body" "text", "p_parent_comment_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_social_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "public_request_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_user_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "normalized_handle" "text" NOT NULL,
    "profile_url" "text" NOT NULL,
    "proof_code" "text" NOT NULL,
    "proof_url" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "show_on_profile" boolean DEFAULT true NOT NULL,
    "submitted_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_note" "text",
    "last_code_issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "code_issue_count" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_social_verifications_code_issue_count_check" CHECK ((("code_issue_count" >= 1) AND ("code_issue_count" <= 5))),
    CONSTRAINT "live_room_social_verifications_normalized_handle_check" CHECK (((("char_length"("normalized_handle") >= 1) AND ("char_length"("normalized_handle") <= 64)) AND ("normalized_handle" = "lower"("normalized_handle")) AND ("normalized_handle" ~ '^[a-z0-9._-]+$'::"text"))),
    CONSTRAINT "live_room_social_verifications_platform_check" CHECK (("platform" = ANY (ARRAY['x'::"text", 'youtube'::"text", 'instagram'::"text"]))),
    CONSTRAINT "live_room_social_verifications_profile_url_check" CHECK ((("char_length"("profile_url") >= 12) AND ("char_length"("profile_url") <= 500))),
    CONSTRAINT "live_room_social_verifications_proof_code_check" CHECK (("proof_code" ~ '^SR-[A-Z0-9]{4}-[A-Z0-9]{4}$'::"text")),
    CONSTRAINT "live_room_social_verifications_proof_url_check" CHECK ((("proof_url" IS NULL) OR (("char_length"("proof_url") >= 12) AND ("char_length"("proof_url") <= 700)))),
    CONSTRAINT "live_room_social_verifications_review_note_check" CHECK ((("review_note" IS NULL) OR ("char_length"("review_note") <= 240))),
    CONSTRAINT "live_room_social_verifications_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'proof_ready'::"text", 'pending_review'::"text", 'verified'::"text", 'rejected'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."live_room_social_verifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_social_verifications" IS 'Service-only manual social-account ownership review requests. Verification does not imply investment expertise or endorsement.';



CREATE OR REPLACE FUNCTION "public"."create_live_room_social_verification"("p_member_user_id" "uuid", "p_platform" "text", "p_normalized_handle" "text", "p_profile_url" "text", "p_proof_code" "text") RETURNS "public"."live_room_social_verifications"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_result public.live_room_social_verifications;
  v_now timestamptz := pg_catalog.now();
  v_recent_count integer;
begin
  if p_member_user_id is null
    or not exists (
      select 1
      from public.user_profiles as profile
      where profile.id = p_member_user_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_MEMBER_REQUIRED';
  end if;

  if p_platform not in ('x', 'youtube', 'instagram') then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_INVALID_PLATFORM';
  end if;

  update public.live_room_social_verifications
  set
    status = 'expired',
    show_on_profile = false,
    updated_at = v_now
  where member_user_id = p_member_user_id
    and platform = p_platform
    and status in ('draft', 'proof_ready', 'pending_review')
    and expires_at <= v_now;

  if exists (
    select 1
    from public.live_room_social_verifications as request
    where request.member_user_id = p_member_user_id
      and request.platform = p_platform
      and request.status in (
        'draft',
        'proof_ready',
        'pending_review',
        'verified'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_ACTIVE_REQUEST_EXISTS';
  end if;

  select pg_catalog.count(*)::integer
  into v_recent_count
  from public.live_room_social_verifications as request
  where request.member_user_id = p_member_user_id
    and request.last_code_issued_at > v_now - interval '24 hours';

  if v_recent_count >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_CODE_RATE_LIMIT';
  end if;

  insert into public.live_room_social_verifications (
    member_user_id,
    platform,
    normalized_handle,
    profile_url,
    proof_code,
    expires_at,
    last_code_issued_at
  )
  values (
    p_member_user_id,
    p_platform,
    p_normalized_handle,
    p_profile_url,
    p_proof_code,
    v_now + interval '24 hours',
    v_now
  )
  returning * into v_result;

  return v_result;
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_CONFLICT';
end
$$;


ALTER FUNCTION "public"."create_live_room_social_verification"("p_member_user_id" "uuid", "p_platform" "text", "p_normalized_handle" "text", "p_profile_url" "text", "p_proof_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_live_room_post"("p_post_id" "uuid", "p_author_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  update public.live_room_posts
  set
    visibility_status = 'deleted',
    deleted_at = pg_catalog.now()
  where id = p_post_id
    and author_user_id = p_author_user_id
    and visibility_status = 'visible';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_EDITABLE';
  end if;

  return true;
end
$$;


ALTER FUNCTION "public"."delete_live_room_post"("p_post_id" "uuid", "p_author_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_live_room_post_comment"("p_comment_id" "uuid", "p_author_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.live_room_post_comments as comment
    where comment.id = p_comment_id
      and comment.author_user_id = p_author_user_id
      and comment.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_NOT_EDITABLE';
  end if;

  update public.live_room_post_comments
  set
    visibility_status = 'deleted',
    deleted_at = pg_catalog.now()
  where id = p_comment_id
    or parent_comment_id = p_comment_id;

  return true;
end
$$;


ALTER FUNCTION "public"."delete_live_room_post_comment"("p_comment_id" "uuid", "p_author_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_filings_v2_facets"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
with normalized as (
  select
    e.published_at,
    e.score,
    coalesce(nullif(e.metadata ->> 'form_type', ''), 'SEC filing') as form_type,
    array(
      select distinct mapped.event_tag
      from (
        select case lower(raw.event_type)
          when 'earnings' then 'earnings'
          when 'insider' then 'insider'
          when 'insider_ownership' then 'insider'
          when 'offering' then 'offering'
          when 'securities_offering' then 'offering'
          when 'dilution' then 'dilution'
          when 'dilution_risk' then 'dilution'
          when 'ipo_listing' then 'listing'
          when 'listing' then 'listing'
          when 'listing_risk' then 'listing'
          when 'financial_risk' then 'legal'
          when 'legal' then 'legal'
          when 'legal_risk' then 'legal'
          when 'ma' then 'ma'
          when 'strategic_transaction' then 'ma'
          when 'governance' then 'governance'
          when 'leadership_governance' then 'governance'
          when 'shareholder_vote' then 'governance'
          when 'fda' then 'fda'
          when 'fda_clinical' then 'fda'
          when 'operating_update' then 'operating'
          when 'capital_return' then 'capital_return'
          when 'dividends' then 'capital_return'
          else null
        end as event_tag
        from (
          select e.event_type
          union all
          select coalesce(
            material_event ->> 'event_type',
            material_event ->> 'type',
            material_event ->> 'category'
          )
          from jsonb_array_elements(
            case
              when jsonb_typeof(e.metadata -> 'material_events') = 'array'
                then e.metadata -> 'material_events'
              else '[]'::jsonb
            end
          ) as material_event
        ) as raw
      ) as mapped
      where mapped.event_tag is not null
    ) as event_tags
  from public.events e
  where e.source_group = 'filings'
    and e.delivery_level <> 'archive'
    and e.published_at is not null
)
select jsonb_build_object(
  'form_options',
  coalesce(
    (select jsonb_agg(forms.form_type order by forms.form_type) from (select distinct form_type from normalized) forms),
    '[]'::jsonb
  ),
  'summary',
  jsonb_build_object(
    'filedToday',
    count(*) filter (
      where (published_at at time zone 'America/New_York')::date
        = (now() at time zone 'America/New_York')::date
    ),
    'alerts',
    count(*) filter (where score >= 75),
    'earnings',
    count(*) filter (where 'earnings' = any(event_tags)),
    'insider',
    count(*) filter (where 'insider' = any(event_tags)),
    'offering',
    count(*) filter (where 'offering' = any(event_tags)),
    'listing',
    count(*) filter (where 'listing' = any(event_tags))
  )
)
from normalized;
$$;


ALTER FUNCTION "public"."get_filings_v2_facets"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_room_activity_summary"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_people_limit" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with actor_context as (
    select
      coalesce(p_member_user_id, p_guest_session_id) as actor_id,
      greatest(
        1,
        least(coalesce(p_people_limit, 30), 50)
      ) as people_limit
    where (
      p_actor_kind = 'member'
      and p_member_user_id is not null
      and p_guest_session_id is null
    ) or (
      p_actor_kind = 'guest'
      and p_member_user_id is null
      and p_guest_session_id is not null
    )
  ),
  followed_rooms as (
    select
      follow.room_id,
      room.ticker,
      follow.last_read_at,
      follow.last_read_message_id
    from public.live_room_follows as follow
    join public.live_room_rooms as room
      on room.id = follow.room_id
    join actor_context as actor on true
    where room.room_kind = 'company'
      and follow.actor_kind = p_actor_kind
      and follow.actor_id = actor.actor_id
      and follow.followed = true
      and follow.notification_scope = 'new_chat_messages'
  ),
  room_unread_messages as (
    select
      followed_room.room_id,
      followed_room.ticker,
      message.id as message_id
    from followed_rooms as followed_room
    join public.live_room_messages as message
      on message.room_id = followed_room.room_id
      and message.visibility_status = 'visible'
      and (
        message.created_at > followed_room.last_read_at
        or (
          message.created_at = followed_room.last_read_at
          and followed_room.last_read_message_id is not null
          and message.id > followed_room.last_read_message_id
        )
      )
    join actor_context as actor on true
    where (
      message.author_kind is distinct from p_actor_kind
      or message.actor_id is distinct from actor.actor_id
    )
    and not exists (
      select 1
      from public.live_room_actor_blocks as block
      where block.blocker_kind = p_actor_kind
        and block.blocker_actor_id = actor.actor_id
        and block.blocked_kind = message.author_kind
        and block.blocked_actor_id = message.actor_id
    )
  ),
  room_summaries as (
    select
      followed_room.ticker,
      pg_catalog.count(room_unread.message_id)::bigint as unread_count
    from followed_rooms as followed_room
    left join room_unread_messages as room_unread
      on room_unread.room_id = followed_room.room_id
    group by followed_room.ticker
  ),
  people_unread_messages as (
    select
      message.id as message_id,
      room.ticker,
      message.author_display_name,
      message.author_emoji,
      pg_catalog.left(
        pg_catalog.regexp_replace(
          message.body,
          '[[:space:]]+',
          ' ',
          'g'
        ),
        160
      ) as body_preview,
      message.created_at
    from public.live_room_member_follows as follow
    join public.live_room_messages as message
      on message.author_kind = 'member'
      and message.member_user_id = follow.followed_user_id
      and message.visibility_status = 'visible'
      and (
        message.created_at > follow.last_read_at
        or (
          message.created_at = follow.last_read_at
          and follow.last_read_message_id is not null
          and message.id > follow.last_read_message_id
        )
      )
    join public.live_room_rooms as room
      on room.id = message.room_id
    where room.room_kind = 'company'
      and p_actor_kind = 'member'
      and follow.follower_user_id = p_member_user_id
      and follow.followed_user_id <> p_member_user_id
      and not exists (
        select 1
        from public.live_room_actor_blocks as block
        where block.blocker_kind = 'member'
          and block.blocker_member_user_id = p_member_user_id
          and block.blocked_kind = 'member'
          and block.blocked_member_user_id = follow.followed_user_id
      )
  ),
  followed_people as (
    select distinct on (follow.followed_user_id)
      follow.followed_user_id,
      message.id as message_id,
      room.ticker,
      message.author_display_name,
      message.author_emoji,
      message.created_at
    from public.live_room_member_follows as follow
    join public.live_room_messages as message
      on message.author_kind = 'member'
      and message.member_user_id = follow.followed_user_id
      and message.visibility_status = 'visible'
    join public.live_room_rooms as room
      on room.id = message.room_id
    where room.room_kind = 'company'
      and p_actor_kind = 'member'
      and follow.follower_user_id = p_member_user_id
      and not exists (
        select 1
        from public.live_room_actor_blocks as block
        where block.blocker_kind = 'member'
          and block.blocker_member_user_id = p_member_user_id
          and block.blocked_kind = 'member'
          and block.blocked_member_user_id = follow.followed_user_id
      )
    order by
      follow.followed_user_id,
      message.created_at desc,
      message.id desc
  ),
  limited_followed_people as (
    select followed.*
    from followed_people as followed
    order by followed.created_at desc, followed.message_id desc
    limit 50
  ),
  limited_people as (
    select people.*
    from people_unread_messages as people
    cross join actor_context as actor
    order by people.created_at desc, people.message_id desc
    limit (select actor.people_limit from actor_context as actor)
  ),
  distinct_unread_messages as (
    select room_unread.message_id
    from room_unread_messages as room_unread
    union
    select people_unread.message_id
    from people_unread_messages as people_unread
  )
  select pg_catalog.jsonb_build_object(
    'isAuthenticated',
    p_actor_kind = 'member',
    'hasMemberFollows',
    p_actor_kind = 'member'
      and exists (
        select 1
        from public.live_room_member_follows as follow
        where follow.follower_user_id = p_member_user_id
      ),
    'followedPeople',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'messageId', followed.message_id,
            'ticker', followed.ticker,
            'authorDisplayName', followed.author_display_name,
            'authorEmoji', followed.author_emoji
          )
          order by followed.created_at desc, followed.message_id desc
        )
        from limited_followed_people as followed
      ),
      '[]'::jsonb
    ),
    'rooms',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'ticker', room.ticker,
            'unreadCount', room.unread_count
          )
          order by room.unread_count desc, room.ticker asc
        )
        from room_summaries as room
      ),
      '[]'::jsonb
    ),
    'people',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'messageId', people.message_id,
            'ticker', people.ticker,
            'authorDisplayName', people.author_display_name,
            'authorEmoji', people.author_emoji,
            'bodyPreview', people.body_preview,
            'createdAt', people.created_at
          )
          order by people.created_at desc, people.message_id desc
        )
        from limited_people as people
      ),
      '[]'::jsonb
    ),
    'peopleUnreadCount',
    (
      select pg_catalog.count(*)::bigint
      from people_unread_messages
    ),
    'totalUnreadCount',
    (
      select pg_catalog.count(*)::bigint
      from distinct_unread_messages
    )
  )
$$;


ALTER FUNCTION "public"."get_live_room_activity_summary"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_people_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_live_room_activity_summary"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_people_limit" integer) IS 'Service-only bounded Live Room Rooms/People inbox summary with distinct cross-channel unread count.';



CREATE OR REPLACE FUNCTION "public"."get_live_room_community_room"("p_slug" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select pg_catalog.jsonb_build_object(
    'slug', room.slug,
    'name', room.name,
    'summary', room.summary,
    'topic', room.topic,
    'roomStyle', room.room_style,
    'focusTags', room.focus_tags,
    'language', room.language,
    'relatedTickers', room.related_tickers,
    'themes', room.themes,
    'industries', room.industries,
    'lastActivityAt', room.last_activity_at,
    'createdAt', room.created_at
  )
  from public.live_room_community_rooms as room
  where room.slug = pg_catalog.lower(pg_catalog.btrim(p_slug))
$$;


ALTER FUNCTION "public"."get_live_room_community_room"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_room_direct_conversation"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_before_created_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_before_message_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  v_conversation public.live_room_direct_conversations%rowtype;
  v_mutual_follow boolean;
  v_now timestamptz := now();
  v_page_size integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_peer_user_id uuid;
  v_result jsonb;
begin
  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and conversation.status in ('accepted', 'pending')
    and p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    );

  if not found then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_peer_user_id := case
    when v_conversation.member_low_user_id = p_requester_user_id
      then v_conversation.member_high_user_id
    else v_conversation.member_low_user_id
  end;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_mutual_follow :=
    exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = p_requester_user_id
        and follow.followed_user_id = v_peer_user_id
    )
    and exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = v_peer_user_id
        and follow.followed_user_id = p_requester_user_id
    );

  with eligible as (
    select
      message.id,
      message.body,
      message.sender_user_id,
      message.created_at,
      message.message_kind,
      message.risk_flags,
      message.risk_score,
      row_number() over (
        order by message.created_at desc, message.id desc
      ) as row_number
    from public.live_room_direct_messages as message
    where message.conversation_id = v_conversation.id
      and (
        p_before_created_at is null
        or (
          p_before_message_id is not null
          and (message.created_at, message.id)
            < (p_before_created_at, p_before_message_id)
        )
      )
    order by message.created_at desc, message.id desc
    limit v_page_size + 1
  ),
  page as (
    select eligible.*
    from eligible
    where eligible.row_number <= v_page_size
  )
  select jsonb_build_object(
    'conversationId', v_conversation.public_id,
    'status', v_conversation.status,
    'requestRole',
      case
        when v_conversation.status <> 'pending' then null
        when v_conversation.request_sender_user_id = p_requester_user_id
          then 'sender'
        else 'recipient'
      end,
    'peer',
      jsonb_build_object(
        'displayName', coalesce(profile.display_name, 'Member'),
        'emoji', coalesce(profile.emoji, '💬'),
        'plan',
          case greatest(
            case
              when subscription.status = 'active' then
                case subscription.plan
                  when 'ultimate' then 4
                  when 'advanced' then 3
                  when 'pro' then 2
                  when 'ad_free' then 1
                  else 0
                end
              else 0
            end,
            case
              when subscription.trial_plan in ('pro', 'advanced')
                and subscription.trial_started_at is not null
                and subscription.trial_ends_at is not null
                and subscription.trial_ends_at > v_now
              then
                case subscription.trial_plan
                  when 'advanced' then 3
                  when 'pro' then 2
                  else 0
                end
              else 0
            end
          )
            when 4 then 'ultimate'
            when 3 then 'advanced'
            when 2 then 'pro'
            when 1 then 'ad_free'
            else 'free'
          end
      ),
    'mutualFollow', v_mutual_follow,
    'canSend', v_conversation.status = 'accepted',
    'canRespond',
      v_conversation.status = 'pending'
      and v_conversation.request_sender_user_id <> p_requester_user_id,
    'readOnlyReason',
      case
        when v_conversation.status = 'accepted' then null
        when v_conversation.request_sender_user_id = p_requester_user_id
          then 'Your message request is pending.'
        else 'Accept this message request before replying.'
      end,
    'messages',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', page.id,
              'body', page.body,
              'createdAt', page.created_at,
              'isMine', page.sender_user_id = p_requester_user_id,
              'kind', page.message_kind,
              'riskFlags', page.risk_flags,
              'riskScore', page.risk_score
            )
            order by page.created_at asc, page.id asc
          )
          from page
        ),
        '[]'::jsonb
      ),
    'nextCursor',
      case
        when (select count(*) from eligible) > v_page_size then
          (
            select jsonb_build_object(
              'createdAt', page.created_at,
              'messageId', page.id
            )
            from page
            order by page.created_at asc, page.id asc
            limit 1
          )
        else null
      end
  )
  into v_result
  from public.live_room_member_profiles as profile
  left join public.user_plan_subscriptions as subscription
    on subscription.user_id = profile.user_id
  where profile.user_id = v_peer_user_id;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."get_live_room_direct_conversation"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_before_created_at" timestamp with time zone, "p_before_message_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_room_direct_inbox"("p_requester_user_id" "uuid", "p_limit" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with actor_conversations as (
    select
      conversation.id,
      conversation.public_id,
      conversation.status,
      conversation.request_sender_user_id,
      conversation.request_created_at,
      conversation.updated_at,
      case
        when conversation.member_low_user_id = p_requester_user_id
          then conversation.member_high_user_id
        else conversation.member_low_user_id
      end as peer_user_id
    from public.live_room_direct_conversations as conversation
    where p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    )
      and conversation.status in ('accepted', 'pending')
    order by conversation.updated_at desc, conversation.id desc
    limit 50
  ),
  visible as (
    select actor.*
    from actor_conversations as actor
    where not exists (
      select 1
      from public.live_room_actor_blocks as block
      where block.blocker_kind = 'member'
        and block.blocked_kind = 'member'
        and (
          (
            block.blocker_member_user_id = p_requester_user_id
            and block.blocked_member_user_id = actor.peer_user_id
          )
          or
          (
            block.blocker_member_user_id = actor.peer_user_id
            and block.blocked_member_user_id = p_requester_user_id
          )
        )
    )
  ),
  enriched as (
    select
      visible.*,
      coalesce(profile.display_name, 'Member') as peer_display_name,
      coalesce(profile.emoji, '💬') as peer_emoji,
      case greatest(
        case
          when subscription.status = 'active' then
            case subscription.plan
              when 'ultimate' then 4
              when 'advanced' then 3
              when 'pro' then 2
              when 'ad_free' then 1
              else 0
            end
          else 0
        end,
        case
          when subscription.trial_plan in ('pro', 'advanced')
            and subscription.trial_started_at is not null
            and subscription.trial_ends_at is not null
            and subscription.trial_ends_at > now()
          then
            case subscription.trial_plan
              when 'advanced' then 3
              when 'pro' then 2
              else 0
            end
          else 0
        end
      )
        when 4 then 'ultimate'
        when 3 then 'advanced'
        when 2 then 'pro'
        when 1 then 'ad_free'
        else 'free'
      end as peer_plan,
      latest.id as latest_message_id,
      latest.sender_user_id as latest_sender_user_id,
      latest.body as latest_body,
      latest.created_at as latest_created_at,
      latest.risk_flags as latest_risk_flags,
      latest.risk_score as latest_risk_score,
      (
        exists (
          select 1
          from public.live_room_member_follows as follow
          where follow.follower_user_id = p_requester_user_id
            and follow.followed_user_id = visible.peer_user_id
        )
        and exists (
          select 1
          from public.live_room_member_follows as follow
          where follow.follower_user_id = visible.peer_user_id
            and follow.followed_user_id = p_requester_user_id
        )
      ) as mutual_follow,
      case
        when visible.status <> 'accepted' then 0
        else (
          select count(*)::bigint
          from public.live_room_direct_messages as unread
          left join public.live_room_direct_reads as read_state
            on read_state.conversation_id = visible.id
            and read_state.member_user_id = p_requester_user_id
          where unread.conversation_id = visible.id
            and unread.sender_user_id <> p_requester_user_id
            and (
              read_state.last_read_at is null
              or unread.created_at > read_state.last_read_at
              or (
                unread.created_at = read_state.last_read_at
                and read_state.last_read_message_id is not null
                and unread.id > read_state.last_read_message_id
              )
            )
        )
      end as unread_count
    from visible
    join public.live_room_member_profiles as profile
      on profile.user_id = visible.peer_user_id
    left join public.user_plan_subscriptions as subscription
      on subscription.user_id = visible.peer_user_id
    left join lateral (
      select
        message.id,
        message.sender_user_id,
        message.body,
        message.created_at,
        message.risk_flags,
        message.risk_score
      from public.live_room_direct_messages as message
      where message.conversation_id = visible.id
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
  ),
  accepted_limited as (
    select enriched.*
    from enriched
    where enriched.status = 'accepted'
    order by
      coalesce(enriched.latest_created_at, enriched.updated_at) desc,
      enriched.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50)
  ),
  incoming_limited as (
    select enriched.*
    from enriched
    where enriched.status = 'pending'
      and enriched.request_sender_user_id <> p_requester_user_id
    order by enriched.request_created_at desc, enriched.id desc
    limit 20
  ),
  outgoing_limited as (
    select enriched.*
    from enriched
    where enriched.status = 'pending'
      and enriched.request_sender_user_id = p_requester_user_id
    order by enriched.request_created_at desc, enriched.id desc
    limit 20
  )
  select jsonb_build_object(
    'isAuthenticated', true,
    'totalUnreadCount',
      coalesce(
        (
          select sum(enriched.unread_count)
          from enriched
          where enriched.status = 'accepted'
        ),
        0
      )
      + (
        select count(*)
        from enriched
        where enriched.status = 'pending'
          and enriched.request_sender_user_id <> p_requester_user_id
      ),
    'pendingRequestCount',
      (
        select count(*)
        from enriched
        where enriched.status = 'pending'
          and enriched.request_sender_user_id <> p_requester_user_id
      ),
    'conversations',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'conversationId', accepted.public_id,
              'status', accepted.status,
              'peerDisplayName', accepted.peer_display_name,
              'peerEmoji', accepted.peer_emoji,
              'peerPlan', accepted.peer_plan,
              'latestBodyPreview',
                left(
                  regexp_replace(
                    coalesce(accepted.latest_body, ''),
                    '[[:space:]]+',
                    ' ',
                    'g'
                  ),
                  120
                ),
              'latestCreatedAt', accepted.latest_created_at,
              'latestIsMine',
                accepted.latest_sender_user_id = p_requester_user_id,
              'mutualFollow', accepted.mutual_follow,
              'unreadCount', accepted.unread_count
            )
            order by
              coalesce(accepted.latest_created_at, accepted.updated_at) desc,
              accepted.id desc
          )
          from accepted_limited as accepted
        ),
        '[]'::jsonb
      ),
    'incomingRequests',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'conversationId', incoming.public_id,
              'peerDisplayName', incoming.peer_display_name,
              'peerEmoji', incoming.peer_emoji,
              'peerPlan', incoming.peer_plan,
              'bodyPreview',
                left(
                  regexp_replace(
                    coalesce(incoming.latest_body, ''),
                    '[[:space:]]+',
                    ' ',
                    'g'
                  ),
                  160
                ),
              'createdAt', incoming.request_created_at,
              'riskFlags', incoming.latest_risk_flags,
              'riskScore', incoming.latest_risk_score
            )
            order by incoming.request_created_at desc, incoming.id desc
          )
          from incoming_limited as incoming
        ),
        '[]'::jsonb
      ),
    'outgoingRequests',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'conversationId', outgoing.public_id,
              'peerDisplayName', outgoing.peer_display_name,
              'peerEmoji', outgoing.peer_emoji,
              'peerPlan', outgoing.peer_plan,
              'bodyPreview',
                left(
                  regexp_replace(
                    coalesce(outgoing.latest_body, ''),
                    '[[:space:]]+',
                    ' ',
                    'g'
                  ),
                  160
                ),
              'createdAt', outgoing.request_created_at,
              'riskFlags', outgoing.latest_risk_flags,
              'riskScore', outgoing.latest_risk_score
            )
            order by outgoing.request_created_at desc, outgoing.id desc
          )
          from outgoing_limited as outgoing
        ),
        '[]'::jsonb
      )
  )
$$;


ALTER FUNCTION "public"."get_live_room_direct_inbox"("p_requester_user_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_room_direct_message_settings"("p_member_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with eligibility as (
    select
      exists (
        select 1
        from public.live_room_social_verifications as verification
        where verification.member_user_id = p_member_user_id
          and verification.status = 'verified'
      )
      or exists (
        select 1
        from public.live_room_moderators as moderator
        where moderator.user_id = p_member_user_id
          and moderator.active = true
          and moderator.role in ('moderator', 'admin')
      ) as can_use_selective_filters
  )
  select jsonb_build_object(
    'receiveMode', coalesce(setting.receive_mode, 'followers'),
    'requestFilter',
      case
        when eligibility.can_use_selective_filters
          then coalesce(setting.request_filter, 'any')
        else 'any'
      end,
    'canUseSelectiveFilters',
      eligibility.can_use_selective_filters
  )
  from (select 1) as singleton
  cross join eligibility
  left join public.live_room_direct_message_settings as setting
    on setting.member_user_id = p_member_user_id
$$;


ALTER FUNCTION "public"."get_live_room_direct_message_settings"("p_member_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_room_member_presence_summary"("p_member_user_id" "uuid", "p_ticker" "text", "p_message_ids" "uuid"[], "p_message_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $_$
  with request_context as (
    select
      greatest(1, least(coalesce(p_message_limit, 50), 50)) as message_limit
    where p_member_user_id is not null
      and exists (
        select 1
        from public.live_room_member_profiles as profile
        where profile.user_id = p_member_user_id
      )
      and p_ticker is not null
      and p_ticker = pg_catalog.upper(pg_catalog.btrim(p_ticker))
      and p_ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,9}$'
  ),
  requested_message_ids as (
    select requested.message_id, requested.ordinality
    from request_context as context
    cross join lateral pg_catalog.unnest(
      p_message_ids[1:context.message_limit]
    ) with ordinality as requested(message_id, ordinality)
  ),
  requested_messages as (
    select
      requested.message_id,
      requested.ordinality,
      message.member_user_id
    from requested_message_ids as requested
    join public.live_room_messages as message
      on message.id = requested.message_id
      and message.author_kind = 'member'
      and message.visibility_status = 'visible'
    join public.live_room_rooms as room
      on room.id = message.room_id
      and room.ticker = p_ticker
  ),
  message_presence as (
    select
      message.message_id,
      message.ordinality,
      (
        presence.member_user_id is not null
        and profile.show_presence = true
        and not exists (
          select 1
          from public.live_room_actor_blocks as block
          where block.blocker_kind = 'member'
            and block.blocked_kind = 'member'
            and (
              (
                block.blocker_member_user_id = p_member_user_id
                and block.blocked_member_user_id = message.member_user_id
              )
              or (
                block.blocker_member_user_id = message.member_user_id
                and block.blocked_member_user_id = p_member_user_id
              )
            )
        )
      ) as is_online
    from requested_messages as message
    join public.live_room_member_profiles as profile
      on profile.user_id = message.member_user_id
    left join public.live_room_member_presence as presence
      on presence.member_user_id = message.member_user_id
      and presence.ticker = p_ticker
      and presence.last_seen_at >= pg_catalog.now() - interval '2 minutes'
  ),
  room_count as (
    select pg_catalog.count(*)::integer as online_member_count
    from public.live_room_member_presence as presence
    join public.live_room_member_profiles as profile
      on profile.user_id = presence.member_user_id
      and profile.show_presence = true
    join request_context as context on true
    where presence.ticker = p_ticker
      and presence.last_seen_at >= pg_catalog.now() - interval '2 minutes'
  )
  select pg_catalog.jsonb_build_object(
    'onlineMemberCount',
    coalesce(
      (select count.online_member_count from room_count as count),
      0
    ),
    'messages',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'messageId', presence.message_id,
            'isOnline', presence.is_online
          )
          order by presence.ordinality
        )
        from message_presence as presence
      ),
      '[]'::jsonb
    )
  )
$_$;


ALTER FUNCTION "public"."get_live_room_member_presence_summary"("p_member_user_id" "uuid", "p_ticker" "text", "p_message_ids" "uuid"[], "p_message_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_room_post_activity_summary"("p_recipient_user_id" "uuid", "p_limit" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $_$
  with visible_activity as (
    select
      activity.id,
      activity.activity_kind,
      activity.post_id,
      activity.comment_id,
      activity.created_at,
      activity.read_at,
      post.title as post_title,
      pg_catalog.left(
        pg_catalog.regexp_replace(
          coalesce(comment.body, post.body),
          '[[:space:]]+',
          ' ',
          'g'
        ),
        160
      ) as body_preview,
      coalesce(profile.display_name, 'Member') as actor_display_name,
      coalesce(profile.emoji, pg_catalog.chr(128100)) as actor_emoji,
      room.room_kind,
      room.ticker,
      community.slug as community_slug,
      community.name as community_name
    from public.live_room_post_activity as activity
    join public.live_room_posts as post
      on post.id = activity.post_id
      and post.visibility_status = 'visible'
    left join public.live_room_post_comments as comment
      on comment.id = activity.comment_id
      and comment.visibility_status = 'visible'
    left join public.live_room_member_profiles as profile
      on profile.user_id = activity.actor_user_id
    join public.live_room_rooms as room
      on room.id = activity.room_id
    left join public.live_room_community_rooms as community
      on community.room_id = room.id
    where activity.recipient_user_id = p_recipient_user_id
      and (
        activity.comment_id is null
        or comment.id is not null
      )
      and not exists (
        select 1
        from public.live_room_actor_blocks as block
        where block.blocker_kind = 'member'
          and block.blocked_kind = 'member'
          and (
            (
              block.blocker_member_user_id = p_recipient_user_id
              and block.blocked_member_user_id = activity.actor_user_id
            )
            or
            (
              block.blocker_member_user_id = activity.actor_user_id
              and block.blocked_member_user_id = p_recipient_user_id
            )
          )
      )
  ),
  limited as (
    select visible.*
    from visible_activity as visible
    order by visible.created_at desc, visible.id desc
    limit greatest(1, least(coalesce(p_limit, 30), 50))
  )
  select pg_catalog.jsonb_build_object(
    'items',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'activityId', item.id,
            'kind', item.activity_kind,
            'postId', item.post_id,
            'commentId', item.comment_id,
            'createdAt', item.created_at,
            'isRead', item.read_at is not null,
            'postTitle', item.post_title,
            'bodyPreview', item.body_preview,
            'actorDisplayName', item.actor_display_name,
            'actorEmoji', item.actor_emoji,
            'roomKind', item.room_kind,
            'ticker', item.ticker,
            'communitySlug', item.community_slug,
            'roomLabel',
              case
                when item.room_kind = 'company'
                  then '$' || item.ticker
                else item.community_name
              end
          )
          order by item.created_at desc, item.id desc
        )
        from limited as item
      ),
      '[]'::jsonb
    ),
    'unreadCount',
    (
      select pg_catalog.count(*)::bigint
      from visible_activity as visible
      where visible.read_at is null
    )
  )
$_$;


ALTER FUNCTION "public"."get_live_room_post_activity_summary"("p_recipient_user_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_room_presence_setting"("p_member_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select profile.show_presence
  from public.live_room_member_profiles as profile
  where profile.user_id = p_member_user_id
$$;


ALTER FUNCTION "public"."get_live_room_presence_setting"("p_member_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_room_social_badges"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_message_ids" "uuid"[]) RETURNS TABLE("message_id" "uuid", "platform" "text", "profile_url" "text")
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select
    message.id as message_id,
    verification.platform,
    verification.profile_url
  from public.live_room_messages as message
  join public.live_room_social_verifications as verification
    on verification.member_user_id = message.member_user_id
  where message.id = any(
      COALESCE(p_message_ids, '{}'::uuid[])
    )
    and pg_catalog.cardinality(
      COALESCE(p_message_ids, '{}'::uuid[])
    ) <= 50
    and message.author_kind = 'member'
    and message.visibility_status = 'visible'
    and verification.status = 'verified'
    and verification.show_on_profile = true
    and verification.expires_at is null
    and not exists (
      select 1
      from public.live_room_actor_blocks as block
      where (
        p_actor_kind = 'member'
        and (
          (
            block.blocker_kind = 'member'
            and block.blocker_member_user_id = p_member_user_id
            and block.blocked_kind = 'member'
            and block.blocked_member_user_id = message.member_user_id
          )
          or (
            block.blocker_kind = 'member'
            and block.blocker_member_user_id = message.member_user_id
            and block.blocked_kind = 'member'
            and block.blocked_member_user_id = p_member_user_id
          )
        )
      )
      or (
        p_actor_kind = 'guest'
        and block.blocker_kind = 'guest'
        and block.blocker_guest_session_id = p_guest_session_id
        and block.blocked_kind = 'member'
        and block.blocked_member_user_id = message.member_user_id
      )
    )
  order by message.id, verification.platform
$$;


ALTER FUNCTION "public"."get_live_room_social_badges"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_message_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_room_unread_summary"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid") RETURNS TABLE("room_ticker" "text", "unread_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select
    room.ticker as room_ticker,
    pg_catalog.count(message.id)::bigint as unread_count
  from public.live_room_follows as follow
  join public.live_room_rooms as room
    on room.id = follow.room_id
  left join public.live_room_messages as message
    on message.room_id = follow.room_id
    and message.visibility_status = 'visible'
    and (
      message.created_at > follow.last_read_at
      or (
        message.created_at = follow.last_read_at
        and follow.last_read_message_id is not null
        and message.id > follow.last_read_message_id
      )
    )
    and (
      message.author_kind is distinct from follow.actor_kind
      or message.actor_id is distinct from follow.actor_id
    )
  where room.room_kind = 'company'
    and follow.actor_kind = p_actor_kind
    and follow.actor_id = coalesce(p_member_user_id, p_guest_session_id)
    and follow.followed = true
    and follow.notification_scope = 'new_chat_messages'
  group by room.ticker
  order by pg_catalog.count(message.id) desc, room.ticker asc
$$;


ALTER FUNCTION "public"."get_live_room_unread_summary"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_news_v2_facets"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
with normalized as (
  select
    public.news_v2_source_label(e.source_code, e.source_name) as source_label,
    coalesce(nullif(lower(btrim(e.event_type)), ''), 'event') as event_type,
    nullif(btrim(e.sector), '') as sector,
    nullif(btrim(e.theme_group), '') as theme_group,
    nullif(btrim(e.sub_theme), '') as sub_theme
  from public.events e
  where e.source_group = 'news'
    and e.delivery_level <> 'archive'
    and (
      coalesce(
        nullif(lower(btrim(e.market_scope::text)), ''),
        'company'
      ) not in ('sector', 'theme', 'macro')
      or coalesce(e.score, 50) >= 75
    )
    and coalesce(e.published_at, e.detected_at) is not null
)
select jsonb_build_object(
  'event_types',
  coalesce(
    (
      select jsonb_agg(options.event_type order by options.event_type)
      from (select distinct event_type from normalized) options
    ),
    '[]'::jsonb
  ),
  'sources',
  coalesce(
    (
      select jsonb_agg(options.source_label order by options.source_label)
      from (select distinct source_label from normalized) options
    ),
    '[]'::jsonb
  ),
  'sectors',
  coalesce(
    (
      select jsonb_agg(options.sector order by options.sector)
      from (select distinct sector from normalized where sector is not null) options
    ),
    '[]'::jsonb
  ),
  'themes',
  coalesce(
    (
      select jsonb_agg(options.theme order by options.theme)
      from (
        select distinct theme_group as theme from normalized where theme_group is not null
        union
        select distinct sub_theme as theme from normalized where sub_theme is not null
      ) options
    ),
    '[]'::jsonb
  ),
  'source_activity', '[]'::jsonb,
  'theme_activity', '[]'::jsonb
);
$$;


ALTER FUNCTION "public"."get_news_v2_facets"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "author_kind" "text" NOT NULL,
    "member_user_id" "uuid",
    "guest_session_id" "uuid",
    "actor_id" "uuid" GENERATED ALWAYS AS (COALESCE("member_user_id", "guest_session_id")) STORED,
    "author_display_name" "text" NOT NULL,
    "author_emoji" "text" NOT NULL,
    "author_plan" "text" NOT NULL,
    "body" "text" NOT NULL,
    "referenced_event_id" "uuid",
    "referenced_event_kind" "text",
    "referenced_event_title" "text",
    "visibility_status" "text" DEFAULT 'visible'::"text" NOT NULL,
    "moderation_reason" "text",
    "hidden_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_messages_author_display_name_check" CHECK ((("char_length"("author_display_name") >= 1) AND ("char_length"("author_display_name") <= 24))),
    CONSTRAINT "live_room_messages_author_emoji_check" CHECK (("author_emoji" = ANY (ARRAY["chr"(128075), "chr"(129418), "chr"(128059), "chr"(129417), "chr"(128640), "chr"(129517), "chr"(128202), "chr"(127793)]))),
    CONSTRAINT "live_room_messages_author_kind_check" CHECK (("author_kind" = ANY (ARRAY['member'::"text", 'guest'::"text"]))),
    CONSTRAINT "live_room_messages_author_plan_check" CHECK (("author_plan" = ANY (ARRAY['free'::"text", 'ad_free'::"text", 'pro'::"text", 'advanced'::"text", 'ultimate'::"text"]))),
    CONSTRAINT "live_room_messages_body_check" CHECK (((("char_length"("body") >= 1) AND ("char_length"("body") <= 600)) AND ("body" = "btrim"("body")))),
    CONSTRAINT "live_room_messages_check" CHECK (((("author_kind" = 'member'::"text") AND ("guest_session_id" IS NULL)) OR (("author_kind" = 'guest'::"text") AND ("member_user_id" IS NULL)))),
    CONSTRAINT "live_room_messages_check1" CHECK (((("referenced_event_id" IS NULL) AND ("referenced_event_kind" IS NULL) AND ("referenced_event_title" IS NULL)) OR (("referenced_event_id" IS NOT NULL) AND ("referenced_event_kind" IS NOT NULL) AND ("referenced_event_title" IS NOT NULL)))),
    CONSTRAINT "live_room_messages_referenced_event_kind_check" CHECK (("referenced_event_kind" = ANY (ARRAY['filing'::"text", 'news'::"text"]))),
    CONSTRAINT "live_room_messages_visibility_status_check" CHECK (("visibility_status" = ANY (ARRAY['visible'::"text", 'hidden'::"text", 'deleted'::"text"])))
);


ALTER TABLE "public"."live_room_messages" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_messages" IS 'Company and Community Room chat. Hidden/deleted rows are retained for moderation audit; no client hard-delete API is exposed.';



CREATE OR REPLACE FUNCTION "public"."insert_live_room_message"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_author_display_name" "text", "p_author_emoji" "text", "p_author_plan" "text", "p_body" "text", "p_referenced_event_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."live_room_messages"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_actor_id uuid;
  v_body text := btrim(p_body);
  v_event_kind text;
  v_event_title text;
  v_event_ticker text;
  v_event_delivery_level text;
  v_message public.live_room_messages;
begin
  if p_actor_kind = 'member'
    and p_member_user_id is not null
    and p_guest_session_id is null
  then
    v_actor_id := p_member_user_id;
  elsif p_actor_kind = 'guest'
    and p_guest_session_id is not null
    and p_member_user_id is null
  then
    v_actor_id := p_guest_session_id;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_ACTOR';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_kind || ':' || v_actor_id::text, 0)
  );

  if regexp_replace(v_body, '[[:space:]]+', '', 'g') = '' then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_EMPTY';
  end if;

  if char_length(v_body) > 600 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MAX_LENGTH';
  end if;

  if lower(regexp_replace(v_body, '[[:space:]]+', ' ', 'g'))
    like any (array[
      '%guaranteed return%',
      '%pump and dump%',
      '%risk-free profit%'
    ])
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_BLOCKED_WORD';
  end if;

  if (
    select count(*)
    from regexp_matches(
      v_body,
      '(https?://|www\.)[^[:space:]]+',
      'gi'
    )
  ) > 2 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_EXCESSIVE_LINKS';
  end if;

  if exists (
    select 1
    from public.live_room_messages message
    where message.author_kind = p_actor_kind
      and message.actor_id = v_actor_id
      and message.visibility_status = 'visible'
      and message.created_at >= now() - interval '2 minutes'
      and lower(
        btrim(regexp_replace(message.body, '[[:space:]]+', ' ', 'g'))
      ) = lower(
        btrim(regexp_replace(v_body, '[[:space:]]+', ' ', 'g'))
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_DUPLICATE';
  end if;

  if (
    select count(*)
    from public.live_room_messages message
    where message.author_kind = p_actor_kind
      and message.actor_id = v_actor_id
      and message.visibility_status = 'visible'
      and message.created_at >= now() - interval '20 seconds'
  ) >= 3 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_RATE_LIMIT';
  end if;

  if p_referenced_event_id is not null then
    select
      case
        when event.source_group::text = 'filings' then 'filing'
        else 'news'
      end,
      event.title,
      upper(btrim(event.ticker)),
      event.delivery_level::text
    into
      v_event_kind,
      v_event_title,
      v_event_ticker,
      v_event_delivery_level
    from public.events event
    join public.live_room_rooms room
      on room.id = p_room_id
    where event.id = p_referenced_event_id
      and upper(btrim(event.ticker)) = room.ticker;

    if v_event_title is null or v_event_delivery_level = 'archive' then
      raise exception using
        errcode = 'P0001',
        message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
    end if;
  end if;

  insert into public.live_room_messages (
    room_id,
    author_kind,
    member_user_id,
    guest_session_id,
    author_display_name,
    author_emoji,
    author_plan,
    body,
    referenced_event_id,
    referenced_event_kind,
    referenced_event_title
  )
  values (
    p_room_id,
    p_actor_kind,
    p_member_user_id,
    p_guest_session_id,
    p_author_display_name,
    p_author_emoji,
    p_author_plan,
    v_body,
    p_referenced_event_id,
    v_event_kind,
    v_event_title
  )
  returning * into v_message;

  return v_message;
end
$$;


ALTER FUNCTION "public"."insert_live_room_message"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_author_display_name" "text", "p_author_emoji" "text", "p_author_plan" "text", "p_body" "text", "p_referenced_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_live_room_community_rooms"("p_topic" "text" DEFAULT NULL::"text", "p_room_style" "text" DEFAULT NULL::"text", "p_focus_tag" "text" DEFAULT NULL::"text", "p_language" "text" DEFAULT NULL::"text", "p_theme" "text" DEFAULT NULL::"text", "p_industry" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text", "p_sort" "text" DEFAULT 'activity'::"text", "p_after_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_after_slug" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 20) RETURNS TABLE("slug" "text", "name" "text", "summary" "text", "topic" "text", "room_style" "text", "focus_tags" "text"[], "language" "text", "related_tickers" "text"[], "themes" "text"[], "industries" "text"[], "last_activity_at" timestamp with time zone, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 20);
  v_search text := nullif(pg_catalog.btrim(p_search), '');
begin
  if p_topic is not null
    and p_topic not in (
      'market_macro',
      'sector_industry',
      'events_catalysts',
      'trading_strategy',
      'learning_qna',
      'creator_community'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_TOPIC';
  end if;

  if p_room_style is not null
    and p_room_style not in (
      'live_reaction',
      'deep_research',
      'beginner_friendly',
      'open_discussion'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_STYLE';
  end if;

  if p_focus_tag is not null
    and p_focus_tag not in (
      'company_news',
      'sec_filings',
      'earnings',
      'fda_clinical',
      'dilution_listing',
      'legal_financial_risk',
      'macro_policy',
      'mna_strategy',
      'product_leadership'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_FOCUS_TAGS';
  end if;

  if p_language is not null
    and p_language not in ('en', 'ko', 'ja')
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_LANGUAGE';
  end if;

  if p_theme is not null
    and not public.live_room_community_themes_valid(
      array[p_theme]::text[]
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_THEMES';
  end if;

  if p_industry is not null
    and not public.live_room_community_industries_valid(
      array[p_industry]::text[]
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_INDUSTRIES';
  end if;

  if p_sort not in ('activity', 'newest') then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SORT';
  end if;

  if v_search is not null
    and pg_catalog.char_length(v_search) > 80
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SEARCH';
  end if;

  if (p_after_at is null) <> (p_after_slug is null) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_CURSOR';
  end if;

  if p_sort = 'newest' then
    return query
    select
      room.slug,
      room.name,
      room.summary,
      room.topic,
      room.room_style,
      room.focus_tags,
      room.language,
      room.related_tickers,
      room.themes,
      room.industries,
      room.last_activity_at,
      room.created_at
    from public.live_room_community_rooms as room
    where (p_topic is null or room.topic = p_topic)
      and (p_room_style is null or room.room_style = p_room_style)
      and (
        p_focus_tag is null
        or room.focus_tags @> array[p_focus_tag]::text[]
      )
      and (p_language is null or room.language = p_language)
      and (
        p_theme is null
        or room.themes @> array[p_theme]::text[]
      )
      and (
        p_industry is null
        or room.industries @> array[p_industry]::text[]
      )
      and (
        v_search is null
        or room.search_document @@ pg_catalog.websearch_to_tsquery(
          'simple'::pg_catalog.regconfig,
          v_search
        )
      )
      and (
        p_after_at is null
        or (room.created_at, room.slug) < (p_after_at, p_after_slug)
      )
    order by room.created_at desc, room.slug desc
    limit v_limit + 1;
  else
    return query
    select
      room.slug,
      room.name,
      room.summary,
      room.topic,
      room.room_style,
      room.focus_tags,
      room.language,
      room.related_tickers,
      room.themes,
      room.industries,
      room.last_activity_at,
      room.created_at
    from public.live_room_community_rooms as room
    where (p_topic is null or room.topic = p_topic)
      and (p_room_style is null or room.room_style = p_room_style)
      and (
        p_focus_tag is null
        or room.focus_tags @> array[p_focus_tag]::text[]
      )
      and (p_language is null or room.language = p_language)
      and (
        p_theme is null
        or room.themes @> array[p_theme]::text[]
      )
      and (
        p_industry is null
        or room.industries @> array[p_industry]::text[]
      )
      and (
        v_search is null
        or room.search_document @@ pg_catalog.websearch_to_tsquery(
          'simple'::pg_catalog.regconfig,
          v_search
        )
      )
      and (
        p_after_at is null
        or (room.last_activity_at, room.slug) <
          (p_after_at, p_after_slug)
      )
    order by room.last_activity_at desc, room.slug desc
    limit v_limit + 1;
  end if;
end
$$;


ALTER FUNCTION "public"."list_live_room_community_rooms"("p_topic" "text", "p_room_style" "text", "p_focus_tag" "text", "p_language" "text", "p_theme" "text", "p_industry" "text", "p_search" "text", "p_sort" "text", "p_after_at" timestamp with time zone, "p_after_slug" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_live_room_social_verification_reviews"("p_admin_user_id" "uuid", "p_cursor_submitted_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_public_request_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 25) RETURNS TABLE("public_request_id" "uuid", "platform" "text", "normalized_handle" "text", "profile_url" "text", "proof_code" "text", "proof_url" "text", "status" "text", "submitted_at" timestamp with time zone, "expires_at" timestamp with time zone, "applicant_display_name" "text", "applicant_emoji" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.live_room_moderators as moderator
    where moderator.user_id = p_admin_user_id
      and moderator.active = true
      and moderator.role = 'admin'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_ADMIN_REQUIRED';
  end if;

  return query
  select
    request.public_request_id,
    request.platform,
    request.normalized_handle,
    request.profile_url,
    request.proof_code,
    request.proof_url,
    request.status,
    request.submitted_at,
    request.expires_at,
    profile.display_name,
    profile.emoji
  from public.live_room_social_verifications as request
  join public.live_room_member_profiles as profile
    on profile.user_id = request.member_user_id
  where request.status = 'pending_review'
    and request.expires_at > pg_catalog.now()
    and (
      p_cursor_submitted_at is null
      or (request.submitted_at, request.public_request_id)
        > (p_cursor_submitted_at, p_cursor_public_request_id)
    )
  order by request.submitted_at asc, request.public_request_id asc
  limit LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
end
$$;


ALTER FUNCTION "public"."list_live_room_social_verification_reviews"("p_admin_user_id" "uuid", "p_cursor_submitted_at" timestamp with time zone, "p_cursor_public_request_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."live_room_community_focus_tags_valid"("p_values" "text"[]) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) between 1 and 3
    and pg_catalog.array_position(p_values, null) is null
    and p_values <@ array[
      'company_news',
      'sec_filings',
      'earnings',
      'fda_clinical',
      'dilution_listing',
      'legal_financial_risk',
      'macro_policy',
      'mna_strategy',
      'product_leadership'
    ]::text[]
    and (
      select pg_catalog.count(distinct tag)
      from pg_catalog.unnest(p_values) as tag
    ) = pg_catalog.cardinality(p_values)
$$;


ALTER FUNCTION "public"."live_room_community_focus_tags_valid"("p_values" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."live_room_community_industries_valid"("p_values" "text"[]) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) between 0 and 3
    and pg_catalog.array_position(p_values, null) is null
    and p_values <@ array[
      'semiconductors_compute',
      'software_cloud',
      'cybersecurity',
      'it_services',
      'hardware_electronics',
      'internet_platforms',
      'media_entertainment',
      'gaming',
      'telecom_connectivity',
      'advertising_information_services',
      'autos_mobility',
      'retail_ecommerce',
      'restaurants',
      'travel_leisure',
      'home_lifestyle',
      'apparel_luxury',
      'food_beverage',
      'household_personal_care',
      'grocery_discount_retail',
      'agriculture_staples',
      'tobacco_cannabis_alternatives',
      'biotechnology',
      'pharmaceuticals',
      'medical_devices_diagnostics',
      'healthcare_services',
      'health_insurance_managed_care',
      'banks',
      'capital_markets_exchanges',
      'insurance',
      'asset_wealth_management',
      'payments_lending',
      'fintech_digital_assets',
      'diversified_finance',
      'aerospace_defense',
      'machinery_equipment',
      'transportation_logistics',
      'construction_infrastructure',
      'industrial_services_manufacturing',
      'environmental_waste',
      'business_services',
      'conglomerates',
      'oil_gas_refining',
      'midstream_lng',
      'energy_services_equipment',
      'renewable_energy',
      'nuclear_uranium',
      'coal',
      'electric_utilities',
      'power_generation_grid',
      'water_multi_utilities',
      'gas_utilities',
      'metals_mining',
      'precious_metals',
      'chemicals',
      'agricultural_inputs',
      'packaging_materials',
      'reits',
      'residential_real_estate',
      'commercial_real_estate',
      'industrial_logistics_real_estate',
      'real_estate_services',
      'shell_spac_undefined',
      'etf_funds_government_cef',
      'education'
    ]::text[]
    and (
      select pg_catalog.count(distinct industry)
      from pg_catalog.unnest(p_values) as industry
    ) = pg_catalog.cardinality(p_values)
$$;


ALTER FUNCTION "public"."live_room_community_industries_valid"("p_values" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."live_room_community_themes_valid"("p_values" "text"[]) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) between 0 and 3
    and pg_catalog.array_position(p_values, null) is null
    and p_values <@ array[
      'ai_data_center',
      'crypto_digital_assets',
      'healthcare_momentum',
      'power_energy_resources',
      'defense_geopolitics',
      'rates_credit_banks',
      'retail_momentum_flows',
      'policy_regulation',
      'ai_infrastructure',
      'ai_data_centers',
      'ai_chips_hbm',
      'ai_software_agents',
      'cloud_capex',
      'data_center_power_demand',
      'bitcoin',
      'stablecoins',
      'tokenization',
      'crypto_regulation',
      'crypto_mining',
      'glp1_obesity_drugs',
      'oncology_breakthroughs',
      'gene_editing',
      'rare_disease_drugs',
      'medical_ai_diagnostics',
      'nuclear_uranium',
      'lng_energy_security',
      'oil_supply_refining_margins',
      'grid_bottlenecks',
      'critical_minerals_copper',
      'gold_precious_metals',
      'defense_spending',
      'drones_autonomous_warfare',
      'space_satellites',
      'sanctions_export_controls',
      'china_risk',
      'tariffs_trade_war',
      'middle_east_risk',
      'interest_rates',
      'federal_reserve',
      'inflation',
      'regional_bank_stress',
      'credit_tightening',
      'commercial_real_estate_stress',
      'meme_stocks',
      'short_squeeze',
      'retail_trading',
      'high_short_interest',
      'small_cap_risk_on',
      'quantum_computing',
      'antitrust_big_tech_scrutiny',
      'deregulation_beneficiaries',
      'government_contracts',
      'cannabis_legalization',
      'fda_policy_risk'
    ]::text[]
    and (
      select pg_catalog.count(distinct theme)
      from pg_catalog.unnest(p_values) as theme
    ) = pg_catalog.cardinality(p_values)
$$;


ALTER FUNCTION "public"."live_room_community_themes_valid"("p_values" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_live_room_direct_conversation_read"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_message_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_conversation public.live_room_direct_conversations%rowtype;
  v_message public.live_room_direct_messages%rowtype;
  v_peer_user_id uuid;
begin
  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and conversation.status = 'accepted'
    and p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    );

  if not found then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_peer_user_id := case
    when v_conversation.member_low_user_id = p_requester_user_id
      then v_conversation.member_high_user_id
    else v_conversation.member_low_user_id
  end;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  if p_message_id is null then
    select message.*
    into v_message
    from public.live_room_direct_messages as message
    where message.conversation_id = v_conversation.id
    order by message.created_at desc, message.id desc
    limit 1;
  else
    select message.*
    into v_message
    from public.live_room_direct_messages as message
    where message.id = p_message_id
      and message.conversation_id = v_conversation.id;

    if not found then
      raise exception 'LIVE_ROOM_DIRECT_MESSAGE_NOT_FOUND';
    end if;
  end if;

  if v_message.id is null then
    return true;
  end if;

  insert into public.live_room_direct_reads (
    conversation_id,
    member_user_id,
    last_read_message_id,
    last_read_at,
    updated_at
  )
  values (
    v_conversation.id,
    p_requester_user_id,
    v_message.id,
    v_message.created_at,
    now()
  )
  on conflict (conversation_id, member_user_id)
  do update set
    last_read_message_id = case
      when excluded.last_read_at > public.live_room_direct_reads.last_read_at
        or (
          excluded.last_read_at = public.live_room_direct_reads.last_read_at
          and (
            public.live_room_direct_reads.last_read_message_id is null
            or excluded.last_read_message_id
              > public.live_room_direct_reads.last_read_message_id
          )
        )
        then excluded.last_read_message_id
      else public.live_room_direct_reads.last_read_message_id
    end,
    last_read_at = greatest(
      public.live_room_direct_reads.last_read_at,
      excluded.last_read_at
    ),
    updated_at = now();

  return true;
end;
$$;


ALTER FUNCTION "public"."mark_live_room_direct_conversation_read"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_message_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_live_room_follow_read"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_message_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_read_at timestamptz;
  v_updated_count integer;
begin
  if not (
    (
      p_actor_kind = 'member'
      and p_member_user_id is not null
      and p_guest_session_id is null
    )
    or
    (
      p_actor_kind = 'guest'
      and p_member_user_id is null
      and p_guest_session_id is not null
    )
  ) then
    raise exception 'LIVE_ROOM_INVALID_ACTOR';
  end if;

  if p_message_id is null then
    v_read_at := now();
  else
    select message.created_at
    into v_read_at
    from public.live_room_messages as message
    where message.id = p_message_id
      and message.room_id = p_room_id
      and message.visibility_status = 'visible';

    if v_read_at is null then
      raise exception 'LIVE_ROOM_MESSAGE_NOT_FOUND';
    end if;
  end if;

  update public.live_room_follows as follow
  set
    last_read_message_id = case
      when v_read_at >= follow.last_read_at then p_message_id
      else follow.last_read_message_id
    end,
    last_read_at = greatest(follow.last_read_at, v_read_at),
    notification_scope = 'new_chat_messages'
  where follow.room_id = p_room_id
    and follow.actor_kind = p_actor_kind
    and follow.actor_id = coalesce(p_member_user_id, p_guest_session_id)
    and follow.followed = true;

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end
$$;


ALTER FUNCTION "public"."mark_live_room_follow_read"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_message_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_live_room_member_activity_read"("p_follower_user_id" "uuid", "p_room_id" "uuid", "p_message_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_followed_user_id uuid;
  v_message_at timestamptz;
  v_updated_count integer;
begin
  select message.member_user_id, message.created_at
  into v_followed_user_id, v_message_at
  from public.live_room_messages as message
  join public.live_room_rooms as room
    on room.id = message.room_id
  where room.room_kind = 'company'
    and message.id = p_message_id
    and message.room_id = p_room_id
    and message.author_kind = 'member'
    and message.member_user_id is not null
    and message.visibility_status = 'visible';

  if v_followed_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocker_member_user_id = p_follower_user_id
      and block.blocked_kind = 'member'
      and block.blocked_member_user_id = v_followed_user_id
  ) then
    return false;
  end if;

  update public.live_room_member_follows as follow
  set
    last_read_message_id = case
      when v_message_at > follow.last_read_at
        or (
          v_message_at = follow.last_read_at
          and (
            follow.last_read_message_id is null
            or p_message_id > follow.last_read_message_id
          )
        )
      then p_message_id
      else follow.last_read_message_id
    end,
    last_read_at = greatest(follow.last_read_at, v_message_at)
  where follow.follower_user_id = p_follower_user_id
    and follow.followed_user_id = v_followed_user_id;

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end
$$;


ALTER FUNCTION "public"."mark_live_room_member_activity_read"("p_follower_user_id" "uuid", "p_room_id" "uuid", "p_message_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_live_room_post_activity_read"("p_recipient_user_id" "uuid", "p_activity_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_updated_count integer;
begin
  update public.live_room_post_activity as activity
  set read_at = coalesce(activity.read_at, pg_catalog.now())
  where activity.id = p_activity_id
    and activity.recipient_user_id = p_recipient_user_id;

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end
$$;


ALTER FUNCTION "public"."mark_live_room_post_activity_read"("p_recipient_user_id" "uuid", "p_activity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."moderate_live_room_message"("p_room_id" "uuid", "p_message_id" "uuid", "p_moderator_user_id" "uuid", "p_action" "text", "p_reason" "text") RETURNS "public"."live_room_messages"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_message public.live_room_messages;
  v_result public.live_room_messages;
  v_role text;
  v_reason text := pg_catalog.left(
    pg_catalog.btrim(coalesce(p_reason, '')),
    240
  );
begin
  select moderator.role
  into v_role
  from public.live_room_moderators as moderator
  where moderator.user_id = p_moderator_user_id
    and moderator.active = true;

  if v_role is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MODERATOR_REQUIRED';
  end if;

  select message.*
  into v_message
  from public.live_room_messages as message
  where message.id = p_message_id
    and message.room_id = p_room_id
  for update;

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  if p_action = 'hide' and v_message.visibility_status = 'visible' then
    if v_reason = '' then
      v_reason := 'Hidden by moderator';
    end if;
    update public.live_room_messages
    set
      visibility_status = 'hidden',
      moderation_reason = v_reason,
      hidden_at = pg_catalog.now()
    where id = p_message_id
    returning * into v_result;
  elsif p_action = 'restore' and v_message.visibility_status = 'hidden' then
    if v_reason = '' then
      v_reason := 'Restored by moderator';
    end if;
    update public.live_room_messages
    set
      visibility_status = 'visible',
      moderation_reason = null,
      hidden_at = null
    where id = p_message_id
    returning * into v_result;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_MODERATION_TRANSITION';
  end if;

  insert into public.live_room_moderation_actions (
    message_id,
    moderator_user_id,
    moderator_role,
    action,
    previous_visibility_status,
    resulting_visibility_status,
    reason
  )
  values (
    p_message_id,
    p_moderator_user_id,
    v_role,
    p_action,
    v_message.visibility_status,
    v_result.visibility_status,
    v_reason
  );

  return v_result;
end
$$;


ALTER FUNCTION "public"."moderate_live_room_message"("p_room_id" "uuid", "p_message_id" "uuid", "p_moderator_user_id" "uuid", "p_action" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."moderate_live_room_post"("p_post_id" "uuid", "p_moderator_user_id" "uuid", "p_action" "text", "p_reason" "text") RETURNS "public"."live_room_posts"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_post public.live_room_posts;
  v_result public.live_room_posts;
  v_role text;
  v_reason text := pg_catalog.left(
    pg_catalog.btrim(coalesce(p_reason, '')),
    240
  );
begin
  select moderator.role
  into v_role
  from public.live_room_moderators as moderator
  where moderator.user_id = p_moderator_user_id
    and moderator.active = true;

  if v_role is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MODERATOR_REQUIRED';
  end if;

  select post.*
  into v_post
  from public.live_room_posts as post
  where post.id = p_post_id
  for update;

  if v_post.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  if p_action = 'hide' and v_post.visibility_status = 'visible' then
    if v_reason = '' then
      v_reason := 'Hidden by moderator';
    end if;
    update public.live_room_posts
    set
      visibility_status = 'hidden',
      moderation_reason = v_reason,
      hidden_at = pg_catalog.now()
    where id = p_post_id
    returning * into v_result;
  elsif p_action = 'restore' and v_post.visibility_status = 'hidden' then
    if v_reason = '' then
      v_reason := 'Restored by moderator';
    end if;
    update public.live_room_posts
    set
      visibility_status = 'visible',
      moderation_reason = null,
      hidden_at = null
    where id = p_post_id
    returning * into v_result;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_MODERATION_TRANSITION';
  end if;

  insert into public.live_room_post_moderation_actions (
    post_id,
    moderator_user_id,
    moderator_role,
    action,
    previous_visibility_status,
    resulting_visibility_status,
    reason
  )
  values (
    p_post_id,
    p_moderator_user_id,
    v_role,
    p_action,
    v_post.visibility_status,
    v_result.visibility_status,
    v_reason
  );

  return v_result;
end
$$;


ALTER FUNCTION "public"."moderate_live_room_post"("p_post_id" "uuid", "p_moderator_user_id" "uuid", "p_action" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_live_room_social_verification"("p_member_user_id" "uuid", "p_public_request_id" "uuid", "p_action" "text", "p_proof_url" "text" DEFAULT NULL::"text", "p_proof_code" "text" DEFAULT NULL::"text", "p_show_on_profile" boolean DEFAULT NULL::boolean) RETURNS "public"."live_room_social_verifications"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_request public.live_room_social_verifications;
  v_result public.live_room_social_verifications;
  v_now timestamptz := pg_catalog.now();
  v_recent_count integer;
begin
  select request.*
  into v_request
  from public.live_room_social_verifications as request
  where request.public_request_id = p_public_request_id
    and request.member_user_id = p_member_user_id
  for update;

  if v_request.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_NOT_FOUND';
  end if;

  if v_request.status in ('draft', 'proof_ready', 'pending_review')
    and v_request.expires_at <= v_now
  then
    update public.live_room_social_verifications
    set status = 'expired', updated_at = v_now
    where id = v_request.id
    returning * into v_request;
  end if;

  if p_action = 'save_proof' then
    if v_request.status not in ('draft', 'proof_ready') then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_INVALID_TRANSITION';
    end if;
    if p_proof_url is null then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_PROOF_REQUIRED';
    end if;
    update public.live_room_social_verifications
    set
      proof_url = p_proof_url,
      status = 'proof_ready',
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_action = 'submit_review' then
    if v_request.status <> 'proof_ready'
      or v_request.proof_url is null
    then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_PROOF_REQUIRED';
    end if;
    update public.live_room_social_verifications
    set
      status = 'pending_review',
      submitted_at = v_now,
      review_note = null,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_action = 'reissue_code' then
    if v_request.status not in ('draft', 'proof_ready') then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_INVALID_TRANSITION';
    end if;
    if v_request.last_code_issued_at > v_now - interval '5 minutes' then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_CODE_RATE_LIMIT';
    end if;
    select pg_catalog.count(*)::integer
    into v_recent_count
    from public.live_room_social_verifications as request
    where request.member_user_id = p_member_user_id
      and request.last_code_issued_at > v_now - interval '24 hours';
    if v_recent_count >= 5
      or v_request.code_issue_count >= 5
      or p_proof_code is null
    then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_CODE_RATE_LIMIT';
    end if;
    update public.live_room_social_verifications
    set
      proof_code = p_proof_code,
      proof_url = null,
      status = 'draft',
      expires_at = v_now + interval '24 hours',
      last_code_issued_at = v_now,
      code_issue_count = code_issue_count + 1,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_action = 'set_visibility' then
    if v_request.status <> 'verified' or p_show_on_profile is null then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_INVALID_TRANSITION';
    end if;
    update public.live_room_social_verifications
    set
      show_on_profile = p_show_on_profile,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_action = 'cancel' then
    if v_request.status not in (
      'draft',
      'proof_ready',
      'pending_review',
      'verified'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_INVALID_TRANSITION';
    end if;
    update public.live_room_social_verifications
    set
      status = 'cancelled',
      show_on_profile = false,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  else
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_INVALID_ACTION';
  end if;

  return v_result;
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_CONFLICT';
end
$$;


ALTER FUNCTION "public"."mutate_live_room_social_verification"("p_member_user_id" "uuid", "p_public_request_id" "uuid", "p_action" "text", "p_proof_url" "text", "p_proof_code" "text", "p_show_on_profile" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."news_v2_search_document"("p_ticker" "text", "p_company_name" "text", "p_company" "text", "p_issuer" "text", "p_source_code" "text", "p_source_name" "text", "p_event_type" "text", "p_sector" "text", "p_theme_group" "text", "p_sub_theme" "text", "p_title" "text", "p_summary" "text", "p_quick_take" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select lower(
    coalesce(p_ticker, '') || ' ' ||
    coalesce(p_company_name, '') || ' ' ||
    coalesce(p_company, '') || ' ' ||
    coalesce(p_issuer, '') || ' ' ||
    public.news_v2_source_label(p_source_code, p_source_name) || ' ' ||
    replace(coalesce(p_source_code, ''), '_', ' ') || ' ' ||
    coalesce(p_event_type, '') || ' ' ||
    replace(coalesce(p_event_type, ''), '_', ' ') || ' ' ||
    coalesce(p_sector, '') || ' ' ||
    coalesce(p_theme_group, '') || ' ' ||
    coalesce(p_sub_theme, '') || ' ' ||
    coalesce(p_title, '') || ' ' ||
    coalesce(p_summary, '') || ' ' ||
    coalesce(p_quick_take, '')
  );
$$;


ALTER FUNCTION "public"."news_v2_search_document"("p_ticker" "text", "p_company_name" "text", "p_company" "text", "p_issuer" "text", "p_source_code" "text", "p_source_name" "text", "p_event_type" "text", "p_sector" "text", "p_theme_group" "text", "p_sub_theme" "text", "p_title" "text", "p_summary" "text", "p_quick_take" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."news_v2_source_label"("p_source_code" "text", "p_source_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select case lower(coalesce(p_source_code, ''))
    when 'accesswire' then 'Accesswire'
    when 'sec_edgar' then 'SEC'
    when 'globe' then 'GlobeNewswire'
    when 'globenewswire' then 'GlobeNewswire'
    when 'businesswire' then 'Business Wire'
    when 'prnewswire' then 'PR Newswire'
    when 'newsfile' then 'Newsfile'
    when 'ofac' then 'OFAC'
    when 'doj' then 'DOJ'
    when 'dea' then 'DEA'
    when 'whitehouse' then 'White House'
    when 'white-house' then 'White House'
    when 'fmp' then 'FMP'
    when 'nasdaq_corporate_actions' then 'Nasdaq Corporate Actions'
    when 'nasdaq_trader' then 'Nasdaq Trader'
    when 'polygon' then 'Polygon'
    else coalesce(nullif(p_source_name, ''), nullif(p_source_code, ''), 'Unknown')
  end;
$$;


ALTER FUNCTION "public"."news_v2_source_label"("p_source_code" "text", "p_source_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_alert_delivery_job_lock"("p_job_name" "text", "p_locked_by" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row_count int := 0;
begin
  update alert_delivery_job_locks
     set locked_until = now(),
         updated_at = now()
   where job_name = p_job_name
     and locked_by = p_locked_by;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;


ALTER FUNCTION "public"."release_alert_delivery_job_lock"("p_job_name" "text", "p_locked_by" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."release_alert_delivery_job_lock"("p_job_name" "text", "p_locked_by" "text") IS 'Releases an alert delivery job lease only for the matching lock owner.';



CREATE OR REPLACE FUNCTION "public"."release_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_released boolean := false;
begin
  delete from public.ingest_workflow_locks
  where lock_key = p_lock_key
    and lock_owner = p_lock_owner
  returning true into v_released;

  return coalesce(v_released, false);
end;
$$;


ALTER FUNCTION "public"."release_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."renew_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text", "p_ttl_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_renewed boolean := false;
begin
  update public.ingest_workflow_locks
  set
    locked_until = now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 7200), 21600))),
    updated_at = now()
  where lock_key = p_lock_key
    and lock_owner = p_lock_owner
    and locked_until > now()
  returning true into v_renewed;

  return coalesce(v_renewed, false);
end;
$$;


ALTER FUNCTION "public"."renew_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text", "p_ttl_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_live_room_direct_message"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_message_id" "uuid", "p_reason" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_conversation public.live_room_direct_conversations%rowtype;
  v_message public.live_room_direct_messages%rowtype;
  v_peer_user_id uuid;
begin
  if p_reason not in (
    'spam',
    'harassment',
    'scam',
    'misinformation',
    'other'
  ) then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_REPORT_REASON';
  end if;

  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and conversation.status in ('accepted', 'pending')
    and p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    );

  if not found then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_peer_user_id := case
    when v_conversation.member_low_user_id = p_requester_user_id
      then v_conversation.member_high_user_id
    else v_conversation.member_low_user_id
  end;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  select message.*
  into v_message
  from public.live_room_direct_messages as message
  where message.id = p_message_id
    and message.conversation_id = v_conversation.id
    and message.sender_user_id <> p_requester_user_id;

  if not found then
    raise exception 'LIVE_ROOM_DIRECT_MESSAGE_NOT_FOUND';
  end if;

  insert into public.live_room_direct_message_reports (
    conversation_id,
    message_id,
    reporter_user_id,
    reason,
    priority,
    risk_score_snapshot
  )
  values (
    v_conversation.id,
    v_message.id,
    p_requester_user_id,
    p_reason,
    case
      when v_message.risk_score > 0
        then least(200, 100 + v_message.risk_score)
      else 10
    end,
    v_message.risk_score
  )
  on conflict (message_id, reporter_user_id) do nothing;

  return true;
end;
$$;


ALTER FUNCTION "public"."report_live_room_direct_message"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_message_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_live_room_message"("p_room_id" "uuid", "p_message_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_report_id uuid;
  v_reporter_actor_id uuid;
begin
  if p_reason not in ('spam', 'harassment', 'misinformation', 'other') then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_REPORT_REASON';
  end if;

  if p_reporter_kind = 'member'
    and p_reporter_member_user_id is not null
    and p_reporter_guest_session_id is null
  then
    v_reporter_actor_id := p_reporter_member_user_id;
  elsif p_reporter_kind = 'guest'
    and p_reporter_guest_session_id is not null
    and p_reporter_member_user_id is null
  then
    v_reporter_actor_id := p_reporter_guest_session_id;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_REPORTER';
  end if;

  if not exists (
    select 1
    from public.live_room_messages as message
    where message.id = p_message_id
      and message.room_id = p_room_id
      and message.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  insert into public.live_room_message_reports (
    message_id,
    reporter_kind,
    reporter_actor_id,
    reporter_member_user_id,
    reporter_guest_session_id,
    reason
  )
  values (
    p_message_id,
    p_reporter_kind,
    v_reporter_actor_id,
    p_reporter_member_user_id,
    p_reporter_guest_session_id,
    p_reason
  )
  on conflict (message_id, reporter_kind, reporter_actor_id)
  do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select report.id
    into v_report_id
    from public.live_room_message_reports as report
    where report.message_id = p_message_id
      and report.reporter_kind = p_reporter_kind
      and report.reporter_actor_id = v_reporter_actor_id;
  end if;

  return v_report_id;
end
$$;


ALTER FUNCTION "public"."report_live_room_message"("p_room_id" "uuid", "p_message_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_live_room_post"("p_post_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_report_id uuid;
  v_reporter_actor_id uuid;
begin
  if p_reason not in ('spam', 'harassment', 'misinformation', 'other') then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_REPORT_REASON';
  end if;

  if p_reporter_kind = 'member'
    and p_reporter_member_user_id is not null
    and p_reporter_guest_session_id is null
  then
    v_reporter_actor_id := p_reporter_member_user_id;
  elsif p_reporter_kind = 'guest'
    and p_reporter_guest_session_id is not null
    and p_reporter_member_user_id is null
  then
    v_reporter_actor_id := p_reporter_guest_session_id;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_REPORTER';
  end if;

  if not exists (
    select 1
    from public.live_room_posts as post
    where post.id = p_post_id
      and post.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  insert into public.live_room_post_reports (
    post_id,
    reporter_kind,
    reporter_actor_id,
    reporter_member_user_id,
    reporter_guest_session_id,
    reason
  )
  values (
    p_post_id,
    p_reporter_kind,
    v_reporter_actor_id,
    p_reporter_member_user_id,
    p_reporter_guest_session_id,
    p_reason
  )
  on conflict (post_id, reporter_kind, reporter_actor_id)
  do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select report.id
    into v_report_id
    from public.live_room_post_reports as report
    where report.post_id = p_post_id
      and report.reporter_kind = p_reporter_kind
      and report.reporter_actor_id = v_reporter_actor_id;
  end if;

  return v_report_id;
end
$$;


ALTER FUNCTION "public"."report_live_room_post"("p_post_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_live_room_post_comment"("p_comment_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_report_id uuid;
  v_reporter_actor_id uuid;
begin
  if p_reason not in ('spam', 'harassment', 'misinformation', 'other') then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_REPORT_REASON';
  end if;

  if p_reporter_kind = 'member'
    and p_reporter_member_user_id is not null
    and p_reporter_guest_session_id is null
  then
    v_reporter_actor_id := p_reporter_member_user_id;
  elsif p_reporter_kind = 'guest'
    and p_reporter_guest_session_id is not null
    and p_reporter_member_user_id is null
  then
    v_reporter_actor_id := p_reporter_guest_session_id;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_REPORTER';
  end if;

  if not exists (
    select 1
    from public.live_room_post_comments as comment
    join public.live_room_posts as post
      on post.id = comment.post_id
    where comment.id = p_comment_id
      and comment.visibility_status = 'visible'
      and post.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_NOT_FOUND';
  end if;

  insert into public.live_room_post_comment_reports (
    comment_id,
    reporter_kind,
    reporter_actor_id,
    reporter_member_user_id,
    reporter_guest_session_id,
    reason
  )
  values (
    p_comment_id,
    p_reporter_kind,
    v_reporter_actor_id,
    p_reporter_member_user_id,
    p_reporter_guest_session_id,
    p_reason
  )
  on conflict (comment_id, reporter_kind, reporter_actor_id)
  do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select report.id
    into v_report_id
    from public.live_room_post_comment_reports as report
    where report.comment_id = p_comment_id
      and report.reporter_kind = p_reporter_kind
      and report.reporter_actor_id = v_reporter_actor_id;
  end if;

  return v_report_id;
end
$$;


ALTER FUNCTION "public"."report_live_room_post_comment"("p_comment_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."respond_live_room_direct_request"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_action" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_conversation public.live_room_direct_conversations%rowtype;
  v_message public.live_room_direct_messages%rowtype;
  v_peer_profile public.live_room_member_profiles%rowtype;
  v_peer_user_id uuid;
  v_now timestamptz := now();
begin
  if p_action not in ('accept', 'decline', 'block') then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_ACTION';
  end if;

  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and conversation.status = 'pending'
    and p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    )
  for update;

  if not found
    or v_conversation.request_sender_user_id = p_requester_user_id
  then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_peer_user_id := v_conversation.request_sender_user_id;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  if p_action = 'accept' then
    update public.live_room_direct_conversations
    set status = 'accepted',
        accepted_at = v_now,
        declined_at = null,
        state_updated_at = v_now,
        updated_at = v_now
    where id = v_conversation.id;

    select message.*
    into v_message
    from public.live_room_direct_messages as message
    where message.conversation_id = v_conversation.id
      and message.message_kind = 'request'
    limit 1;

    insert into public.live_room_direct_reads (
      conversation_id,
      member_user_id,
      last_read_message_id,
      last_read_at,
      updated_at
    )
    values (
      v_conversation.id,
      p_requester_user_id,
      v_message.id,
      v_message.created_at,
      v_now
    )
    on conflict (conversation_id, member_user_id)
    do update set
      last_read_message_id = excluded.last_read_message_id,
      last_read_at = excluded.last_read_at,
      updated_at = excluded.updated_at;

    return jsonb_build_object(
      'status', 'accepted',
      'conversationId', v_conversation.public_id
    );
  end if;

  if p_action = 'block' then
    select profile.*
    into v_peer_profile
    from public.live_room_member_profiles as profile
    where profile.user_id = v_peer_user_id;

    insert into public.live_room_actor_blocks (
      blocker_kind,
      blocker_member_user_id,
      blocker_guest_session_id,
      blocked_kind,
      blocked_member_user_id,
      blocked_guest_session_id,
      blocked_display_name,
      blocked_emoji
    )
    values (
      'member',
      p_requester_user_id,
      null,
      'member',
      v_peer_user_id,
      null,
      coalesce(v_peer_profile.display_name, 'Member'),
      coalesce(v_peer_profile.emoji, '💬')
    )
    on conflict (
      blocker_kind,
      blocker_actor_id,
      blocked_kind,
      blocked_actor_id
    )
    do update set
      blocked_display_name = excluded.blocked_display_name,
      blocked_emoji = excluded.blocked_emoji;
  end if;

  update public.live_room_direct_conversations
  set status = 'declined',
      declined_at = v_now,
      state_updated_at = v_now,
      updated_at = v_now
  where id = v_conversation.id;

  return jsonb_build_object(
    'status', case when p_action = 'block' then 'blocked' else 'declined' end,
    'conversationId', null
  );
end;
$$;


ALTER FUNCTION "public"."respond_live_room_direct_request"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_live_room_social_verification"("p_admin_user_id" "uuid", "p_public_request_id" "uuid", "p_decision" "text", "p_review_note" "text" DEFAULT NULL::"text") RETURNS "public"."live_room_social_verifications"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_request public.live_room_social_verifications;
  v_result public.live_room_social_verifications;
  v_note text := pg_catalog.left(
    pg_catalog.btrim(COALESCE(p_review_note, '')),
    240
  );
  v_now timestamptz := pg_catalog.now();
begin
  if not exists (
    select 1
    from public.live_room_moderators as moderator
    where moderator.user_id = p_admin_user_id
      and moderator.active = true
      and moderator.role = 'admin'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_ADMIN_REQUIRED';
  end if;

  select request.*
  into v_request
  from public.live_room_social_verifications as request
  where request.public_request_id = p_public_request_id
  for update;

  if v_request.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_NOT_FOUND';
  end if;

  if v_request.status <> 'pending_review' then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_ALREADY_REVIEWED';
  end if;

  if v_request.expires_at <= v_now then
    update public.live_room_social_verifications
    set status = 'expired', updated_at = v_now
    where id = v_request.id;
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_EXPIRED';
  end if;

  if p_decision = 'approve' then
    update public.live_room_social_verifications
    set
      status = 'verified',
      reviewed_by = p_admin_user_id,
      reviewed_at = v_now,
      review_note = null,
      expires_at = null,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_decision = 'reject' then
    if v_note = '' then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_REVIEW_NOTE_REQUIRED';
    end if;
    update public.live_room_social_verifications
    set
      status = 'rejected',
      reviewed_by = p_admin_user_id,
      reviewed_at = v_now,
      review_note = v_note,
      show_on_profile = false,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  else
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_INVALID_DECISION';
  end if;

  return v_result;
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_HANDLE_CONFLICT';
end
$$;


ALTER FUNCTION "public"."review_live_room_social_verification"("p_admin_user_id" "uuid", "p_public_request_id" "uuid", "p_decision" "text", "p_review_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_filings_v2"("p_query" "text" DEFAULT NULL::"text", "p_signals" "text"[] DEFAULT '{}'::"text"[], "p_market_caps" "text"[] DEFAULT '{}'::"text"[], "p_form_types" "text"[] DEFAULT '{}'::"text"[], "p_event_types" "text"[] DEFAULT '{}'::"text"[], "p_impacts" "text"[] DEFAULT '{}'::"text"[], "p_published_after" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_published_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_id" "uuid" DEFAULT NULL::"uuid", "p_include_total" boolean DEFAULT true, "p_limit" integer DEFAULT 25) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $_$
with normalized as (
  select
    e.*,
    coalesce(nullif(e.metadata ->> 'form_type', ''), 'SEC filing') as form_type,
    coalesce(
      nullif(e.metadata ->> 'issuer', ''),
      nullif(e.metadata ->> 'company_name', ''),
      nullif(e.metadata ->> 'company', ''),
      e.ticker,
      'Issuer not available'
    ) as issuer,
    coalesce(
      nullif(e.metadata ->> 'accession_number', ''),
      nullif(e.metadata ->> 'accession', ''),
      ''
    ) as accession_number,
    case
      when cap.normalized_value ~ '^[0-9]+(\.[0-9]+)?[KMBT]?$' then
        (regexp_match(cap.normalized_value, '^([0-9]+(?:\.[0-9]+)?)([KMBT]?)$'))[1]::numeric
        * case (regexp_match(cap.normalized_value, '^([0-9]+(?:\.[0-9]+)?)([KMBT]?)$'))[2]
            when 'T' then 1000000000000
            when 'B' then 1000000000
            when 'M' then 1000000
            when 'K' then 1000
            else 1
          end
      else null
    end as market_cap,
    array(
      select distinct mapped.event_tag
      from (
        select case lower(raw.event_type)
          when 'earnings' then 'earnings'
          when 'insider' then 'insider'
          when 'insider_ownership' then 'insider'
          when 'offering' then 'offering'
          when 'securities_offering' then 'offering'
          when 'dilution' then 'dilution'
          when 'dilution_risk' then 'dilution'
          when 'ipo_listing' then 'listing'
          when 'listing' then 'listing'
          when 'listing_risk' then 'listing'
          when 'financial_risk' then 'legal'
          when 'legal' then 'legal'
          when 'legal_risk' then 'legal'
          when 'ma' then 'ma'
          when 'strategic_transaction' then 'ma'
          when 'governance' then 'governance'
          when 'leadership_governance' then 'governance'
          when 'shareholder_vote' then 'governance'
          when 'fda' then 'fda'
          when 'fda_clinical' then 'fda'
          when 'operating_update' then 'operating'
          when 'capital_return' then 'capital_return'
          when 'dividends' then 'capital_return'
          else null
        end as event_tag
        from (
          select e.event_type
          union all
          select coalesce(
            material_event ->> 'event_type',
            material_event ->> 'type',
            material_event ->> 'category'
          )
          from jsonb_array_elements(
            case
              when jsonb_typeof(e.metadata -> 'material_events') = 'array'
                then e.metadata -> 'material_events'
              else '[]'::jsonb
            end
          ) as material_event
        ) as raw
      ) as mapped
      where mapped.event_tag is not null
    ) as event_tags
  from public.events e
  cross join lateral (
    select upper(
      regexp_replace(
        coalesce(
          nullif(e.metadata -> 'market_context' ->> 'market_cap', ''),
          nullif(e.metadata -> 'analysis_output' -> 'market_context' ->> 'market_cap', ''),
          nullif(e.metadata -> 'display_payload' -> 'data' -> 'market_context' ->> 'market_cap', '')
        ),
        '[$,\s]',
        '',
        'g'
      )
    ) as normalized_value
  ) as cap
  where e.source_group = 'filings'
    and e.delivery_level <> 'archive'
    and e.published_at is not null
),
filtered as (
  select n.*
  from normalized n
  where (
      coalesce(array_length(p_signals, 1), 0) = 0
      or n.signal::text = any(p_signals)
    )
    and (
      coalesce(array_length(p_form_types, 1), 0) = 0
      or n.form_type = any(p_form_types)
    )
    and (
      coalesce(array_length(p_event_types, 1), 0) = 0
      or n.event_tags && p_event_types
    )
    and (
      coalesce(array_length(p_impacts, 1), 0) = 0
      or ('Alerts 75+' = any(p_impacts) and n.score >= 75)
      or ('50-74' = any(p_impacts) and n.score between 50 and 74)
    )
    and (
      coalesce(array_length(p_market_caps, 1), 0) = 0
      or ('Mega' = any(p_market_caps) and n.market_cap >= 50000000000)
      or ('Large' = any(p_market_caps) and n.market_cap >= 10000000000 and n.market_cap < 50000000000)
      or ('Mid' = any(p_market_caps) and n.market_cap >= 1000000000 and n.market_cap < 10000000000)
      or ('Small' = any(p_market_caps) and n.market_cap >= 50000000 and n.market_cap < 1000000000)
      or ('Micro' = any(p_market_caps) and n.market_cap > 0 and n.market_cap < 50000000)
    )
    and (p_published_after is null or n.published_at >= p_published_after)
    and (
      nullif(btrim(p_query), '') is null
      or concat_ws(
        ' ',
        n.ticker,
        n.issuer,
        n.form_type,
        n.title,
        n.quick_take,
        n.summary,
        n.accession_number,
        array_to_string(n.event_tags, ' ')
      ) ilike '%' || btrim(p_query) || '%'
    )
),
paged as (
  select f.*
  from filtered f
  where p_cursor_published_at is null
    or p_cursor_id is null
    or (f.published_at, f.id) < (p_cursor_published_at, p_cursor_id)
  order by f.published_at desc, f.id desc
  limit least(greatest(p_limit, 1), 25) + 1
),
visible_page as (
  select p.*
  from paged p
  order by p.published_at desc, p.id desc
  limit least(greatest(p_limit, 1), 25)
)
select jsonb_build_object(
  'records',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'source_code', v.source_code,
          'source_name', v.source_name,
          'source_url', v.source_url,
          'published_at', v.published_at,
          'detected_at', v.detected_at,
          'ticker', v.ticker,
          'event_type', v.event_type,
          'event_tags', v.event_tags,
          'score', v.score,
          'signal', v.signal,
          'title', v.title,
          'quick_take', v.quick_take,
          'summary', v.summary,
          'form_type', v.form_type,
          'issuer', v.issuer,
          'accession_number', v.accession_number,
          'market_cap', v.market_cap,
          'price', coalesce(
            v.metadata -> 'market_context' -> 'price',
            v.metadata -> 'analysis_output' -> 'market_context' -> 'price',
            v.metadata -> 'display_payload' -> 'data' -> 'market_context' -> 'price'
          ),
          'change_percent', coalesce(
            v.metadata -> 'market_context' -> 'change_percent',
            v.metadata -> 'analysis_output' -> 'market_context' -> 'change_percent',
            v.metadata -> 'display_payload' -> 'data' -> 'market_context' -> 'change_percent'
          ),
          'metadata', jsonb_strip_nulls(
            jsonb_build_object(
              'key_evidence', v.metadata -> 'key_evidence',
              'key_points', v.metadata -> 'key_points',
              'analysis_output', jsonb_strip_nulls(
                jsonb_build_object(
                  'key_evidence', v.metadata -> 'analysis_output' -> 'key_evidence',
                  'key_points', v.metadata -> 'analysis_output' -> 'key_points'
                )
              ),
              'display_payload', jsonb_build_object(
                'data', jsonb_strip_nulls(
                  jsonb_build_object(
                    'key_evidence', v.metadata -> 'display_payload' -> 'data' -> 'key_evidence',
                    'key_points', v.metadata -> 'display_payload' -> 'data' -> 'key_points',
                    'key_changes', v.metadata -> 'display_payload' -> 'data' -> 'key_changes'
                  )
                )
              ),
              'material_events', v.metadata -> 'material_events',
              'related_filing_contexts', v.metadata -> 'related_filing_contexts',
              'related_filings', v.metadata -> 'related_filings',
              'related_events', v.metadata -> 'related_events'
            )
          )
        )
        order by v.published_at desc, v.id desc
      )
      from visible_page v
    ),
    '[]'::jsonb
  ),
  'total',
  case when p_include_total then (select count(*) from filtered) else null end,
  'has_more',
  (select count(*) from paged) > least(greatest(p_limit, 1), 25),
  'next_cursor',
  (
    select jsonb_build_object('published_at', v.published_at, 'id', v.id)
    from visible_page v
    order by v.published_at asc, v.id asc
    limit 1
  )
);
$_$;


ALTER FUNCTION "public"."search_filings_v2"("p_query" "text", "p_signals" "text"[], "p_market_caps" "text"[], "p_form_types" "text"[], "p_event_types" "text"[], "p_impacts" "text"[], "p_published_after" timestamp with time zone, "p_cursor_published_at" timestamp with time zone, "p_cursor_id" "uuid", "p_include_total" boolean, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_news_v2"("p_query" "text" DEFAULT NULL::"text", "p_signals" "text"[] DEFAULT '{}'::"text"[], "p_market_caps" "text"[] DEFAULT '{}'::"text"[], "p_event_types" "text"[] DEFAULT '{}'::"text"[], "p_sources" "text"[] DEFAULT '{}'::"text"[], "p_sectors" "text"[] DEFAULT '{}'::"text"[], "p_themes" "text"[] DEFAULT '{}'::"text"[], "p_cursor_published_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_id" "uuid" DEFAULT NULL::"uuid", "p_include_total" boolean DEFAULT true, "p_limit" integer DEFAULT 25) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
with bounds as (
  select
    current_timestamp as as_of,
    date_trunc(
      'day',
      current_timestamp at time zone 'America/New_York'
    ) at time zone 'America/New_York' as today_start
),
normalized as not materialized (
  select
    e.id,
    e.source_code,
    public.news_v2_source_label(e.source_code, e.source_name) as source_label,
    coalesce(e.published_at, e.detected_at) as effective_published_at,
    nullif(upper(btrim(e.ticker)), '') as ticker,
    coalesce(nullif(lower(btrim(e.event_type)), ''), 'event') as event_type,
    coalesce(e.score, 50) as score,
    coalesce(nullif(lower(btrim(e.signal::text)), ''), 'neutral') as signal,
    coalesce(nullif(lower(btrim(e.market_scope::text)), ''), 'company') as market_scope,
    nullif(btrim(e.sector), '') as sector,
    nullif(btrim(e.theme_group), '') as theme_group,
    nullif(btrim(e.sub_theme), '') as sub_theme,
    coalesce(nullif(e.title, ''), 'Untitled event') as title,
    coalesce(nullif(e.quick_take, ''), nullif(e.summary, ''), 'No summary available yet.') as summary,
    public.news_v2_search_document(
      e.ticker,
      e.metadata ->> 'company_name',
      e.metadata ->> 'company',
      e.metadata ->> 'issuer',
      e.source_code,
      e.source_name,
      e.event_type,
      e.sector,
      e.theme_group,
      e.sub_theme,
      e.title,
      e.summary,
      e.quick_take
    ) as search_document,
    e.delivery_level,
    t.market_cap,
    case
      when t.market_cap >= 200000000000 then 'Mega'
      when t.market_cap >= 10000000000 then 'Large'
      when t.market_cap >= 2000000000 then 'Mid'
      when t.market_cap >= 300000000 then 'Small'
      when t.market_cap > 0 then 'Micro'
      else null
    end as market_cap_band
  from public.events e
  left join public.tickers t
    on t.symbol = nullif(upper(btrim(e.ticker)), '')
  where e.source_group = 'news'
    and e.delivery_level <> 'archive'
    and (
      coalesce(
        nullif(lower(btrim(e.market_scope::text)), ''),
        'company'
      ) not in ('sector', 'theme', 'macro')
      or coalesce(e.score, 50) >= 75
    )
    and coalesce(e.published_at, e.detected_at) is not null
),
stats_filtered as materialized (
  select n.*
  from normalized n
  where p_include_total
    and (
      coalesce(array_length(p_signals, 1), 0) = 0
      or n.signal = any(p_signals)
    )
    and (
      coalesce(array_length(p_market_caps, 1), 0) = 0
      or n.market_cap_band = any(p_market_caps)
    )
    and (
      coalesce(array_length(p_event_types, 1), 0) = 0
      or n.event_type = any(p_event_types)
    )
    and (
      coalesce(array_length(p_sources, 1), 0) = 0
      or n.source_label = any(p_sources)
    )
    and (
      coalesce(array_length(p_sectors, 1), 0) = 0
      or n.sector = any(p_sectors)
    )
    and (
      coalesce(array_length(p_themes, 1), 0) = 0
      or n.theme_group = any(p_themes)
      or n.sub_theme = any(p_themes)
    )
    and (
      nullif(btrim(p_query), '') is null
      or n.search_document like '%' || lower(btrim(p_query)) || '%'
    )
),
paged as (
  select n.*
  from normalized n
  where (
      coalesce(array_length(p_signals, 1), 0) = 0
      or n.signal = any(p_signals)
    )
    and (
      coalesce(array_length(p_market_caps, 1), 0) = 0
      or n.market_cap_band = any(p_market_caps)
    )
    and (
      coalesce(array_length(p_event_types, 1), 0) = 0
      or n.event_type = any(p_event_types)
    )
    and (
      coalesce(array_length(p_sources, 1), 0) = 0
      or n.source_label = any(p_sources)
    )
    and (
      coalesce(array_length(p_sectors, 1), 0) = 0
      or n.sector = any(p_sectors)
    )
    and (
      coalesce(array_length(p_themes, 1), 0) = 0
      or n.theme_group = any(p_themes)
      or n.sub_theme = any(p_themes)
    )
    and (
      nullif(btrim(p_query), '') is null
      or n.search_document like '%' || lower(btrim(p_query)) || '%'
    )
    and (
      p_cursor_published_at is null
      or p_cursor_id is null
      or (n.effective_published_at, n.id) < (p_cursor_published_at, p_cursor_id)
    )
  order by n.effective_published_at desc, n.id desc
  limit least(greatest(p_limit, 1), 25) + 1
),
visible_page as (
  select p.*
  from paged p
  order by p.effective_published_at desc, p.id desc
  limit least(greatest(p_limit, 1), 25)
),
source_groups as (
  select
    f.source_label,
    count(*) as total_count,
    round(avg(f.score))::integer as average_score,
    count(*) filter (
      where f.effective_published_at >= b.today_start
        and f.effective_published_at <= b.as_of
    ) as today_count,
    count(*) filter (
      where f.effective_published_at >= b.as_of - interval '5 days'
        and f.effective_published_at <= b.as_of
    ) as five_day_count,
    count(*) filter (
      where f.effective_published_at >= b.as_of - interval '1 month'
        and f.effective_published_at <= b.as_of
    ) as one_month_count,
    count(*) filter (
      where f.effective_published_at >= b.as_of - interval '3 months'
        and f.effective_published_at <= b.as_of
    ) as three_month_count
  from stats_filtered f
  cross join bounds b
  group by f.source_label
),
recent_themes as (
  select f.*
  from stats_filtered f
  cross join bounds b
  where f.theme_group is not null
    and f.effective_published_at >= b.as_of - interval '1 month'
    and f.effective_published_at <= b.as_of
),
theme_groups as (
  select
    theme_group,
    count(*) as event_count,
    round(avg(score))::integer as average_score,
    count(*) filter (where score >= 75) as high_impact_count,
    count(*) filter (where signal = 'bullish') as bullish_count,
    count(*) filter (where signal = 'bearish') as bearish_count,
    count(*) filter (where signal = 'neutral') as neutral_count,
    count(*) filter (where signal = 'volatile') as volatile_count
  from recent_themes
  group by theme_group
),
sub_theme_groups as (
  select
    theme_group,
    sub_theme,
    count(*) as event_count,
    round(avg(score))::integer as average_score,
    count(*) filter (where score >= 75) as high_impact_count,
    count(*) filter (where signal = 'bullish') as bullish_count,
    count(*) filter (where signal = 'bearish') as bearish_count,
    count(*) filter (where signal = 'neutral') as neutral_count,
    count(*) filter (where signal = 'volatile') as volatile_count
  from recent_themes
  where sub_theme is not null
  group by theme_group, sub_theme
)
select jsonb_build_object(
  'items',
  coalesce(
    (
      select jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'id', v.id,
            'published_at', v.effective_published_at,
            'headline', v.title,
            'summary', v.summary,
            'source', v.source_label,
            'ticker', v.ticker,
            'signal', v.signal,
            'score', v.score,
            'market_scope', v.market_scope,
            'sector', v.sector,
            'theme_group', v.theme_group,
            'sub_theme', v.sub_theme,
            'event_type', v.event_type,
            'market_cap', v.market_cap,
            'market_cap_band', v.market_cap_band,
            'delivery_level', v.delivery_level
          )
        )
        order by v.effective_published_at desc, v.id desc
      )
      from visible_page v
    ),
    '[]'::jsonb
  ),
  'total',
  case when p_include_total then (select count(*) from stats_filtered) else null end,
  'has_more',
  (select count(*) from paged) > least(greatest(p_limit, 1), 25),
  'next_cursor',
  (
    select jsonb_build_object('published_at', v.effective_published_at, 'id', v.id)
    from visible_page v
    order by v.effective_published_at asc, v.id asc
    limit 1
  ),
  'statistics',
  case
    when not p_include_total then null
    else jsonb_build_object(
      'as_of', (select b.as_of from bounds b),
      'range_time_zone', 'America/New_York',
      'source_activity',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'source', source_label,
              'count', total_count,
              'average_score', average_score,
              'range_counts', jsonb_build_object(
                'Today', today_count,
                '5D', five_day_count,
                '1M', one_month_count,
                '3M', three_month_count
              )
            )
            order by total_count desc, average_score desc, source_label
          )
          from source_groups
        ),
        '[]'::jsonb
      ),
      'theme_activity',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'theme_group', groups.theme_group,
              'count', groups.event_count,
              'average_score', groups.average_score,
              'high_impact_count', groups.high_impact_count,
              'signal_counts', jsonb_build_object(
                'bullish', groups.bullish_count,
                'bearish', groups.bearish_count,
                'neutral', groups.neutral_count,
                'volatile', groups.volatile_count
              ),
              'sub_themes', coalesce(
                (
                  select jsonb_agg(
                    jsonb_build_object(
                      'sub_theme', sub_groups.sub_theme,
                      'count', sub_groups.event_count,
                      'average_score', sub_groups.average_score,
                      'high_impact_count', sub_groups.high_impact_count,
                      'signal_counts', jsonb_build_object(
                        'bullish', sub_groups.bullish_count,
                        'bearish', sub_groups.bearish_count,
                        'neutral', sub_groups.neutral_count,
                        'volatile', sub_groups.volatile_count
                      )
                    )
                    order by sub_groups.event_count desc, sub_groups.average_score desc, sub_groups.sub_theme
                  )
                  from sub_theme_groups sub_groups
                  where sub_groups.theme_group = groups.theme_group
                ),
                '[]'::jsonb
              )
            )
            order by groups.event_count desc, groups.average_score desc, groups.theme_group
          )
          from theme_groups groups
        ),
        '[]'::jsonb
      )
    )
  end
);
$$;


ALTER FUNCTION "public"."search_news_v2"("p_query" "text", "p_signals" "text"[], "p_market_caps" "text"[], "p_event_types" "text"[], "p_sources" "text"[], "p_sectors" "text"[], "p_themes" "text"[], "p_cursor_published_at" timestamp with time zone, "p_cursor_id" "uuid", "p_include_total" boolean, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_live_room_direct_message"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_body" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_conversation public.live_room_direct_conversations%rowtype;
  v_message_id uuid;
  v_now timestamptz := now();
  v_peer_user_id uuid;
  v_risk_flags text[] := '{}'::text[];
  v_risk_score smallint := 0;
begin
  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    )
  for update;

  if not found then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_peer_user_id := case
    when v_conversation.member_low_user_id = p_requester_user_id
      then v_conversation.member_high_user_id
    else v_conversation.member_low_user_id
  end;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  if v_conversation.status <> 'accepted' then
    raise exception 'LIVE_ROOM_DIRECT_READ_ONLY';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_requester_user_id::text, 0)
  );

  if v_body = '' then
    raise exception 'LIVE_ROOM_EMPTY';
  end if;

  if char_length(v_body) > 600 then
    raise exception 'LIVE_ROOM_MAX_LENGTH';
  end if;

  if regexp_count(v_body, '\m(https?://|www\.)', 1, 'i') > 2 then
    raise exception 'LIVE_ROOM_EXCESSIVE_LINKS';
  end if;

  if exists (
    select 1
    from public.live_room_direct_messages as recent
    where recent.sender_user_id = p_requester_user_id
      and recent.created_at >= v_now - interval '120 seconds'
      and lower(regexp_replace(recent.body, '[[:space:]]+', ' ', 'g'))
        = lower(regexp_replace(v_body, '[[:space:]]+', ' ', 'g'))
  ) then
    raise exception 'LIVE_ROOM_DUPLICATE';
  end if;

  if (
    select count(*)
    from public.live_room_direct_messages as recent
    where recent.sender_user_id = p_requester_user_id
      and recent.created_at >= v_now - interval '20 seconds'
  ) >= 3 then
    raise exception 'LIVE_ROOM_RATE_LIMIT';
  end if;

  if v_body ~* '(telegram|텔레그램|whats\s*app|왓츠앱|kakao\s*talk|카카오톡|discord|디스코드)' then
    v_risk_flags := array_append(v_risk_flags, 'off_platform_contact');
  end if;
  if v_body ~* '(wire transfer|bank transfer|deposit|account number|송금|입금|계좌\s*번호|계좌번호)' then
    v_risk_flags := array_append(v_risk_flags, 'money_transfer');
  end if;
  if v_body ~* '(guaranteed?\s+(return|profit)|risk[- ]?free profit|수익\s*보장|원금\s*보장|확정\s*수익)' then
    v_risk_flags := array_append(v_risk_flags, 'guaranteed_return');
  end if;
  if v_body ~* '(paid\s+(room|group)|vip\s*(room|group)|premium\s+signals?|유료\s*방|유료방|vip\s*방|리딩\s*방)' then
    v_risk_flags := array_append(v_risk_flags, 'paid_room');
  end if;
  if v_body ~* '(wallet\s*address|send\s+(btc|eth|usdt|crypto)|crypto\s+transfer|지갑\s*주소|암호화폐\s*전송|코인\s*전송)' then
    v_risk_flags := array_append(v_risk_flags, 'crypto_wallet');
  end if;
  if (
    regexp_count(
      v_body,
      '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
      1,
      'i'
    )
    + regexp_count(v_body, '\+?[0-9][0-9 ()-]{7,}[0-9]', 1, 'i')
    >= 2
    or (
      regexp_count(
        v_body,
        '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
        1,
        'i'
      )
      + regexp_count(v_body, '\+?[0-9][0-9 ()-]{7,}[0-9]', 1, 'i')
      >= 1
      and exists (
        select 1
        from public.live_room_direct_messages as recent
        where recent.sender_user_id = p_requester_user_id
          and recent.created_at >= v_now - interval '120 seconds'
          and (
            regexp_count(
              recent.body,
              '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
              1,
              'i'
            )
            + regexp_count(
              recent.body,
              '\+?[0-9][0-9 ()-]{7,}[0-9]',
              1,
              'i'
            )
          ) >= 1
      )
    )
  )
  then
    v_risk_flags := array_append(v_risk_flags, 'repeated_contact');
  end if;
  v_risk_score := least(100, cardinality(v_risk_flags) * 20);

  insert into public.live_room_direct_messages (
    conversation_id,
    sender_user_id,
    body,
    message_kind,
    risk_flags,
    risk_score,
    created_at
  )
  values (
    v_conversation.id,
    p_requester_user_id,
    v_body,
    'chat',
    v_risk_flags,
    v_risk_score,
    v_now
  )
  returning id into v_message_id;

  update public.live_room_direct_conversations
  set updated_at = v_now
  where id = v_conversation.id;

  insert into public.live_room_direct_reads (
    conversation_id,
    member_user_id,
    last_read_message_id,
    last_read_at,
    updated_at
  )
  values (
    v_conversation.id,
    p_requester_user_id,
    v_message_id,
    v_now,
    v_now
  )
  on conflict (conversation_id, member_user_id)
  do update set
    last_read_message_id = excluded.last_read_message_id,
    last_read_at = excluded.last_read_at,
    updated_at = excluded.updated_at;

  return v_message_id;
end;
$$;


ALTER FUNCTION "public"."send_live_room_direct_message"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_alert_delivery_event_runs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_alert_delivery_event_runs_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_follows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "actor_kind" "text" NOT NULL,
    "member_user_id" "uuid",
    "guest_session_id" "uuid",
    "actor_id" "uuid" GENERATED ALWAYS AS (COALESCE("member_user_id", "guest_session_id")) STORED,
    "followed" boolean DEFAULT true NOT NULL,
    "notification_scope" "text" DEFAULT 'new_chat_messages'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_read_message_id" "uuid",
    CONSTRAINT "live_room_follows_actor_kind_check" CHECK (("actor_kind" = ANY (ARRAY['member'::"text", 'guest'::"text"]))),
    CONSTRAINT "live_room_follows_check" CHECK (((("actor_kind" = 'member'::"text") AND ("member_user_id" IS NOT NULL) AND ("guest_session_id" IS NULL)) OR (("actor_kind" = 'guest'::"text") AND ("guest_session_id" IS NOT NULL) AND ("member_user_id" IS NULL)))),
    CONSTRAINT "live_room_follows_notification_scope_check" CHECK (("notification_scope" = 'new_chat_messages'::"text"))
);


ALTER TABLE "public"."live_room_follows" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_follows" IS 'Saved Live Rooms and per-actor chat read cursors. This table is not part of paid news/filing Alerts delivery.';



CREATE OR REPLACE FUNCTION "public"."set_live_room_chat_follow"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_followed" boolean) RETURNS SETOF "public"."live_room_follows"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_latest_message_id uuid;
  v_latest_message_at timestamptz;
  v_follow public.live_room_follows%rowtype;
begin
  if p_followed is null then
    raise exception 'LIVE_ROOM_INVALID_FOLLOW';
  end if;

  if not (
    (
      p_actor_kind = 'member'
      and p_member_user_id is not null
      and p_guest_session_id is null
    )
    or
    (
      p_actor_kind = 'guest'
      and p_member_user_id is null
      and p_guest_session_id is not null
    )
  ) then
    raise exception 'LIVE_ROOM_INVALID_ACTOR';
  end if;

  if p_followed then
    select message.id, message.created_at
    into v_latest_message_id, v_latest_message_at
    from public.live_room_messages as message
    where message.room_id = p_room_id
      and message.visibility_status = 'visible'
    order by message.created_at desc, message.id desc
    limit 1;
  end if;

  insert into public.live_room_follows as existing_follow (
    room_id,
    actor_kind,
    member_user_id,
    guest_session_id,
    followed,
    notification_scope,
    last_read_at,
    last_read_message_id
  )
  values (
    p_room_id,
    p_actor_kind,
    p_member_user_id,
    p_guest_session_id,
    p_followed,
    'new_chat_messages',
    coalesce(v_latest_message_at, now()),
    v_latest_message_id
  )
  on conflict (room_id, actor_kind, actor_id)
  do update set
    followed = excluded.followed,
    notification_scope = 'new_chat_messages',
    last_read_at = case
      when excluded.followed then excluded.last_read_at
      else existing_follow.last_read_at
    end,
    last_read_message_id = case
      when excluded.followed then excluded.last_read_message_id
      else existing_follow.last_read_message_id
    end
  returning * into v_follow;

  return next v_follow;
end
$$;


ALTER FUNCTION "public"."set_live_room_chat_follow"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_followed" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_live_room_direct_message_settings"("p_member_user_id" "uuid", "p_receive_mode" "text", "p_request_filter" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_can_use_selective_filters boolean;
begin
  if p_receive_mode not in (
    'mutual_only',
    'people_i_follow',
    'followers',
    'everyone',
    'nobody'
  ) then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_RECEIVE_MODE';
  end if;

  if p_request_filter not in (
    'any',
    'moderators',
    'verified',
    'pro_members'
  ) then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_REQUEST_FILTER';
  end if;

  v_can_use_selective_filters :=
    exists (
      select 1
      from public.live_room_social_verifications as verification
      where verification.member_user_id = p_member_user_id
        and verification.status = 'verified'
    )
    or exists (
      select 1
      from public.live_room_moderators as moderator
      where moderator.user_id = p_member_user_id
        and moderator.active = true
        and moderator.role in ('moderator', 'admin')
    );

  if p_request_filter <> 'any'
    and not v_can_use_selective_filters
  then
    raise exception 'LIVE_ROOM_DIRECT_SELECTIVE_FILTER_FORBIDDEN';
  end if;

  insert into public.live_room_direct_message_settings (
    member_user_id,
    receive_mode,
    request_filter,
    updated_at
  )
  values (
    p_member_user_id,
    p_receive_mode,
    p_request_filter,
    now()
  )
  on conflict (member_user_id)
  do update set
    receive_mode = excluded.receive_mode,
    request_filter = excluded.request_filter,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'receiveMode', p_receive_mode,
    'requestFilter', p_request_filter,
    'canUseSelectiveFilters', v_can_use_selective_filters
  );
end;
$$;


ALTER FUNCTION "public"."set_live_room_direct_message_settings"("p_member_user_id" "uuid", "p_receive_mode" "text", "p_request_filter" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_live_room_member_follow"("p_follower_user_id" "uuid", "p_room_id" "uuid", "p_message_id" "uuid", "p_followed" boolean) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_followed_user_id uuid;
  v_latest_message_id uuid;
  v_latest_message_at timestamptz;
begin
  if p_followed is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_MEMBER_FOLLOW';
  end if;

  select message.member_user_id
  into v_followed_user_id
  from public.live_room_messages as message
  where message.id = p_message_id
    and message.room_id = p_room_id
    and message.author_kind = 'member'
    and message.member_user_id is not null
    and message.visibility_status = 'visible';

  if v_followed_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_NOT_FOLLOWABLE';
  end if;

  if v_followed_user_id = p_follower_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_CANNOT_FOLLOW_SELF';
  end if;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocker_member_user_id = p_follower_user_id
      and block.blocked_kind = 'member'
      and block.blocked_member_user_id = v_followed_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_NOT_FOLLOWABLE';
  end if;

  if not p_followed then
    delete from public.live_room_member_follows as follow
    where follow.follower_user_id = p_follower_user_id
      and follow.followed_user_id = v_followed_user_id;
    return false;
  end if;

  select message.id, message.created_at
  into v_latest_message_id, v_latest_message_at
  from public.live_room_messages as message
  join public.live_room_rooms as room
    on room.id = message.room_id
  where room.room_kind = 'company'
    and message.author_kind = 'member'
    and message.member_user_id = v_followed_user_id
    and message.visibility_status = 'visible'
  order by message.created_at desc, message.id desc
  limit 1;

  insert into public.live_room_member_follows (
    follower_user_id,
    followed_user_id,
    last_read_at,
    last_read_message_id
  )
  values (
    p_follower_user_id,
    v_followed_user_id,
    coalesce(v_latest_message_at, now()),
    v_latest_message_id
  )
  on conflict (follower_user_id, followed_user_id)
  do nothing;

  return true;
end
$$;


ALTER FUNCTION "public"."set_live_room_member_follow"("p_follower_user_id" "uuid", "p_room_id" "uuid", "p_message_id" "uuid", "p_followed" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_live_room_member_presence_heartbeat"("p_member_user_id" "uuid", "p_ticker" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  v_show_presence boolean;
begin
  if p_member_user_id is null then
    raise exception 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;

  if p_ticker is null
    or p_ticker <> pg_catalog.upper(pg_catalog.btrim(p_ticker))
    or p_ticker !~ '^[A-Z0-9][A-Z0-9.-]{0,9}$'
  then
    raise exception 'LIVE_ROOM_PRESENCE_INVALID_TICKER';
  end if;

  select profile.show_presence
  into v_show_presence
  from public.live_room_member_profiles as profile
  where profile.user_id = p_member_user_id;

  if v_show_presence is distinct from true then
    delete from public.live_room_member_presence
    where member_user_id = p_member_user_id;
    return false;
  end if;

  insert into public.live_room_member_presence (
    member_user_id,
    ticker,
    last_seen_at,
    updated_at
  )
  values (
    p_member_user_id,
    p_ticker,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (member_user_id) do update
  set
    ticker = excluded.ticker,
    last_seen_at = pg_catalog.now(),
    updated_at = pg_catalog.now();

  return true;
end;
$_$;


ALTER FUNCTION "public"."set_live_room_member_presence_heartbeat"("p_member_user_id" "uuid", "p_ticker" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_live_room_presence_setting"("p_member_user_id" "uuid", "p_show_presence" boolean) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if p_member_user_id is null then
    raise exception 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;
  if p_show_presence is null then
    raise exception 'LIVE_ROOM_INVALID_PRESENCE_SETTING';
  end if;

  update public.live_room_member_profiles
  set show_presence = p_show_presence
  where user_id = p_member_user_id;

  if not found then
    raise exception 'LIVE_ROOM_PROFILE_UNAVAILABLE';
  end if;

  if not p_show_presence then
    delete from public.live_room_member_presence
    where member_user_id = p_member_user_id;
  end if;

  return p_show_presence;
end;
$$;


ALTER FUNCTION "public"."set_live_room_presence_setting"("p_member_user_id" "uuid", "p_show_presence" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_alert_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_user_alert_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_live_room_direct_conversation"("p_requester_user_id" "uuid", "p_source_message_id" "uuid", "p_body" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_conversation public.live_room_direct_conversations%rowtype;
  v_filter text;
  v_is_mutual boolean;
  v_is_request_allowed boolean;
  v_member_high uuid;
  v_member_low uuid;
  v_message_id uuid;
  v_now timestamptz := now();
  v_peer jsonb;
  v_peer_user_id uuid;
  v_recipient_can_use_selective_filters boolean;
  v_receive_mode text;
  v_risk_flags text[] := '{}'::text[];
  v_risk_score smallint := 0;
begin
  if p_requester_user_id is null or p_source_message_id is null then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_REQUEST';
  end if;

  select
    message.member_user_id,
    jsonb_build_object(
      'displayName', coalesce(profile.display_name, 'Member'),
      'emoji', coalesce(profile.emoji, '💬')
    )
  into v_peer_user_id, v_peer
  from public.live_room_messages as message
  join public.live_room_member_profiles as profile
    on profile.user_id = message.member_user_id
  where message.id = p_source_message_id
    and message.author_kind = 'member'
    and message.member_user_id is not null
    and message.visibility_status = 'visible';

  if v_peer_user_id is null then
    raise exception 'LIVE_ROOM_DIRECT_TARGET_NOT_FOUND';
  end if;

  if v_peer_user_id = p_requester_user_id then
    raise exception 'LIVE_ROOM_DIRECT_SELF';
  end if;

  if p_requester_user_id::text < v_peer_user_id::text then
    v_member_low := p_requester_user_id;
    v_member_high := v_peer_user_id;
  else
    v_member_low := v_peer_user_id;
    v_member_high := p_requester_user_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_member_low::text || ':' || v_member_high::text,
      0
    )
  );

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_BLOCKED';
  end if;

  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.member_low_user_id = v_member_low
    and conversation.member_high_user_id = v_member_high
  for update;

  v_is_mutual :=
    exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = p_requester_user_id
        and follow.followed_user_id = v_peer_user_id
    )
    and exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = v_peer_user_id
        and follow.followed_user_id = p_requester_user_id
    );

  if v_conversation.id is not null
    and v_conversation.status = 'accepted'
  then
    return jsonb_build_object(
      'mode', 'accepted',
      'conversationId', v_conversation.public_id,
      'peer', v_peer
    );
  end if;

  if v_is_mutual then
    if v_conversation.id is null then
      insert into public.live_room_direct_conversations (
        member_low_user_id,
        member_high_user_id,
        status,
        accepted_at,
        state_updated_at
      )
      values (
        v_member_low,
        v_member_high,
        'accepted',
        v_now,
        v_now
      )
      returning * into v_conversation;
    else
      update public.live_room_direct_conversations
      set status = 'accepted',
          accepted_at = v_now,
          declined_at = null,
          state_updated_at = v_now,
          updated_at = v_now
      where id = v_conversation.id
      returning * into v_conversation;
    end if;

    insert into public.live_room_direct_reads (
      conversation_id,
      member_user_id,
      last_read_at,
      updated_at
    )
    values
      (v_conversation.id, v_member_low, v_now, v_now),
      (v_conversation.id, v_member_high, v_now, v_now)
    on conflict (conversation_id, member_user_id) do nothing;

    return jsonb_build_object(
      'mode', 'accepted',
      'conversationId', v_conversation.public_id,
      'peer', v_peer
    );
  end if;

  if v_conversation.id is not null then
    if v_conversation.status = 'pending' then
      return jsonb_build_object(
        'mode', 'pending',
        'conversationId', v_conversation.public_id,
        'isRequestSender',
          v_conversation.request_sender_user_id = p_requester_user_id,
        'peer', v_peer
      );
    end if;
    raise exception 'LIVE_ROOM_DIRECT_REQUEST_UNAVAILABLE';
  end if;

  select
    coalesce(setting.receive_mode, 'followers'),
    coalesce(setting.request_filter, 'any')
  into v_receive_mode, v_filter
  from (select 1) as singleton
  left join public.live_room_direct_message_settings as setting
    on setting.member_user_id = v_peer_user_id;

  v_recipient_can_use_selective_filters :=
    exists (
      select 1
      from public.live_room_social_verifications as verification
      where verification.member_user_id = v_peer_user_id
        and verification.status = 'verified'
    )
    or exists (
      select 1
      from public.live_room_moderators as moderator
      where moderator.user_id = v_peer_user_id
        and moderator.active = true
        and moderator.role in ('moderator', 'admin')
    );

  if not v_recipient_can_use_selective_filters then
    v_filter := 'any';
  end if;

  v_is_request_allowed := case v_receive_mode
    when 'people_i_follow' then exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = v_peer_user_id
        and follow.followed_user_id = p_requester_user_id
    )
    when 'followers' then exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = p_requester_user_id
        and follow.followed_user_id = v_peer_user_id
    )
    when 'everyone' then true
    else false
  end;

  if v_is_request_allowed then
    v_is_request_allowed := case v_filter
      when 'any' then true
      when 'moderators' then exists (
        select 1
        from public.live_room_moderators as moderator
        where moderator.user_id = p_requester_user_id
          and moderator.active = true
          and moderator.role in ('moderator', 'admin')
      )
      when 'verified' then exists (
        select 1
        from public.live_room_social_verifications as verification
        where verification.member_user_id = p_requester_user_id
          and verification.status = 'verified'
      )
      when 'pro_members' then exists (
        select 1
        from public.user_plan_subscriptions as subscription
        where subscription.user_id = p_requester_user_id
          and (
            (
              subscription.status = 'active'
              and subscription.plan in ('pro', 'advanced', 'ultimate')
            )
            or (
              subscription.trial_plan in ('pro', 'advanced')
              and subscription.trial_started_at is not null
              and subscription.trial_ends_at is not null
              and subscription.trial_ends_at > v_now
            )
          )
      )
      else false
    end;
  end if;

  if not v_is_request_allowed then
    raise exception 'LIVE_ROOM_DIRECT_REQUEST_UNAVAILABLE';
  end if;

  if p_body is null then
    return jsonb_build_object(
      'mode', 'request_required',
      'conversationId', null,
      'peer', v_peer
    );
  end if;

  if v_body = '' then
    raise exception 'LIVE_ROOM_EMPTY';
  end if;

  if char_length(v_body) > 600 then
    raise exception 'LIVE_ROOM_MAX_LENGTH';
  end if;

  if v_body ~* (
    '(https?://|www\.|mailto:|'
    || '[a-z0-9][a-z0-9-]*\.(com|net|org|io|me|gg|co|kr)'
    || '([/[:space:]]|$))'
  ) then
    raise exception 'LIVE_ROOM_DIRECT_REQUEST_LINK';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_requester_user_id::text, 0)
  );

  if exists (
    select 1
    from public.live_room_direct_messages as recent
    where recent.sender_user_id = p_requester_user_id
      and recent.created_at >= v_now - interval '120 seconds'
      and lower(regexp_replace(recent.body, '[[:space:]]+', ' ', 'g'))
        = lower(regexp_replace(v_body, '[[:space:]]+', ' ', 'g'))
  ) then
    raise exception 'LIVE_ROOM_DUPLICATE';
  end if;

  if (
    select count(*)
    from public.live_room_direct_messages as recent
    where recent.sender_user_id = p_requester_user_id
      and recent.created_at >= v_now - interval '20 seconds'
  ) >= 3 then
    raise exception 'LIVE_ROOM_RATE_LIMIT';
  end if;

  if v_body ~* '(telegram|텔레그램|whats\s*app|왓츠앱|kakao\s*talk|카카오톡|discord|디스코드)' then
    v_risk_flags := array_append(v_risk_flags, 'off_platform_contact');
  end if;
  if v_body ~* '(wire transfer|bank transfer|deposit|account number|송금|입금|계좌\s*번호|계좌번호)' then
    v_risk_flags := array_append(v_risk_flags, 'money_transfer');
  end if;
  if v_body ~* '(guaranteed?\s+(return|profit)|risk[- ]?free profit|수익\s*보장|원금\s*보장|확정\s*수익)' then
    v_risk_flags := array_append(v_risk_flags, 'guaranteed_return');
  end if;
  if v_body ~* '(paid\s+(room|group)|vip\s*(room|group)|premium\s+signals?|유료\s*방|유료방|vip\s*방|리딩\s*방)' then
    v_risk_flags := array_append(v_risk_flags, 'paid_room');
  end if;
  if v_body ~* '(wallet\s*address|send\s+(btc|eth|usdt|crypto)|crypto\s+transfer|지갑\s*주소|암호화폐\s*전송|코인\s*전송)' then
    v_risk_flags := array_append(v_risk_flags, 'crypto_wallet');
  end if;
  if (
    regexp_count(
      v_body,
      '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
      1,
      'i'
    )
    + regexp_count(v_body, '\+?[0-9][0-9 ()-]{7,}[0-9]', 1, 'i')
    >= 2
    or (
      regexp_count(
        v_body,
        '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
        1,
        'i'
      )
      + regexp_count(v_body, '\+?[0-9][0-9 ()-]{7,}[0-9]', 1, 'i')
      >= 1
      and exists (
        select 1
        from public.live_room_direct_messages as recent
        where recent.sender_user_id = p_requester_user_id
          and recent.created_at >= v_now - interval '120 seconds'
          and (
            regexp_count(
              recent.body,
              '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
              1,
              'i'
            )
            + regexp_count(
              recent.body,
              '\+?[0-9][0-9 ()-]{7,}[0-9]',
              1,
              'i'
            )
          ) >= 1
      )
    )
  )
  then
    v_risk_flags := array_append(v_risk_flags, 'repeated_contact');
  end if;
  v_risk_score := least(100, cardinality(v_risk_flags) * 20);

  insert into public.live_room_direct_conversations (
    member_low_user_id,
    member_high_user_id,
    status,
    request_sender_user_id,
    request_created_at,
    accepted_at,
    declined_at,
    state_updated_at,
    updated_at
  )
  values (
    v_member_low,
    v_member_high,
    'pending',
    p_requester_user_id,
    v_now,
    null,
    null,
    v_now,
    v_now
  )
  returning * into v_conversation;

  insert into public.live_room_direct_messages (
    conversation_id,
    sender_user_id,
    body,
    message_kind,
    risk_flags,
    risk_score,
    created_at
  )
  values (
    v_conversation.id,
    p_requester_user_id,
    v_body,
    'request',
    v_risk_flags,
    v_risk_score,
    v_now
  )
  returning id into v_message_id;

  insert into public.live_room_direct_reads (
    conversation_id,
    member_user_id,
    last_read_message_id,
    last_read_at,
    updated_at
  )
  values
    (
      v_conversation.id,
      p_requester_user_id,
      v_message_id,
      v_now,
      v_now
    ),
    (
      v_conversation.id,
      v_peer_user_id,
      null,
      v_now - interval '1 microsecond',
      v_now
    );

  return jsonb_build_object(
    'mode', 'pending',
    'conversationId', v_conversation.public_id,
    'isRequestSender', true,
    'peer', v_peer
  );
end;
$_$;


ALTER FUNCTION "public"."start_live_room_direct_conversation"("p_requester_user_id" "uuid", "p_source_message_id" "uuid", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_live_room_post"("p_post_id" "uuid", "p_author_user_id" "uuid", "p_title" "text", "p_body" "text", "p_related_tickers" "text"[] DEFAULT ARRAY[]::"text"[], "p_referenced_event_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."live_room_posts"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_existing public.live_room_posts;
  v_result public.live_room_posts;
begin
  select post.*
  into v_existing
  from public.live_room_posts as post
  where post.id = p_post_id
  for update;

  if v_existing.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  if v_existing.author_user_id <> p_author_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_FORBIDDEN';
  end if;

  if v_existing.visibility_status <> 'visible' then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_EDITABLE';
  end if;

  -- Reuse the create validator without writing a duplicate row by validating
  -- the mutable values directly against the same table constraints and room.
  if not public.live_room_community_tickers_valid(
    coalesce(p_related_tickers, array[]::text[])
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_INVALID_TICKERS';
  end if;

  if p_referenced_event_id is not null and not exists (
    select 1
    from public.events as event
    join public.live_room_rooms as room
      on room.id = v_existing.room_id
    left join public.live_room_community_rooms as community
      on community.room_id = room.id
    where event.id = p_referenced_event_id
      and event.source_group::text in ('news', 'filings')
      and event.delivery_level::text <> 'archive'
      and (
        (
          room.room_kind = 'company'
          and pg_catalog.upper(pg_catalog.btrim(event.ticker)) = room.ticker
        )
        or
        (
          room.room_kind = 'community'
          and pg_catalog.upper(pg_catalog.btrim(event.ticker))
            = any(community.related_tickers)
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
  end if;

  update public.live_room_posts
  set
    title = pg_catalog.btrim(coalesce(p_title, '')),
    body = pg_catalog.btrim(coalesce(p_body, '')),
    related_tickers = coalesce(
      p_related_tickers,
      array[]::text[]
    ),
    referenced_event_id = p_referenced_event_id
  where id = p_post_id
  returning * into v_result;

  return v_result;
end
$$;


ALTER FUNCTION "public"."update_live_room_post"("p_post_id" "uuid", "p_author_user_id" "uuid", "p_title" "text", "p_body" "text", "p_related_tickers" "text"[], "p_referenced_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_live_room_post_comment"("p_comment_id" "uuid", "p_author_user_id" "uuid", "p_body" "text") RETURNS "public"."live_room_post_comments"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_comment public.live_room_post_comments;
begin
  update public.live_room_post_comments
  set body = pg_catalog.btrim(coalesce(p_body, ''))
  where id = p_comment_id
    and author_user_id = p_author_user_id
    and visibility_status = 'visible'
  returning * into v_comment;

  if v_comment.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_NOT_EDITABLE';
  end if;

  return v_comment;
end
$$;


ALTER FUNCTION "public"."update_live_room_post_comment"("p_comment_id" "uuid", "p_author_user_id" "uuid", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_live_room_post_cross_targets"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$ declare v_room public.live_room_rooms; v_invalid_tickers text[]; begin select room.* into v_room from public.live_room_rooms as room where room.id = new.room_id; if v_room.id is null then raise exception using errcode = 'P0001', message = 'LIVE_ROOM_UNAVAILABLE'; end if; if v_room.room_kind = 'company' and v_room.ticker = any(new.related_tickers) then raise exception using errcode = 'P0001', message = 'LIVE_ROOM_POST_PRIMARY_TICKER_DUPLICATE'; end if; select pg_catalog.array_agg(candidate order by candidate) into v_invalid_tickers from pg_catalog.unnest(new.related_tickers) as candidate where not exists (select 1 from public.tickers as ticker where pg_catalog.upper(pg_catalog.btrim(ticker.symbol)) = candidate and ticker.is_active is true); if coalesce(pg_catalog.cardinality(v_invalid_tickers), 0) > 0 then raise exception using errcode = 'P0001', message = 'LIVE_ROOM_POST_INVALID_TICKERS'; end if; return new; end $$;


ALTER FUNCTION "public"."validate_live_room_post_cross_targets"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_outputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ai_run_id" "uuid" NOT NULL,
    "event_id" "uuid",
    "output_type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_outputs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid",
    "raw_item_id" "uuid",
    "prompt_key" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "model" "text" NOT NULL,
    "status" "text" NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "usage" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."ai_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alert_delivery_event_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'processed'::"text" NOT NULL,
    "dry_run" boolean DEFAULT false NOT NULL,
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deliveries_created" integer DEFAULT 0 NOT NULL,
    "duplicates_skipped" integer DEFAULT 0 NOT NULL,
    "candidates_found" integer DEFAULT 0 NOT NULL,
    "suppressed_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "result_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "alert_delivery_event_runs_status_check" CHECK (("status" = ANY (ARRAY['processed'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."alert_delivery_event_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alert_delivery_job_locks" (
    "job_name" "text" NOT NULL,
    "locked_until" timestamp with time zone NOT NULL,
    "locked_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."alert_delivery_job_locks" OWNER TO "postgres";


COMMENT ON TABLE "public"."alert_delivery_job_locks" IS 'Lease table for alert delivery scheduler runs. Does not store alert payloads.';



CREATE TABLE IF NOT EXISTS "public"."alert_delivery_scheduler_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "dry_run" boolean DEFAULT true NOT NULL,
    "write_enabled" boolean DEFAULT false NOT NULL,
    "lock_acquired" boolean DEFAULT false NOT NULL,
    "lock_skipped" boolean DEFAULT false NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "duration_ms" integer,
    "batch_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "queued_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "alert_delivery_scheduler_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'success'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."alert_delivery_scheduler_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."alert_delivery_scheduler_runs" IS 'Execution log for protected alert delivery scheduler cron runs.';



CREATE TABLE IF NOT EXISTS "public"."alert_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "watchlist_news_enabled" boolean DEFAULT true NOT NULL,
    "watchlist_filings_enabled" boolean DEFAULT true NOT NULL,
    "watchlist_calendar_enabled" boolean DEFAULT true NOT NULL,
    "watchlist_risk_enabled" boolean DEFAULT true NOT NULL,
    "discovery_enabled" boolean DEFAULT true NOT NULL,
    "group_duplicates" boolean DEFAULT true NOT NULL,
    "cooldown_minutes" integer DEFAULT 60 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "alert_preferences_cooldown_minutes_check" CHECK (("cooldown_minutes" >= 0))
);


ALTER TABLE "public"."alert_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor" "text",
    "action" "text" NOT NULL,
    "target_type" "text",
    "target_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_logo_cache" (
    "symbol" "text" NOT NULL,
    "provider" "text" DEFAULT 'polygon'::"text" NOT NULL,
    "status" "text" NOT NULL,
    "logo_url" "text",
    "icon_url" "text",
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "last_error" "text",
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "company_logo_cache_raw_payload_check" CHECK (("jsonb_typeof"("raw_payload") = 'object'::"text")),
    CONSTRAINT "company_logo_cache_ready_url_check" CHECK ((("status" <> 'ready'::"text") OR (COALESCE(NULLIF("logo_url", ''::"text"), NULLIF("icon_url", ''::"text")) IS NOT NULL))),
    CONSTRAINT "company_logo_cache_status_check" CHECK (("status" = ANY (ARRAY['ready'::"text", 'missing'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."company_logo_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dashboard_extended_mover_snapshots" (
    "session" "text" NOT NULL,
    "mode" "text" NOT NULL,
    "market_date" "date" NOT NULL,
    "provider_as_of" timestamp with time zone,
    "captured_at" timestamp with time zone NOT NULL,
    "rows" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "data_availability" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source_count" integer DEFAULT 0 NOT NULL,
    "matching_count" integer DEFAULT 0 NOT NULL,
    "provider" "text" DEFAULT 'massive_full_market_snapshot'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_final" boolean DEFAULT false NOT NULL,
    "finalized_at" timestamp with time zone,
    CONSTRAINT "dashboard_extended_mover_snapshots_data_availability_check" CHECK (("jsonb_typeof"("data_availability") = 'object'::"text")),
    CONSTRAINT "dashboard_extended_mover_snapshots_matching_count_check" CHECK (("matching_count" >= 0)),
    CONSTRAINT "dashboard_extended_mover_snapshots_mode_check" CHECK (("mode" = ANY (ARRAY['gainers'::"text", 'losers'::"text", 'volume'::"text"]))),
    CONSTRAINT "dashboard_extended_mover_snapshots_rows_check" CHECK (("jsonb_typeof"("rows") = 'array'::"text")),
    CONSTRAINT "dashboard_extended_mover_snapshots_session_check" CHECK (("session" = ANY (ARRAY['Pre'::"text", 'After'::"text"]))),
    CONSTRAINT "dashboard_extended_mover_snapshots_source_count_check" CHECK (("source_count" >= 0))
);


ALTER TABLE "public"."dashboard_extended_mover_snapshots" OWNER TO "postgres";


COMMENT ON COLUMN "public"."dashboard_extended_mover_snapshots"."is_final" IS 'True after the pre-market or after-hours rankings have been frozen for the market date.';



CREATE TABLE IF NOT EXISTS "public"."dashboard_mover_snapshots" (
    "mode" "text" NOT NULL,
    "provider_as_of" timestamp with time zone,
    "captured_at" timestamp with time zone NOT NULL,
    "rows" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "data_availability" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "market_date" "date" NOT NULL,
    "is_final" boolean DEFAULT false NOT NULL,
    "finalized_at" timestamp with time zone,
    CONSTRAINT "dashboard_mover_snapshots_data_availability_check" CHECK (("jsonb_typeof"("data_availability") = 'object'::"text")),
    CONSTRAINT "dashboard_mover_snapshots_mode_check" CHECK (("mode" = ANY (ARRAY['gainers'::"text", 'losers'::"text", 'volume'::"text"]))),
    CONSTRAINT "dashboard_mover_snapshots_rows_check" CHECK (("jsonb_typeof"("rows") = 'array'::"text")),
    CONSTRAINT "dashboard_mover_snapshots_source_count_check" CHECK (("source_count" >= 0))
);


ALTER TABLE "public"."dashboard_mover_snapshots" OWNER TO "postgres";


COMMENT ON COLUMN "public"."dashboard_mover_snapshots"."is_final" IS 'True after the regular-session rankings have been frozen for the market date.';



CREATE TABLE IF NOT EXISTS "public"."dedupe_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_group" "public"."source_group" NOT NULL,
    "source_code" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "dedupe_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."dedupe_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "subscription_id" "uuid",
    "channel" "text" NOT NULL,
    "destination_code" "text",
    "status" "public"."delivery_status" DEFAULT 'pending'::"public"."delivery_status" NOT NULL,
    "attempted_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "error_message" "text",
    "provider_message_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_analysis" (
    "event_id" "uuid" NOT NULL,
    "analysis_scope" "text" DEFAULT 'company'::"text" NOT NULL,
    "why_it_matters" "text",
    "bullish_points" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "bearish_points" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "key_evidence" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "watch_next" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "event_analysis_analysis_scope_check" CHECK (("analysis_scope" = ANY (ARRAY['company'::"text", 'sector'::"text", 'theme'::"text", 'market'::"text"])))
);


ALTER TABLE "public"."event_analysis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_calendar_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_event_id" "uuid",
    "raw_item_id" "uuid",
    "source_code" "text",
    "source_group" "public"."source_group" NOT NULL,
    "ticker" "text",
    "company_name" "text",
    "calendar_event_type" "text" NOT NULL,
    "calendar_group" "text" NOT NULL,
    "calendar_title" "text" NOT NULL,
    "event_date" "date",
    "event_time" time without time zone,
    "event_timezone" "text",
    "date_precision" "text" DEFAULT 'exact'::"text" NOT NULL,
    "estimated_start_date" "date",
    "estimated_end_date" "date",
    "is_estimated" boolean DEFAULT false NOT NULL,
    "confidence" "text" DEFAULT 'medium'::"text" NOT NULL,
    "source_url" "text",
    "evidence" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "calendar_event_key" "text" NOT NULL,
    "calendar_status" "text" DEFAULT 'tentative'::"text" NOT NULL,
    "confirmation_source" "text" DEFAULT 'news'::"text" NOT NULL,
    "confirmed_at" timestamp with time zone,
    "confirmed_by_event_id" "uuid",
    "superseded_by_item_id" "uuid",
    CONSTRAINT "event_calendar_items_check" CHECK ((("event_date" IS NOT NULL) OR ("estimated_start_date" IS NOT NULL) OR ("estimated_end_date" IS NOT NULL))),
    CONSTRAINT "event_calendar_items_confidence_check" CHECK (("confidence" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "event_calendar_items_date_precision_check" CHECK (("date_precision" = ANY (ARRAY['exact'::"text", 'month'::"text", 'quarter'::"text", 'year'::"text", 'unknown'::"text"]))),
    CONSTRAINT "event_calendar_items_status_check" CHECK (("calendar_status" = ANY (ARRAY['tentative'::"text", 'confirmed'::"text", 'superseded'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."event_calendar_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "left_event_id" "uuid" NOT NULL,
    "right_event_id" "uuid" NOT NULL,
    "link_type" "text" DEFAULT 'same_underlying_event'::"text" NOT NULL,
    "link_confidence" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "event_links_no_self_link" CHECK (("left_event_id" <> "right_event_id"))
);


ALTER TABLE "public"."event_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_offering_terms" (
    "event_id" "uuid" NOT NULL,
    "raw_item_id" "uuid",
    "sec_form_type" "text",
    "prospectus_type" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "offering_type" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "security_type" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "primary_or_resale" "text" DEFAULT 'not_disclosed'::"text" NOT NULL,
    "registration_status" "text" DEFAULT 'not_disclosed'::"text" NOT NULL,
    "offering_amount_text" "text",
    "offering_amount" numeric(24,4),
    "offering_amount_currency" "text",
    "shelf_capacity_text" "text",
    "shelf_capacity" numeric(24,4),
    "shelf_capacity_currency" "text",
    "amount_remaining_text" "text",
    "amount_remaining" numeric(24,4),
    "amount_remaining_currency" "text",
    "atm_program_size_text" "text",
    "atm_program_size" numeric(24,4),
    "atm_program_size_currency" "text",
    "shares_offered_text" "text",
    "shares_offered" numeric(28,4),
    "resale_share_count_text" "text",
    "resale_share_count" numeric(28,4),
    "current_shares_outstanding_text" "text",
    "current_shares_outstanding" numeric(28,4),
    "public_float_text" "text",
    "public_float" numeric(28,4),
    "market_reference_price" numeric(24,8),
    "market_reference_price_source" "text",
    "market_context_as_of" timestamp with time zone,
    "market_cap" numeric(28,4),
    "market_cap_source" "text",
    "shares_outstanding_market" numeric(28,4),
    "shares_outstanding_market_source" "text",
    "public_float_market" numeric(28,4),
    "public_float_market_source" "text",
    "public_float_percent" numeric(12,4),
    "volume" numeric(28,4),
    "avg_volume" numeric(28,4),
    "market_context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "authorized_shares_text" "text",
    "authorized_shares" numeric(28,4),
    "offering_price_text" "text",
    "offering_price" numeric(24,8),
    "offering_price_currency" "text",
    "discount_to_market_percent" numeric(12,4),
    "discount_to_market_basis" "text",
    "warrant_coverage_text" "text",
    "warrant_coverage_ratio" numeric(18,8),
    "warrant_exercise_price_text" "text",
    "warrant_exercise_price" numeric(24,8),
    "warrant_exercise_price_currency" "text",
    "conversion_price_text" "text",
    "conversion_price" numeric(24,8),
    "conversion_price_currency" "text",
    "use_of_proceeds" "text",
    "sales_agent" "text",
    "selling_shareholders" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "effective_date" "date",
    "closing_date" "date",
    "estimated_dilution_percent" numeric(12,4),
    "float_overhang_percent" numeric(12,4),
    "offering_amount_percent_of_market_cap" numeric(12,4),
    "max_share_impact_percent" numeric(12,4),
    "dilution_scale" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "preliminary_score_floor" integer,
    "preliminary_score_cap" integer,
    "delivery_hint" "text",
    "score_policy_reasons" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "dilution_calculation_basis" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "overhang_level" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "dilution_risk_summary" "text",
    "next_trigger" "text",
    "field_confidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "field_evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "needs_human_review" boolean DEFAULT false NOT NULL,
    "extraction_model" "text",
    "prompt_key" "text",
    "prompt_version" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "common_shares_offered_text" "text",
    "common_shares_offered" numeric(28,4),
    "prefunded_warrant_shares_text" "text",
    "prefunded_warrant_shares" numeric(28,4),
    "prefunded_warrant_exercise_price_text" "text",
    "prefunded_warrant_exercise_price" numeric(24,8),
    "prefunded_warrant_exercise_price_currency" "text",
    "common_warrant_shares_text" "text",
    "common_warrant_shares" numeric(28,4),
    "common_warrant_exercise_price_text" "text",
    "common_warrant_exercise_price" numeric(24,8),
    "common_warrant_exercise_price_currency" "text",
    "convertible_principal_amount_text" "text",
    "convertible_principal_amount" numeric(24,4),
    "convertible_principal_amount_currency" "text",
    "convertible_share_exposure_text" "text",
    "convertible_share_exposure" numeric(28,4),
    "total_potential_share_exposure_text" "text",
    "total_potential_share_exposure" numeric(28,4),
    "immediate_share_exposure" numeric(28,4),
    "future_warrant_overhang_shares" numeric(28,4),
    "immediate_float_impact_percent" numeric(12,4),
    "total_potential_dilution_percent" numeric(12,4),
    "total_potential_float_overhang_percent" numeric(12,4),
    CONSTRAINT "event_offering_terms_amount_remaining_check" CHECK ((("amount_remaining" IS NULL) OR ("amount_remaining" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_atm_program_size_check" CHECK ((("atm_program_size" IS NULL) OR ("atm_program_size" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_authorized_shares_check" CHECK ((("authorized_shares" IS NULL) OR ("authorized_shares" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_avg_volume_check" CHECK ((("avg_volume" IS NULL) OR ("avg_volume" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_common_shares_offered_nonnegative" CHECK ((("common_shares_offered" IS NULL) OR ("common_shares_offered" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_common_warrant_shares_nonnegative" CHECK ((("common_warrant_shares" IS NULL) OR ("common_warrant_shares" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_convertible_share_exposure_nonnegative" CHECK ((("convertible_share_exposure" IS NULL) OR ("convertible_share_exposure" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_current_shares_outstanding_check" CHECK ((("current_shares_outstanding" IS NULL) OR ("current_shares_outstanding" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_delivery_hint_check" CHECK ((("delivery_hint" IS NULL) OR ("delivery_hint" = ANY (ARRAY['skip'::"text", 'archive'::"text", 'feed'::"text", 'alert'::"text", 'urgent'::"text"])))),
    CONSTRAINT "event_offering_terms_dilution_scale_check" CHECK (("dilution_scale" = ANY (ARRAY['low'::"text", 'moderate'::"text", 'elevated'::"text", 'high'::"text", 'severe'::"text", 'unknown'::"text"]))),
    CONSTRAINT "event_offering_terms_discount_to_market_percent_check" CHECK ((("discount_to_market_percent" IS NULL) OR ("discount_to_market_percent" > ('-100'::integer)::numeric))),
    CONSTRAINT "event_offering_terms_estimated_dilution_percent_check" CHECK ((("estimated_dilution_percent" IS NULL) OR ("estimated_dilution_percent" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_float_overhang_percent_check" CHECK ((("float_overhang_percent" IS NULL) OR ("float_overhang_percent" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_market_cap_check" CHECK ((("market_cap" IS NULL) OR ("market_cap" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_market_reference_price_check" CHECK ((("market_reference_price" IS NULL) OR ("market_reference_price" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_max_share_impact_percent_check" CHECK ((("max_share_impact_percent" IS NULL) OR ("max_share_impact_percent" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_offering_amount_check" CHECK ((("offering_amount" IS NULL) OR ("offering_amount" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_offering_amount_percent_of_market_ca_check" CHECK ((("offering_amount_percent_of_market_cap" IS NULL) OR ("offering_amount_percent_of_market_cap" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_offering_type_check" CHECK (("offering_type" = ANY (ARRAY['atm'::"text", 'registered_direct'::"text", 'private_placement'::"text", 'shelf_registration'::"text", 'resale_registration'::"text", 'warrant_exercise'::"text", 'convertible_financing'::"text", 'rights_offering'::"text", 'mixed'::"text", 'other'::"text", 'unknown'::"text"]))),
    CONSTRAINT "event_offering_terms_overhang_level_check" CHECK (("overhang_level" = ANY (ARRAY['low'::"text", 'moderate'::"text", 'elevated'::"text", 'high'::"text", 'severe'::"text", 'unknown'::"text"]))),
    CONSTRAINT "event_offering_terms_prefunded_warrant_shares_nonnegative" CHECK ((("prefunded_warrant_shares" IS NULL) OR ("prefunded_warrant_shares" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_preliminary_score_cap_check" CHECK ((("preliminary_score_cap" IS NULL) OR (("preliminary_score_cap" >= 0) AND ("preliminary_score_cap" <= 100)))),
    CONSTRAINT "event_offering_terms_preliminary_score_floor_check" CHECK ((("preliminary_score_floor" IS NULL) OR (("preliminary_score_floor" >= 0) AND ("preliminary_score_floor" <= 100)))),
    CONSTRAINT "event_offering_terms_primary_or_resale_check" CHECK (("primary_or_resale" = ANY (ARRAY['primary'::"text", 'resale'::"text", 'mixed'::"text", 'not_disclosed'::"text"]))),
    CONSTRAINT "event_offering_terms_prospectus_type_check" CHECK (("prospectus_type" = ANY (ARRAY['base'::"text", 'supplement'::"text", 'registration_statement'::"text", 'current_report'::"text", 'warrant_indenture'::"text", 'other'::"text", 'unknown'::"text"]))),
    CONSTRAINT "event_offering_terms_public_float_check" CHECK ((("public_float" IS NULL) OR ("public_float" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_public_float_market_check" CHECK ((("public_float_market" IS NULL) OR ("public_float_market" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_public_float_percent_check" CHECK ((("public_float_percent" IS NULL) OR ("public_float_percent" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_registration_status_check" CHECK (("registration_status" = ANY (ARRAY['filed'::"text", 'effective'::"text", 'not_effective'::"text", 'withdrawn'::"text", 'prospectus_supplement'::"text", 'not_disclosed'::"text"]))),
    CONSTRAINT "event_offering_terms_resale_share_count_check" CHECK ((("resale_share_count" IS NULL) OR ("resale_share_count" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_security_type_check" CHECK (("security_type" = ANY (ARRAY['common_stock'::"text", 'common_shares'::"text", 'ordinary_shares'::"text", 'ads'::"text", 'units'::"text", 'warrants'::"text", 'prefunded_warrants'::"text", 'convertible_notes'::"text", 'debt'::"text", 'mixed'::"text", 'other'::"text", 'unknown'::"text"]))),
    CONSTRAINT "event_offering_terms_shares_offered_check" CHECK ((("shares_offered" IS NULL) OR ("shares_offered" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_shares_outstanding_market_check" CHECK ((("shares_outstanding_market" IS NULL) OR ("shares_outstanding_market" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_shelf_capacity_check" CHECK ((("shelf_capacity" IS NULL) OR ("shelf_capacity" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_total_potential_share_exposure_nonnegative" CHECK ((("total_potential_share_exposure" IS NULL) OR ("total_potential_share_exposure" >= (0)::numeric))),
    CONSTRAINT "event_offering_terms_volume_check" CHECK ((("volume" IS NULL) OR ("volume" >= (0)::numeric)))
);


ALTER TABLE "public"."event_offering_terms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_theme_links" (
    "event_id" "uuid" NOT NULL,
    "theme_group_slug" "text" NOT NULL,
    "method" "public"."classification_method" DEFAULT 'unknown'::"public"."classification_method" NOT NULL,
    "confidence" numeric,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "event_theme_links_confidence_check" CHECK ((("confidence" IS NULL) OR (("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))))
);


ALTER TABLE "public"."event_theme_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_tickers" (
    "event_id" "uuid" NOT NULL,
    "symbol" "text" NOT NULL,
    "exchange" "text",
    "role" "text" DEFAULT 'related'::"text" NOT NULL,
    "relevance_score" integer,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "event_tickers_relevance_score_check" CHECK ((("relevance_score" IS NULL) OR (("relevance_score" >= 0) AND ("relevance_score" <= 100)))),
    CONSTRAINT "event_tickers_role_check" CHECK (("role" = ANY (ARRAY['primary'::"text", 'related'::"text", 'peer'::"text", 'customer'::"text", 'supplier'::"text", 'counterparty'::"text", 'mentioned'::"text", 'sector_constituent'::"text", 'theme_constituent'::"text"])))
);


ALTER TABLE "public"."event_tickers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_types" (
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "category" "text" NOT NULL,
    "badge_tone" "text" NOT NULL,
    "source_groups" "public"."source_group"[] DEFAULT '{}'::"public"."source_group"[] NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "covered_forms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "description" "text",
    "examples" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."event_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "raw_item_id" "uuid",
    "source_code" "text" NOT NULL,
    "source_group" "public"."source_group" NOT NULL,
    "source_name" "text",
    "source_url" "text",
    "published_at" timestamp with time zone,
    "ticker" "text",
    "market" "text",
    "event_type" "text" NOT NULL,
    "score" integer NOT NULL,
    "delivery_level" "public"."event_delivery_level" NOT NULL,
    "impact" "public"."event_impact" NOT NULL,
    "signal" "public"."event_signal" NOT NULL,
    "market_scope" "public"."event_market_scope" DEFAULT 'company'::"public"."event_market_scope" NOT NULL,
    "sector" "text",
    "industry_group" "text",
    "theme_group" "text",
    "sub_theme" "text",
    "title" "text" NOT NULL,
    "quick_take" "text",
    "summary" "text",
    "reason" "text",
    "event_date" "date",
    "detected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "group_dedupe_key" "text" NOT NULL,
    "cross_group_event_key" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "events_score_check" CHECK ((("score" >= 0) AND ("score" <= 100)))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fmp_industry_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fmp_industry" "text" NOT NULL,
    "sector_code" "text" NOT NULL,
    "sub_category_slug" "text" NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "is_primary" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fmp_industry_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ingest_workflow_locks" (
    "lock_key" "text" NOT NULL,
    "lock_owner" "text" NOT NULL,
    "locked_until" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ingest_workflow_locks" OWNER TO "postgres";


COMMENT ON TABLE "public"."ingest_workflow_locks" IS 'Short-lived distributed leases used to prevent overlapping source ingest workflows.';



CREATE TABLE IF NOT EXISTS "public"."integration_configs" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."integration_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_community_rooms" (
    "room_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "topic" "text" NOT NULL,
    "room_style" "text" NOT NULL,
    "focus_tags" "text"[] NOT NULL,
    "language" "text" NOT NULL,
    "related_tickers" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "search_document" "tsvector" GENERATED ALWAYS AS (("setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("name", ''::"text")), 'A'::"char") || "setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("summary", ''::"text")), 'B'::"char"))) STORED,
    "last_activity_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "themes" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "industries" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    CONSTRAINT "live_room_community_rooms_focus_tags_check" CHECK ("public"."live_room_community_focus_tags_valid"("focus_tags")),
    CONSTRAINT "live_room_community_rooms_language_check" CHECK (("language" = ANY (ARRAY['en'::"text", 'ko'::"text", 'ja'::"text"]))),
    CONSTRAINT "live_room_community_rooms_name_check" CHECK (((("char_length"("name") >= 4) AND ("char_length"("name") <= 60)) AND ("name" = "btrim"("name")) AND ("name" !~ '[[:cntrl:]]'::"text") AND ("name" !~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'::"text"))),
    CONSTRAINT "live_room_community_rooms_related_tickers_check" CHECK ("public"."live_room_community_tickers_valid"("related_tickers")),
    CONSTRAINT "live_room_community_rooms_room_style_check" CHECK (("room_style" = ANY (ARRAY['live_reaction'::"text", 'deep_research'::"text", 'beginner_friendly'::"text", 'open_discussion'::"text"]))),
    CONSTRAINT "live_room_community_rooms_slug_check" CHECK (((("char_length"("slug") >= 8) AND ("char_length"("slug") <= 64)) AND ("slug" = "lower"("btrim"("slug"))) AND ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::"text"))),
    CONSTRAINT "live_room_community_rooms_summary_check" CHECK (((("char_length"("summary") >= 12) AND ("char_length"("summary") <= 160)) AND ("summary" = "btrim"("summary")) AND ("summary" !~ '[[:cntrl:]]'::"text") AND ("summary" !~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'::"text"))),
    CONSTRAINT "live_room_community_rooms_topic_check" CHECK (("topic" = ANY (ARRAY['market_macro'::"text", 'sector_industry'::"text", 'events_catalysts'::"text", 'trading_strategy'::"text", 'learning_qna'::"text", 'creator_community'::"text"])))
);


ALTER TABLE "public"."live_room_community_rooms" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_community_rooms" IS 'Service-only structured metadata for public member-created Community Rooms. Browser roles remain default-deny.';



COMMENT ON COLUMN "public"."live_room_community_rooms"."themes" IS 'Canonical market theme-group or specific subtheme slugs, maximum three.';



COMMENT ON COLUMN "public"."live_room_community_rooms"."industries" IS 'Canonical sectorMappings subCategory slugs, maximum three.';



CREATE TABLE IF NOT EXISTS "public"."live_room_direct_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "public_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_low_user_id" "uuid" NOT NULL,
    "member_high_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'accepted'::"text" NOT NULL,
    "request_sender_user_id" "uuid",
    "request_created_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "declined_at" timestamp with time zone,
    "state_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_direct_conversations_check" CHECK (("member_low_user_id" <> "member_high_user_id")),
    CONSTRAINT "live_room_direct_conversations_check1" CHECK ((("member_low_user_id")::"text" < ("member_high_user_id")::"text")),
    CONSTRAINT "live_room_direct_conversations_request_sender_check" CHECK ((("request_sender_user_id" IS NULL) OR (("request_sender_user_id" = "member_low_user_id") OR ("request_sender_user_id" = "member_high_user_id")))),
    CONSTRAINT "live_room_direct_conversations_state_check" CHECK (((("status" = 'accepted'::"text") AND ("accepted_at" IS NOT NULL)) OR (("status" = 'pending'::"text") AND ("request_sender_user_id" IS NOT NULL) AND ("request_created_at" IS NOT NULL) AND ("accepted_at" IS NULL) AND ("declined_at" IS NULL)) OR (("status" = 'declined'::"text") AND ("request_sender_user_id" IS NOT NULL) AND ("request_created_at" IS NOT NULL) AND ("declined_at" IS NOT NULL)))),
    CONSTRAINT "live_room_direct_conversations_status_check" CHECK (("status" = ANY (ARRAY['accepted'::"text", 'pending'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."live_room_direct_conversations" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_direct_conversations" IS 'Service-only canonical member pairs for mutual-follow direct messages. This is unrelated to paid Alerts.';



COMMENT ON COLUMN "public"."live_room_direct_conversations"."status" IS 'accepted conversations permit chat until blocked; pending is one request; declined is retained to prevent repeats.';



CREATE TABLE IF NOT EXISTS "public"."live_room_direct_message_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "message_id" "uuid" NOT NULL,
    "reporter_user_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "priority" smallint NOT NULL,
    "risk_score_snapshot" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_direct_message_reports_priority_check" CHECK ((("priority" >= 0) AND ("priority" <= 200))),
    CONSTRAINT "live_room_direct_message_reports_reason_check" CHECK (("reason" = ANY (ARRAY['spam'::"text", 'harassment'::"text", 'scam'::"text", 'misinformation'::"text", 'other'::"text"]))),
    CONSTRAINT "live_room_direct_message_reports_risk_score_snapshot_check" CHECK ((("risk_score_snapshot" >= 0) AND ("risk_score_snapshot" <= 100)))
);


ALTER TABLE "public"."live_room_direct_message_reports" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_direct_message_reports" IS 'Service-only participant reports. Stored risk scores raise moderation priority without blocking accepted messages.';



CREATE TABLE IF NOT EXISTS "public"."live_room_direct_message_settings" (
    "member_user_id" "uuid" NOT NULL,
    "receive_mode" "text" DEFAULT 'followers'::"text" NOT NULL,
    "request_filter" "text" DEFAULT 'any'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_direct_message_settings_receive_mode_check" CHECK (("receive_mode" = ANY (ARRAY['mutual_only'::"text", 'people_i_follow'::"text", 'followers'::"text", 'everyone'::"text", 'nobody'::"text"]))),
    CONSTRAINT "live_room_direct_message_settings_request_filter_check" CHECK (("request_filter" = ANY (ARRAY['any'::"text", 'moderators'::"text", 'verified'::"text", 'pro_members'::"text"])))
);


ALTER TABLE "public"."live_room_direct_message_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_direct_message_settings" IS 'Service-only member privacy settings for non-mutual direct-message requests.';



CREATE TABLE IF NOT EXISTS "public"."live_room_direct_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_user_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "message_kind" "text" DEFAULT 'chat'::"text" NOT NULL,
    "risk_flags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "risk_score" smallint DEFAULT 0 NOT NULL,
    CONSTRAINT "live_room_direct_messages_body_check" CHECK (((("char_length"("body") >= 1) AND ("char_length"("body") <= 600)) AND ("body" = "btrim"("body")))),
    CONSTRAINT "live_room_direct_messages_kind_check" CHECK (("message_kind" = ANY (ARRAY['chat'::"text", 'request'::"text"]))),
    CONSTRAINT "live_room_direct_messages_risk_flags_check" CHECK (("risk_flags" <@ ARRAY['off_platform_contact'::"text", 'money_transfer'::"text", 'guaranteed_return'::"text", 'paid_room'::"text", 'crypto_wallet'::"text", 'repeated_contact'::"text"])),
    CONSTRAINT "live_room_direct_messages_risk_score_check" CHECK ((("risk_score" >= 0) AND ("risk_score" <= 100)))
);


ALTER TABLE "public"."live_room_direct_messages" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_direct_messages" IS 'Service-only direct-message history. Browsers use participant-checking same-origin routes.';



COMMENT ON COLUMN "public"."live_room_direct_messages"."risk_flags" IS 'Safety cues for warnings and report prioritization, not investment expertise or paid advice access.';



CREATE TABLE IF NOT EXISTS "public"."live_room_direct_reads" (
    "conversation_id" "uuid" NOT NULL,
    "member_user_id" "uuid" NOT NULL,
    "last_read_message_id" "uuid",
    "last_read_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."live_room_direct_reads" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_direct_reads" IS 'Service-only exact per-participant direct-message read cursors.';



CREATE TABLE IF NOT EXISTS "public"."live_room_guest_profiles" (
    "guest_session_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_guest_profiles_display_name_check" CHECK (((("char_length"("display_name") >= 1) AND ("char_length"("display_name") <= 24)) AND ("display_name" = "btrim"("display_name")))),
    CONSTRAINT "live_room_guest_profiles_emoji_check" CHECK (("emoji" = ANY (ARRAY["chr"(128075), "chr"(129418), "chr"(128059), "chr"(129417), "chr"(128640), "chr"(129517), "chr"(128202), "chr"(127793)])))
);


ALTER TABLE "public"."live_room_guest_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_guest_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "live_room_guest_sessions_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "live_room_guest_sessions_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "public"."live_room_guest_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_guest_sessions" IS 'Server-issued guest identities. Expired sessions may be pruned; message author snapshots survive via ON DELETE SET NULL.';



CREATE TABLE IF NOT EXISTS "public"."live_room_member_follows" (
    "follower_user_id" "uuid" NOT NULL,
    "followed_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_read_message_id" "uuid",
    CONSTRAINT "live_room_member_follows_check" CHECK (("follower_user_id" <> "followed_user_id"))
);


ALTER TABLE "public"."live_room_member_follows" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_member_follows" IS 'Service-only member relationship storage. No notification, feed, or recommendation delivery is implied.';



COMMENT ON COLUMN "public"."live_room_member_follows"."last_read_at" IS 'Per-follow member activity cursor; unrelated to room unread and paid Alerts.';



CREATE TABLE IF NOT EXISTS "public"."live_room_member_presence" (
    "member_user_id" "uuid" NOT NULL,
    "ticker" "text" NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_member_presence_ticker_check" CHECK ((("ticker" = "upper"("btrim"("ticker"))) AND ("ticker" ~ '^[A-Z0-9][A-Z0-9.-]{0,9}$'::"text")))
);


ALTER TABLE "public"."live_room_member_presence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_member_profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "show_presence" boolean DEFAULT true NOT NULL,
    "public_profile_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "live_room_member_profiles_display_name_check" CHECK (((("char_length"("display_name") >= 1) AND ("char_length"("display_name") <= 24)) AND ("display_name" = "btrim"("display_name")))),
    CONSTRAINT "live_room_member_profiles_emoji_check" CHECK (("emoji" = ANY (ARRAY["chr"(128075), "chr"(129418), "chr"(128059), "chr"(129417), "chr"(128640), "chr"(129517), "chr"(128202), "chr"(127793)])))
);


ALTER TABLE "public"."live_room_member_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."live_room_member_profiles"."public_profile_id" IS 'Opaque public route identifier. Never reuse the auth/user_profiles UUID.';



CREATE TABLE IF NOT EXISTS "public"."live_room_message_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "reporter_kind" "text" NOT NULL,
    "reporter_actor_id" "uuid" NOT NULL,
    "reporter_member_user_id" "uuid",
    "reporter_guest_session_id" "uuid",
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_message_reports_reason_check" CHECK (("reason" = ANY (ARRAY['spam'::"text", 'harassment'::"text", 'misinformation'::"text", 'other'::"text"]))),
    CONSTRAINT "live_room_message_reports_reporter_kind_check" CHECK (("reporter_kind" = ANY (ARRAY['member'::"text", 'guest'::"text"])))
);


ALTER TABLE "public"."live_room_message_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_moderation_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "moderator_user_id" "uuid",
    "moderator_role" "text" NOT NULL,
    "action" "text" NOT NULL,
    "previous_visibility_status" "text" NOT NULL,
    "resulting_visibility_status" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_moderation_actions_action_check" CHECK (("action" = ANY (ARRAY['hide'::"text", 'restore'::"text"]))),
    CONSTRAINT "live_room_moderation_actions_moderator_role_check" CHECK (("moderator_role" = ANY (ARRAY['moderator'::"text", 'admin'::"text"]))),
    CONSTRAINT "live_room_moderation_actions_previous_visibility_status_check" CHECK (("previous_visibility_status" = ANY (ARRAY['visible'::"text", 'hidden'::"text", 'deleted'::"text"]))),
    CONSTRAINT "live_room_moderation_actions_reason_check" CHECK ((("char_length"("reason") >= 1) AND ("char_length"("reason") <= 240))),
    CONSTRAINT "live_room_moderation_actions_resulting_visibility_status_check" CHECK (("resulting_visibility_status" = ANY (ARRAY['visible'::"text", 'hidden'::"text", 'deleted'::"text"])))
);


ALTER TABLE "public"."live_room_moderation_actions" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_moderation_actions" IS 'Append-only audit records for Live Room hide and restore actions.';



CREATE TABLE IF NOT EXISTS "public"."live_room_moderators" (
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_moderators_role_check" CHECK (("role" = ANY (ARRAY['moderator'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."live_room_moderators" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_moderators" IS 'Trusted service-only moderator assignments. Authorization must not use user_metadata.';



CREATE TABLE IF NOT EXISTS "public"."live_room_post_activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "activity_kind" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "post_id" "uuid" NOT NULL,
    "comment_id" "uuid",
    "room_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_post_activity_activity_kind_check" CHECK (("activity_kind" = ANY (ARRAY['post_comment'::"text", 'comment_reply'::"text", 'followed_member_post'::"text", 'followed_room_post'::"text"]))),
    CONSTRAINT "live_room_post_activity_check" CHECK (((("activity_kind" = ANY (ARRAY['post_comment'::"text", 'comment_reply'::"text"])) AND ("comment_id" IS NOT NULL) AND ("source_id" = "comment_id")) OR (("activity_kind" = ANY (ARRAY['followed_member_post'::"text", 'followed_room_post'::"text"])) AND ("comment_id" IS NULL) AND ("source_id" = "post_id")))),
    CONSTRAINT "live_room_post_activity_check1" CHECK (("recipient_user_id" IS DISTINCT FROM "actor_user_id"))
);


ALTER TABLE "public"."live_room_post_activity" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_room_post_activity" IS 'Member-only Live Room post, comment, reply, and follow activity. Separate from paid market Alerts.';



CREATE TABLE IF NOT EXISTS "public"."live_room_post_comment_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "reporter_kind" "text" NOT NULL,
    "reporter_actor_id" "uuid" NOT NULL,
    "reporter_member_user_id" "uuid",
    "reporter_guest_session_id" "uuid",
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_post_comment_reports_reason_check" CHECK (("reason" = ANY (ARRAY['spam'::"text", 'harassment'::"text", 'misinformation'::"text", 'other'::"text"]))),
    CONSTRAINT "live_room_post_comment_reports_reporter_kind_check" CHECK (("reporter_kind" = ANY (ARRAY['member'::"text", 'guest'::"text"])))
);


ALTER TABLE "public"."live_room_post_comment_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_post_moderation_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "moderator_user_id" "uuid",
    "moderator_role" "text" NOT NULL,
    "action" "text" NOT NULL,
    "previous_visibility_status" "text" NOT NULL,
    "resulting_visibility_status" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_post_moderation_act_resulting_visibility_status_check" CHECK (("resulting_visibility_status" = ANY (ARRAY['visible'::"text", 'hidden'::"text", 'deleted'::"text"]))),
    CONSTRAINT "live_room_post_moderation_acti_previous_visibility_status_check" CHECK (("previous_visibility_status" = ANY (ARRAY['visible'::"text", 'hidden'::"text", 'deleted'::"text"]))),
    CONSTRAINT "live_room_post_moderation_actions_action_check" CHECK (("action" = ANY (ARRAY['hide'::"text", 'restore'::"text"]))),
    CONSTRAINT "live_room_post_moderation_actions_moderator_role_check" CHECK (("moderator_role" = ANY (ARRAY['moderator'::"text", 'admin'::"text"]))),
    CONSTRAINT "live_room_post_moderation_actions_reason_check" CHECK ((("char_length"("reason") >= 1) AND ("char_length"("reason") <= 240)))
);


ALTER TABLE "public"."live_room_post_moderation_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_post_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "reporter_kind" "text" NOT NULL,
    "reporter_actor_id" "uuid" NOT NULL,
    "reporter_member_user_id" "uuid",
    "reporter_guest_session_id" "uuid",
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_room_post_reports_reason_check" CHECK (("reason" = ANY (ARRAY['spam'::"text", 'harassment'::"text", 'misinformation'::"text", 'other'::"text"]))),
    CONSTRAINT "live_room_post_reports_reporter_kind_check" CHECK (("reporter_kind" = ANY (ARRAY['member'::"text", 'guest'::"text"])))
);


ALTER TABLE "public"."live_room_post_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_room_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticker" "text",
    "issuer_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "room_kind" "text" DEFAULT 'company'::"text" NOT NULL,
    CONSTRAINT "live_room_rooms_room_kind_check" CHECK (((("room_kind" = 'company'::"text") AND ("ticker" IS NOT NULL)) OR (("room_kind" = 'community'::"text") AND ("ticker" IS NULL) AND ("issuer_id" IS NULL)))),
    CONSTRAINT "live_room_rooms_ticker_check" CHECK ((("ticker" = "upper"("btrim"("ticker"))) AND ("ticker" ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'::"text")))
);


ALTER TABLE "public"."live_room_rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_bars" (
    "symbol" "text" NOT NULL,
    "range" "text" NOT NULL,
    "interval" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_label" "text" NOT NULL,
    "previous_close" numeric NOT NULL,
    "latest_price" numeric NOT NULL,
    "change_amount" numeric NOT NULL,
    "change_percent" numeric NOT NULL,
    "bars" "jsonb" NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."market_bars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_group_snapshots" (
    "scope" "text" NOT NULL,
    "group_key" "text" NOT NULL,
    "group_name" "text" NOT NULL,
    "parent_key" "text",
    "range" "text" NOT NULL,
    "interval" "text" NOT NULL,
    "provider_label" "text" NOT NULL,
    "change_percent" numeric NOT NULL,
    "market_cap_label" "text",
    "trend_points" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "top_movers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "constituent_symbols" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "market_group_snapshots_scope_check" CHECK (("scope" = ANY (ARRAY['sector'::"text", 'industry_group'::"text", 'theme'::"text", 'sub_theme'::"text"])))
);


ALTER TABLE "public"."market_group_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_quotes" (
    "symbol" "text" NOT NULL,
    "provider" "text" DEFAULT 'fmp'::"text" NOT NULL,
    "price" numeric,
    "change_amount" numeric,
    "change_percent" numeric,
    "previous_close" numeric,
    "volume" numeric,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."market_quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_sectors" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."market_sectors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticker" "text" NOT NULL,
    "price" numeric,
    "market_cap" numeric,
    "float_shares" numeric,
    "shares_outstanding" numeric,
    "volume" numeric,
    "avg_volume" numeric,
    "source" "text" NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."market_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_sub_categories" (
    "sector_code" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."market_sub_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "channel" "text" NOT NULL,
    "destination_code" "text" NOT NULL,
    "recipient_ref" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "filters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."notification_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompt_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "version" "text" NOT NULL,
    "task" "text" NOT NULL,
    "model" "text",
    "is_active" boolean DEFAULT false NOT NULL,
    "template" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."prompt_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."raw_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid",
    "source_code" "text" NOT NULL,
    "source_group" "public"."source_group" NOT NULL,
    "source_unique_id" "text",
    "source_url" "text",
    "title" "text",
    "published_at" timestamp with time zone,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "body_text" "text",
    "analysis_text" "text",
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "dedupe_key" "text"
);


ALTER TABLE "public"."raw_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schema_versions" (
    "version" "text" NOT NULL,
    "description" "text",
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."schema_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."source_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_code" "text" NOT NULL,
    "source_group" "public"."source_group" NOT NULL,
    "run_type" "text" NOT NULL,
    "status" "public"."run_status" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "stats" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."source_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sources" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "source_group" "public"."source_group" NOT NULL,
    "runtime_owner" "public"."runtime_owner" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "poll_interval_seconds" integer,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telegram_connect_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."telegram_connect_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."theme_groups" (
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "status" "public"."theme_group_status" DEFAULT 'planned'::"public"."theme_group_status" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 100 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."theme_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."theme_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "theme_group_slug" "text" NOT NULL,
    "as_of" timestamp with time zone NOT NULL,
    "change_pct" numeric,
    "volume_score" numeric,
    "event_count" integer DEFAULT 0 NOT NULL,
    "alert_count" integer DEFAULT 0 NOT NULL,
    "top_symbols" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."theme_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticker_classifications" (
    "symbol" "text" NOT NULL,
    "sector_code" "text",
    "sub_category_slug" "text",
    "method" "public"."classification_method" DEFAULT 'unknown'::"public"."classification_method" NOT NULL,
    "confidence" numeric,
    "manual_override" boolean DEFAULT false NOT NULL,
    "reason" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "ticker_classifications_confidence_check" CHECK ((("confidence" IS NULL) OR (("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))))
);


ALTER TABLE "public"."ticker_classifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticker_theme_members" (
    "symbol" "text" NOT NULL,
    "theme_group_slug" "text" NOT NULL,
    "method" "public"."classification_method" DEFAULT 'unknown'::"public"."classification_method" NOT NULL,
    "confidence" numeric,
    "reason" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "ticker_theme_members_confidence_check" CHECK ((("confidence" IS NULL) OR (("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))))
);


ALTER TABLE "public"."ticker_theme_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tickers" (
    "symbol" "text" NOT NULL,
    "name" "text",
    "exchange" "text",
    "fmp_sector" "text",
    "fmp_industry" "text",
    "asset_type" "text",
    "market_cap" numeric,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_profiled_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tickers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_alert_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "alert_event_id" "uuid",
    "ticker" "text",
    "title" "text" NOT NULL,
    "category" "text",
    "source_type" "text",
    "source_label" "text",
    "alert_lane" "text" NOT NULL,
    "severity" "text",
    "delivered_channels" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "delivery_status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "delivered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dedupe_key" "text",
    "scheduled_for" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "attempted_at" timestamp with time zone,
    "last_error" "text",
    CONSTRAINT "user_alert_deliveries_alert_lane_check" CHECK (("alert_lane" = ANY (ARRAY['watchlist'::"text", 'market_discovery'::"text"]))),
    CONSTRAINT "user_alert_deliveries_category_check" CHECK ((("category" IS NULL) OR ("category" = ANY (ARRAY['listing_risk'::"text", 'dilution_risk'::"text", 'earnings'::"text", 'sales_performance'::"text", 'product_update'::"text", 'leadership_governance'::"text", 'insider_ownership'::"text", 'shareholder_vote'::"text", 'strategic_transaction'::"text", 'financial_risk'::"text", 'legal_risk'::"text", 'dividends'::"text", 'capital_return'::"text", 'fda_clinical'::"text", 'policy_regulation'::"text", 'macro_market'::"text", 'other'::"text"])))),
    CONSTRAINT "user_alert_deliveries_delivered_channels_check" CHECK (("delivered_channels" <@ ARRAY['web'::"text", 'telegram'::"text", 'email'::"text", 'webhook'::"text", 'api'::"text"])),
    CONSTRAINT "user_alert_deliveries_delivery_status_check" CHECK (("delivery_status" = ANY (ARRAY['queued'::"text", 'sent'::"text", 'failed'::"text", 'suppressed'::"text"]))),
    CONSTRAINT "user_alert_deliveries_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."user_alert_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_alert_tickers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "ticker" "text" NOT NULL,
    "company_name" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_alert_tickers_company_name_check" CHECK (("length"("btrim"("company_name")) > 0)),
    CONSTRAINT "user_alert_tickers_ticker_check" CHECK ((("ticker" = "upper"("ticker")) AND ("ticker" = "btrim"("ticker")) AND ("ticker" ~ '^[A-Z0-9.-]{1,12}$'::"text")))
);


ALTER TABLE "public"."user_alert_tickers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_delivery_channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "destination" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_delivery_channels_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'telegram'::"text", 'email'::"text", 'webhook'::"text", 'api'::"text"])))
);


ALTER TABLE "public"."user_delivery_channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_discovery_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_discovery_categories_category_check" CHECK (("category" = ANY (ARRAY['listing_risk'::"text", 'dilution_risk'::"text", 'earnings'::"text", 'sales_performance'::"text", 'product_update'::"text", 'leadership_governance'::"text", 'insider_ownership'::"text", 'shareholder_vote'::"text", 'strategic_transaction'::"text", 'financial_risk'::"text", 'legal_risk'::"text", 'dividends'::"text", 'capital_return'::"text", 'fda_clinical'::"text", 'policy_regulation'::"text", 'macro_market'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."user_discovery_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_plan_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "billing_period_start" timestamp with time zone,
    "billing_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trial_plan" "text",
    "trial_started_at" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "trial_used_at" timestamp with time zone,
    "trial_cancelled_at" timestamp with time zone,
    CONSTRAINT "user_plan_subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'ad_free'::"text", 'pro'::"text", 'advanced'::"text", 'ultimate'::"text"]))),
    CONSTRAINT "user_plan_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'cancelled'::"text", 'paused'::"text"]))),
    CONSTRAINT "user_plan_subscriptions_trial_plan_check" CHECK ((("trial_plan" IS NULL) OR ("trial_plan" = 'pro'::"text")))
);


ALTER TABLE "public"."user_plan_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watchlist_tickers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "ticker" "text" NOT NULL,
    "company_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "watchlist_tickers_ticker_check" CHECK ((("ticker" = "upper"("ticker")) AND ("ticker" = "btrim"("ticker")) AND ("length"("ticker") > 0)))
);


ALTER TABLE "public"."watchlist_tickers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_outputs"
    ADD CONSTRAINT "ai_outputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_runs"
    ADD CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_delivery_event_runs"
    ADD CONSTRAINT "alert_delivery_event_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_delivery_job_locks"
    ADD CONSTRAINT "alert_delivery_job_locks_pkey" PRIMARY KEY ("job_name");



ALTER TABLE ONLY "public"."alert_delivery_scheduler_runs"
    ADD CONSTRAINT "alert_delivery_scheduler_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_delivery_scheduler_runs"
    ADD CONSTRAINT "alert_delivery_scheduler_runs_run_id_key" UNIQUE ("run_id");



ALTER TABLE ONLY "public"."alert_preferences"
    ADD CONSTRAINT "alert_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_preferences"
    ADD CONSTRAINT "alert_preferences_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_logo_cache"
    ADD CONSTRAINT "company_logo_cache_pkey" PRIMARY KEY ("symbol");



ALTER TABLE ONLY "public"."dashboard_extended_mover_snapshots"
    ADD CONSTRAINT "dashboard_extended_mover_snapshots_pkey" PRIMARY KEY ("session", "mode");



ALTER TABLE ONLY "public"."dashboard_mover_snapshots"
    ADD CONSTRAINT "dashboard_mover_snapshots_pkey" PRIMARY KEY ("mode");



ALTER TABLE ONLY "public"."dedupe_keys"
    ADD CONSTRAINT "dedupe_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dedupe_keys"
    ADD CONSTRAINT "dedupe_keys_source_group_scope_dedupe_key_key" UNIQUE ("source_group", "scope", "dedupe_key");



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_analysis"
    ADD CONSTRAINT "event_analysis_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."event_calendar_items"
    ADD CONSTRAINT "event_calendar_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_links"
    ADD CONSTRAINT "event_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_offering_terms"
    ADD CONSTRAINT "event_offering_terms_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."event_theme_links"
    ADD CONSTRAINT "event_theme_links_pkey" PRIMARY KEY ("event_id", "theme_group_slug");



ALTER TABLE ONLY "public"."event_tickers"
    ADD CONSTRAINT "event_tickers_pkey" PRIMARY KEY ("event_id", "symbol", "role");



ALTER TABLE ONLY "public"."event_types"
    ADD CONSTRAINT "event_types_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fmp_industry_mappings"
    ADD CONSTRAINT "fmp_industry_mappings_fmp_industry_sector_code_sub_category_key" UNIQUE ("fmp_industry", "sector_code", "sub_category_slug");



ALTER TABLE ONLY "public"."fmp_industry_mappings"
    ADD CONSTRAINT "fmp_industry_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingest_workflow_locks"
    ADD CONSTRAINT "ingest_workflow_locks_pkey" PRIMARY KEY ("lock_key");



ALTER TABLE ONLY "public"."integration_configs"
    ADD CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."live_room_actor_blocks"
    ADD CONSTRAINT "live_room_actor_blocks_blocker_kind_blocker_actor_id_blocke_key" UNIQUE ("blocker_kind", "blocker_actor_id", "blocked_kind", "blocked_actor_id");



ALTER TABLE ONLY "public"."live_room_actor_blocks"
    ADD CONSTRAINT "live_room_actor_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."live_room_community_rooms"
    ADD CONSTRAINT "live_room_community_rooms_industries_check" CHECK ("public"."live_room_community_industries_valid"("industries")) NOT VALID;



ALTER TABLE ONLY "public"."live_room_community_rooms"
    ADD CONSTRAINT "live_room_community_rooms_pkey" PRIMARY KEY ("room_id");



ALTER TABLE ONLY "public"."live_room_community_rooms"
    ADD CONSTRAINT "live_room_community_rooms_slug_key" UNIQUE ("slug");



ALTER TABLE "public"."live_room_community_rooms"
    ADD CONSTRAINT "live_room_community_rooms_themes_check" CHECK ("public"."live_room_community_themes_valid"("themes")) NOT VALID;



ALTER TABLE ONLY "public"."live_room_direct_conversations"
    ADD CONSTRAINT "live_room_direct_conversation_member_low_user_id_member_hig_key" UNIQUE ("member_low_user_id", "member_high_user_id");



ALTER TABLE ONLY "public"."live_room_direct_conversations"
    ADD CONSTRAINT "live_room_direct_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_direct_conversations"
    ADD CONSTRAINT "live_room_direct_conversations_public_id_key" UNIQUE ("public_id");



ALTER TABLE ONLY "public"."live_room_direct_message_reports"
    ADD CONSTRAINT "live_room_direct_message_report_message_id_reporter_user_id_key" UNIQUE ("message_id", "reporter_user_id");



ALTER TABLE ONLY "public"."live_room_direct_message_reports"
    ADD CONSTRAINT "live_room_direct_message_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_direct_message_settings"
    ADD CONSTRAINT "live_room_direct_message_settings_pkey" PRIMARY KEY ("member_user_id");



ALTER TABLE ONLY "public"."live_room_direct_messages"
    ADD CONSTRAINT "live_room_direct_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_direct_reads"
    ADD CONSTRAINT "live_room_direct_reads_pkey" PRIMARY KEY ("conversation_id", "member_user_id");



ALTER TABLE ONLY "public"."live_room_follows"
    ADD CONSTRAINT "live_room_follows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_follows"
    ADD CONSTRAINT "live_room_follows_room_id_actor_kind_actor_id_key" UNIQUE ("room_id", "actor_kind", "actor_id");



ALTER TABLE ONLY "public"."live_room_guest_profiles"
    ADD CONSTRAINT "live_room_guest_profiles_pkey" PRIMARY KEY ("guest_session_id");



ALTER TABLE ONLY "public"."live_room_guest_sessions"
    ADD CONSTRAINT "live_room_guest_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_guest_sessions"
    ADD CONSTRAINT "live_room_guest_sessions_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."live_room_member_follows"
    ADD CONSTRAINT "live_room_member_follows_pkey" PRIMARY KEY ("follower_user_id", "followed_user_id");



ALTER TABLE ONLY "public"."live_room_member_presence"
    ADD CONSTRAINT "live_room_member_presence_pkey" PRIMARY KEY ("member_user_id");



ALTER TABLE ONLY "public"."live_room_member_profiles"
    ADD CONSTRAINT "live_room_member_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."live_room_message_reports"
    ADD CONSTRAINT "live_room_message_reports_message_id_reporter_kind_reporter_key" UNIQUE ("message_id", "reporter_kind", "reporter_actor_id");



ALTER TABLE ONLY "public"."live_room_message_reports"
    ADD CONSTRAINT "live_room_message_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_messages"
    ADD CONSTRAINT "live_room_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_moderation_actions"
    ADD CONSTRAINT "live_room_moderation_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_moderators"
    ADD CONSTRAINT "live_room_moderators_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."live_room_post_activity"
    ADD CONSTRAINT "live_room_post_activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_post_activity"
    ADD CONSTRAINT "live_room_post_activity_recipient_user_id_source_id_key" UNIQUE ("recipient_user_id", "source_id");



ALTER TABLE ONLY "public"."live_room_post_comment_reports"
    ADD CONSTRAINT "live_room_post_comment_report_comment_id_reporter_kind_repo_key" UNIQUE ("comment_id", "reporter_kind", "reporter_actor_id");



ALTER TABLE ONLY "public"."live_room_post_comment_reports"
    ADD CONSTRAINT "live_room_post_comment_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_post_comments"
    ADD CONSTRAINT "live_room_post_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_post_moderation_actions"
    ADD CONSTRAINT "live_room_post_moderation_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_post_reports"
    ADD CONSTRAINT "live_room_post_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_post_reports"
    ADD CONSTRAINT "live_room_post_reports_post_id_reporter_kind_reporter_actor_key" UNIQUE ("post_id", "reporter_kind", "reporter_actor_id");



ALTER TABLE ONLY "public"."live_room_posts"
    ADD CONSTRAINT "live_room_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_rooms"
    ADD CONSTRAINT "live_room_rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_rooms"
    ADD CONSTRAINT "live_room_rooms_ticker_key" UNIQUE ("ticker");



ALTER TABLE ONLY "public"."live_room_social_verifications"
    ADD CONSTRAINT "live_room_social_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_room_social_verifications"
    ADD CONSTRAINT "live_room_social_verifications_public_request_id_key" UNIQUE ("public_request_id");



ALTER TABLE ONLY "public"."market_bars"
    ADD CONSTRAINT "market_bars_pkey" PRIMARY KEY ("symbol", "range", "interval");



ALTER TABLE ONLY "public"."market_group_snapshots"
    ADD CONSTRAINT "market_group_snapshots_pkey" PRIMARY KEY ("scope", "group_key", "range", "interval");



ALTER TABLE ONLY "public"."market_quotes"
    ADD CONSTRAINT "market_quotes_pkey" PRIMARY KEY ("symbol");



ALTER TABLE ONLY "public"."market_sectors"
    ADD CONSTRAINT "market_sectors_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."market_snapshots"
    ADD CONSTRAINT "market_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."market_sub_categories"
    ADD CONSTRAINT "market_sub_categories_pkey" PRIMARY KEY ("sector_code", "slug");



ALTER TABLE ONLY "public"."notification_subscriptions"
    ADD CONSTRAINT "notification_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prompt_templates"
    ADD CONSTRAINT "prompt_templates_key_version_key" UNIQUE ("key", "version");



ALTER TABLE ONLY "public"."prompt_templates"
    ADD CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."raw_items"
    ADD CONSTRAINT "raw_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schema_versions"
    ADD CONSTRAINT "schema_versions_pkey" PRIMARY KEY ("version");



ALTER TABLE ONLY "public"."source_runs"
    ADD CONSTRAINT "source_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."telegram_connect_tokens"
    ADD CONSTRAINT "telegram_connect_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telegram_connect_tokens"
    ADD CONSTRAINT "telegram_connect_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."theme_groups"
    ADD CONSTRAINT "theme_groups_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."theme_snapshots"
    ADD CONSTRAINT "theme_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."theme_snapshots"
    ADD CONSTRAINT "theme_snapshots_theme_group_slug_as_of_key" UNIQUE ("theme_group_slug", "as_of");



ALTER TABLE ONLY "public"."ticker_classifications"
    ADD CONSTRAINT "ticker_classifications_pkey" PRIMARY KEY ("symbol");



ALTER TABLE ONLY "public"."ticker_theme_members"
    ADD CONSTRAINT "ticker_theme_members_pkey" PRIMARY KEY ("symbol", "theme_group_slug");



ALTER TABLE ONLY "public"."tickers"
    ADD CONSTRAINT "tickers_pkey" PRIMARY KEY ("symbol");



ALTER TABLE ONLY "public"."user_alert_deliveries"
    ADD CONSTRAINT "user_alert_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_alert_tickers"
    ADD CONSTRAINT "user_alert_tickers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_alert_tickers"
    ADD CONSTRAINT "user_alert_tickers_user_id_ticker_key" UNIQUE ("user_id", "ticker");



ALTER TABLE ONLY "public"."user_delivery_channels"
    ADD CONSTRAINT "user_delivery_channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_delivery_channels"
    ADD CONSTRAINT "user_delivery_channels_user_id_channel_key" UNIQUE ("user_id", "channel");



ALTER TABLE ONLY "public"."user_discovery_categories"
    ADD CONSTRAINT "user_discovery_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_discovery_categories"
    ADD CONSTRAINT "user_discovery_categories_user_id_category_key" UNIQUE ("user_id", "category");



ALTER TABLE ONLY "public"."user_plan_subscriptions"
    ADD CONSTRAINT "user_plan_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_plan_subscriptions"
    ADD CONSTRAINT "user_plan_subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watchlist_tickers"
    ADD CONSTRAINT "watchlist_tickers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watchlist_tickers"
    ADD CONSTRAINT "watchlist_tickers_user_id_ticker_key" UNIQUE ("user_id", "ticker");



CREATE INDEX "ai_runs_event_idx" ON "public"."ai_runs" USING "btree" ("event_id");



CREATE INDEX "alert_delivery_event_runs_event_idx" ON "public"."alert_delivery_event_runs" USING "btree" ("event_id");



CREATE UNIQUE INDEX "alert_delivery_event_runs_event_write_unique" ON "public"."alert_delivery_event_runs" USING "btree" ("event_id") WHERE ("dry_run" = false);



CREATE INDEX "alert_delivery_event_runs_processed_idx" ON "public"."alert_delivery_event_runs" USING "btree" ("processed_at" DESC);



CREATE INDEX "alert_delivery_event_runs_status_processed_idx" ON "public"."alert_delivery_event_runs" USING "btree" ("status", "processed_at" DESC);



CREATE INDEX "alert_delivery_job_locks_locked_until_idx" ON "public"."alert_delivery_job_locks" USING "btree" ("locked_until");



CREATE INDEX "alert_delivery_scheduler_runs_run_id_idx" ON "public"."alert_delivery_scheduler_runs" USING "btree" ("run_id");



CREATE INDEX "alert_delivery_scheduler_runs_started_at_idx" ON "public"."alert_delivery_scheduler_runs" USING "btree" ("started_at" DESC);



CREATE INDEX "alert_delivery_scheduler_runs_status_started_at_idx" ON "public"."alert_delivery_scheduler_runs" USING "btree" ("status", "started_at" DESC);



CREATE INDEX "alert_preferences_user_idx" ON "public"."alert_preferences" USING "btree" ("user_id");



CREATE INDEX "audit_logs_target_idx" ON "public"."audit_logs" USING "btree" ("target_type", "target_id", "created_at" DESC);



CREATE INDEX "company_logo_cache_expires_at_idx" ON "public"."company_logo_cache" USING "btree" ("expires_at");



CREATE INDEX "deliveries_channel_status_idx" ON "public"."deliveries" USING "btree" ("channel", "status", "attempted_at" DESC);



CREATE INDEX "deliveries_event_idx" ON "public"."deliveries" USING "btree" ("event_id");



CREATE INDEX "deliveries_subscription_idx" ON "public"."deliveries" USING "btree" ("subscription_id");



CREATE INDEX "event_analysis_scope_idx" ON "public"."event_analysis" USING "btree" ("analysis_scope");



CREATE INDEX "event_calendar_items_date_idx" ON "public"."event_calendar_items" USING "btree" ("event_date", "estimated_start_date", "calendar_group");



CREATE INDEX "event_calendar_items_event_idx" ON "public"."event_calendar_items" USING "btree" ("source_event_id");



CREATE INDEX "event_calendar_items_key_idx" ON "public"."event_calendar_items" USING "btree" ("calendar_event_key");



CREATE INDEX "event_calendar_items_status_date_idx" ON "public"."event_calendar_items" USING "btree" ("calendar_status", "event_date", "estimated_start_date");



CREATE INDEX "event_calendar_items_ticker_idx" ON "public"."event_calendar_items" USING "btree" ("ticker", "event_date") WHERE ("ticker" IS NOT NULL);



CREATE INDEX "event_calendar_items_type_idx" ON "public"."event_calendar_items" USING "btree" ("calendar_event_type", "event_date");



CREATE UNIQUE INDEX "event_links_pair_idx" ON "public"."event_links" USING "btree" (LEAST("left_event_id", "right_event_id"), GREATEST("left_event_id", "right_event_id"), "link_type");



CREATE INDEX "event_offering_terms_amount_idx" ON "public"."event_offering_terms" USING "btree" ("offering_amount" DESC) WHERE ("offering_amount" IS NOT NULL);



CREATE INDEX "event_offering_terms_dates_idx" ON "public"."event_offering_terms" USING "btree" ("effective_date", "closing_date");



CREATE INDEX "event_offering_terms_dilution_idx" ON "public"."event_offering_terms" USING "btree" ("estimated_dilution_percent" DESC) WHERE ("estimated_dilution_percent" IS NOT NULL);



CREATE INDEX "event_offering_terms_float_overhang_idx" ON "public"."event_offering_terms" USING "btree" ("float_overhang_percent" DESC) WHERE ("float_overhang_percent" IS NOT NULL);



CREATE INDEX "event_offering_terms_market_cap_pct_idx" ON "public"."event_offering_terms" USING "btree" ("offering_amount_percent_of_market_cap" DESC) WHERE ("offering_amount_percent_of_market_cap" IS NOT NULL);



CREATE INDEX "event_offering_terms_raw_item_idx" ON "public"."event_offering_terms" USING "btree" ("raw_item_id") WHERE ("raw_item_id" IS NOT NULL);



CREATE INDEX "event_offering_terms_total_potential_dilution_idx" ON "public"."event_offering_terms" USING "btree" ("total_potential_dilution_percent" DESC) WHERE ("total_potential_dilution_percent" IS NOT NULL);



CREATE INDEX "event_offering_terms_total_potential_exposure_idx" ON "public"."event_offering_terms" USING "btree" ("total_potential_share_exposure" DESC) WHERE ("total_potential_share_exposure" IS NOT NULL);



CREATE INDEX "event_offering_terms_type_idx" ON "public"."event_offering_terms" USING "btree" ("offering_type", "security_type", "overhang_level");



CREATE INDEX "event_theme_links_theme_idx" ON "public"."event_theme_links" USING "btree" ("theme_group_slug", "created_at" DESC);



CREATE INDEX "event_tickers_event_sort_idx" ON "public"."event_tickers" USING "btree" ("event_id", "sort_order");



CREATE INDEX "event_tickers_symbol_idx" ON "public"."event_tickers" USING "btree" ("symbol", "role");



CREATE INDEX "events_cross_group_key_idx" ON "public"."events" USING "btree" ("cross_group_event_key") WHERE ("cross_group_event_key" IS NOT NULL);



CREATE INDEX "events_detected_idx" ON "public"."events" USING "btree" ("detected_at" DESC);



CREATE INDEX "events_filings_feed_form_published_idx" ON "public"."events" USING "btree" ((("metadata" ->> 'form_type'::"text")), "published_at" DESC, "id" DESC) WHERE (("source_group" = 'filings'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND ("published_at" IS NOT NULL));



CREATE INDEX "events_filings_feed_published_idx" ON "public"."events" USING "btree" ("published_at" DESC, "id" DESC) WHERE (("source_group" = 'filings'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND ("published_at" IS NOT NULL));



CREATE INDEX "events_filings_feed_score_published_idx" ON "public"."events" USING "btree" ("score", "published_at" DESC, "id" DESC) WHERE (("source_group" = 'filings'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND ("published_at" IS NOT NULL));



CREATE INDEX "events_filings_feed_signal_published_idx" ON "public"."events" USING "btree" ("signal", "published_at" DESC, "id" DESC) WHERE (("source_group" = 'filings'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND ("published_at" IS NOT NULL));



CREATE INDEX "events_filings_feed_type_published_idx" ON "public"."events" USING "btree" ("event_type", "published_at" DESC, "id" DESC) WHERE (("source_group" = 'filings'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND ("published_at" IS NOT NULL));



CREATE UNIQUE INDEX "events_group_dedupe_idx" ON "public"."events" USING "btree" ("source_group", "group_dedupe_key");



CREATE INDEX "events_group_detected_idx" ON "public"."events" USING "btree" ("source_group", "detected_at" DESC);



CREATE INDEX "events_market_scope_score_idx" ON "public"."events" USING "btree" ("market_scope", "score" DESC, "detected_at" DESC);



CREATE INDEX "events_news_feed_effective_published_idx" ON "public"."events" USING "btree" (COALESCE("published_at", "detected_at") DESC, "id" DESC) WHERE (("source_group" = 'news'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND (COALESCE("published_at", "detected_at") IS NOT NULL));



CREATE INDEX "events_news_feed_search_trgm_idx" ON "public"."events" USING "gin" ("public"."news_v2_search_document"("ticker", ("metadata" ->> 'company_name'::"text"), ("metadata" ->> 'company'::"text"), ("metadata" ->> 'issuer'::"text"), "source_code", "source_name", "event_type", "sector", "theme_group", "sub_theme", "title", "summary", "quick_take") "extensions"."gin_trgm_ops") WHERE (("source_group" = 'news'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND (COALESCE("published_at", "detected_at") IS NOT NULL));



CREATE INDEX "events_news_feed_sector_published_idx" ON "public"."events" USING "btree" (NULLIF("btrim"("sector"), ''::"text"), COALESCE("published_at", "detected_at") DESC, "id" DESC) WHERE (("source_group" = 'news'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND (COALESCE("published_at", "detected_at") IS NOT NULL));



CREATE INDEX "events_news_feed_signal_published_idx" ON "public"."events" USING "btree" ("signal", COALESCE("published_at", "detected_at") DESC, "id" DESC) WHERE (("source_group" = 'news'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND (COALESCE("published_at", "detected_at") IS NOT NULL));



CREATE INDEX "events_news_feed_source_label_published_idx" ON "public"."events" USING "btree" ("public"."news_v2_source_label"("source_code", "source_name"), COALESCE("published_at", "detected_at") DESC, "id" DESC) WHERE (("source_group" = 'news'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND (COALESCE("published_at", "detected_at") IS NOT NULL));



CREATE INDEX "events_news_feed_source_published_idx" ON "public"."events" USING "btree" ("source_code", COALESCE("published_at", "detected_at") DESC, "id" DESC) WHERE (("source_group" = 'news'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND (COALESCE("published_at", "detected_at") IS NOT NULL));



CREATE INDEX "events_news_feed_sub_theme_published_idx" ON "public"."events" USING "btree" (NULLIF("btrim"("sub_theme"), ''::"text"), COALESCE("published_at", "detected_at") DESC, "id" DESC) WHERE (("source_group" = 'news'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND (COALESCE("published_at", "detected_at") IS NOT NULL));



CREATE INDEX "events_news_feed_theme_published_idx" ON "public"."events" USING "btree" (NULLIF("btrim"("theme_group"), ''::"text"), COALESCE("published_at", "detected_at") DESC, "id" DESC) WHERE (("source_group" = 'news'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND (COALESCE("published_at", "detected_at") IS NOT NULL));



CREATE INDEX "events_news_feed_type_published_idx" ON "public"."events" USING "btree" ("event_type", COALESCE("published_at", "detected_at") DESC, "id" DESC) WHERE (("source_group" = 'news'::"public"."source_group") AND ("delivery_level" <> 'archive'::"public"."event_delivery_level") AND (COALESCE("published_at", "detected_at") IS NOT NULL));



CREATE INDEX "events_news_market_scope_idx" ON "public"."events" USING "btree" ("source_group", "market_scope", "detected_at" DESC) WHERE ("source_group" = 'news'::"public"."source_group");



CREATE INDEX "events_score_idx" ON "public"."events" USING "btree" ("score" DESC, "delivery_level");



CREATE INDEX "events_source_detected_idx" ON "public"."events" USING "btree" ("source_code", "detected_at" DESC);



CREATE INDEX "events_ticker_detected_idx" ON "public"."events" USING "btree" ("ticker", "detected_at" DESC) WHERE ("ticker" IS NOT NULL);



CREATE INDEX "events_type_delivery_idx" ON "public"."events" USING "btree" ("event_type", "delivery_level");



CREATE INDEX "fmp_industry_mappings_lookup_idx" ON "public"."fmp_industry_mappings" USING "btree" ("fmp_industry", "priority");



CREATE INDEX "live_room_actor_blocks_blocked_guest_idx" ON "public"."live_room_actor_blocks" USING "btree" ("blocked_guest_session_id") WHERE ("blocked_guest_session_id" IS NOT NULL);



CREATE INDEX "live_room_actor_blocks_blocked_idx" ON "public"."live_room_actor_blocks" USING "btree" ("blocked_kind", "blocked_actor_id");



CREATE INDEX "live_room_actor_blocks_blocked_member_idx" ON "public"."live_room_actor_blocks" USING "btree" ("blocked_member_user_id") WHERE ("blocked_member_user_id" IS NOT NULL);



CREATE INDEX "live_room_actor_blocks_blocker_guest_idx" ON "public"."live_room_actor_blocks" USING "btree" ("blocker_guest_session_id") WHERE ("blocker_guest_session_id" IS NOT NULL);



CREATE INDEX "live_room_actor_blocks_blocker_idx" ON "public"."live_room_actor_blocks" USING "btree" ("blocker_kind", "blocker_actor_id", "created_at" DESC);



CREATE INDEX "live_room_actor_blocks_blocker_member_idx" ON "public"."live_room_actor_blocks" USING "btree" ("blocker_member_user_id") WHERE ("blocker_member_user_id" IS NOT NULL);



CREATE INDEX "live_room_community_rooms_activity_idx" ON "public"."live_room_community_rooms" USING "btree" ("last_activity_at" DESC, "slug" DESC);



CREATE INDEX "live_room_community_rooms_created_idx" ON "public"."live_room_community_rooms" USING "btree" ("created_at" DESC, "slug" DESC);



CREATE INDEX "live_room_community_rooms_focus_tags_gin_idx" ON "public"."live_room_community_rooms" USING "gin" ("focus_tags");



CREATE INDEX "live_room_community_rooms_industries_gin_idx" ON "public"."live_room_community_rooms" USING "gin" ("industries");



CREATE INDEX "live_room_community_rooms_language_activity_idx" ON "public"."live_room_community_rooms" USING "btree" ("language", "last_activity_at" DESC, "slug" DESC);



CREATE INDEX "live_room_community_rooms_owner_created_idx" ON "public"."live_room_community_rooms" USING "btree" ("owner_user_id", "created_at" DESC);



CREATE INDEX "live_room_community_rooms_search_gin_idx" ON "public"."live_room_community_rooms" USING "gin" ("search_document");



CREATE INDEX "live_room_community_rooms_style_activity_idx" ON "public"."live_room_community_rooms" USING "btree" ("room_style", "last_activity_at" DESC, "slug" DESC);



CREATE INDEX "live_room_community_rooms_themes_gin_idx" ON "public"."live_room_community_rooms" USING "gin" ("themes");



CREATE INDEX "live_room_community_rooms_topic_activity_idx" ON "public"."live_room_community_rooms" USING "btree" ("topic", "last_activity_at" DESC, "slug" DESC);



CREATE INDEX "live_room_direct_conversations_high_status_updated_idx" ON "public"."live_room_direct_conversations" USING "btree" ("member_high_user_id", "status", "updated_at" DESC, "id" DESC);



CREATE INDEX "live_room_direct_conversations_high_updated_idx" ON "public"."live_room_direct_conversations" USING "btree" ("member_high_user_id", "updated_at" DESC, "id" DESC);



CREATE INDEX "live_room_direct_conversations_low_status_updated_idx" ON "public"."live_room_direct_conversations" USING "btree" ("member_low_user_id", "status", "updated_at" DESC, "id" DESC);



CREATE INDEX "live_room_direct_conversations_low_updated_idx" ON "public"."live_room_direct_conversations" USING "btree" ("member_low_user_id", "updated_at" DESC, "id" DESC);



CREATE INDEX "live_room_direct_conversations_request_sender_idx" ON "public"."live_room_direct_conversations" USING "btree" ("request_sender_user_id") WHERE ("request_sender_user_id" IS NOT NULL);



CREATE INDEX "live_room_direct_message_reports_conversation_idx" ON "public"."live_room_direct_message_reports" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "live_room_direct_message_reports_conversation_message_idx" ON "public"."live_room_direct_message_reports" USING "btree" ("conversation_id", "message_id");



CREATE INDEX "live_room_direct_message_reports_message_idx" ON "public"."live_room_direct_message_reports" USING "btree" ("message_id");



CREATE INDEX "live_room_direct_message_reports_priority_idx" ON "public"."live_room_direct_message_reports" USING "btree" ("priority" DESC, "created_at");



CREATE INDEX "live_room_direct_message_reports_reporter_idx" ON "public"."live_room_direct_message_reports" USING "btree" ("reporter_user_id", "created_at" DESC);



CREATE INDEX "live_room_direct_messages_conversation_cursor_idx" ON "public"."live_room_direct_messages" USING "btree" ("conversation_id", "created_at" DESC, "id" DESC);



CREATE UNIQUE INDEX "live_room_direct_messages_conversation_id_uidx" ON "public"."live_room_direct_messages" USING "btree" ("conversation_id", "id");



CREATE UNIQUE INDEX "live_room_direct_messages_one_request_idx" ON "public"."live_room_direct_messages" USING "btree" ("conversation_id") WHERE ("message_kind" = 'request'::"text");



CREATE INDEX "live_room_direct_messages_sender_recent_idx" ON "public"."live_room_direct_messages" USING "btree" ("sender_user_id", "created_at" DESC, "id" DESC);



CREATE INDEX "live_room_direct_reads_member_idx" ON "public"."live_room_direct_reads" USING "btree" ("member_user_id", "updated_at" DESC);



CREATE INDEX "live_room_direct_reads_message_idx" ON "public"."live_room_direct_reads" USING "btree" ("last_read_message_id") WHERE ("last_read_message_id" IS NOT NULL);



CREATE INDEX "live_room_follows_actor_idx" ON "public"."live_room_follows" USING "btree" ("actor_kind", "actor_id", "updated_at" DESC);



CREATE INDEX "live_room_follows_guest_session_idx" ON "public"."live_room_follows" USING "btree" ("guest_session_id") WHERE ("guest_session_id" IS NOT NULL);



CREATE INDEX "live_room_follows_member_user_idx" ON "public"."live_room_follows" USING "btree" ("member_user_id") WHERE ("member_user_id" IS NOT NULL);



CREATE INDEX "live_room_follows_unread_actor_idx" ON "public"."live_room_follows" USING "btree" ("actor_kind", "actor_id", "updated_at" DESC) WHERE ("followed" = true);



CREATE INDEX "live_room_guest_sessions_expiry_idx" ON "public"."live_room_guest_sessions" USING "btree" ("expires_at");



CREATE INDEX "live_room_member_follows_activity_cursor_idx" ON "public"."live_room_member_follows" USING "btree" ("follower_user_id", "last_read_at", "followed_user_id");



CREATE INDEX "live_room_member_follows_followed_user_idx" ON "public"."live_room_member_follows" USING "btree" ("followed_user_id", "created_at" DESC);



CREATE INDEX "live_room_member_follows_read_message_idx" ON "public"."live_room_member_follows" USING "btree" ("last_read_message_id") WHERE ("last_read_message_id" IS NOT NULL);



CREATE INDEX "live_room_member_presence_ticker_seen_idx" ON "public"."live_room_member_presence" USING "btree" ("ticker", "last_seen_at" DESC);



CREATE UNIQUE INDEX "live_room_member_profiles_public_profile_id_idx" ON "public"."live_room_member_profiles" USING "btree" ("public_profile_id");



CREATE INDEX "live_room_message_reports_guest_idx" ON "public"."live_room_message_reports" USING "btree" ("reporter_guest_session_id") WHERE ("reporter_guest_session_id" IS NOT NULL);



CREATE INDEX "live_room_message_reports_member_idx" ON "public"."live_room_message_reports" USING "btree" ("reporter_member_user_id") WHERE ("reporter_member_user_id" IS NOT NULL);



CREATE INDEX "live_room_message_reports_message_idx" ON "public"."live_room_message_reports" USING "btree" ("message_id", "created_at" DESC);



CREATE INDEX "live_room_messages_actor_recent_idx" ON "public"."live_room_messages" USING "btree" ("author_kind", "actor_id", "created_at" DESC) WHERE (("visibility_status" = 'visible'::"text") AND ("actor_id" IS NOT NULL));



CREATE INDEX "live_room_messages_event_idx" ON "public"."live_room_messages" USING "btree" ("referenced_event_id") WHERE ("referenced_event_id" IS NOT NULL);



CREATE INDEX "live_room_messages_guest_session_idx" ON "public"."live_room_messages" USING "btree" ("guest_session_id") WHERE ("guest_session_id" IS NOT NULL);



CREATE INDEX "live_room_messages_member_activity_idx" ON "public"."live_room_messages" USING "btree" ("member_user_id", "created_at" DESC, "id" DESC) WHERE (("author_kind" = 'member'::"text") AND ("visibility_status" = 'visible'::"text") AND ("member_user_id" IS NOT NULL));



CREATE INDEX "live_room_messages_member_user_idx" ON "public"."live_room_messages" USING "btree" ("member_user_id") WHERE ("member_user_id" IS NOT NULL);



CREATE INDEX "live_room_messages_room_change_cursor_idx" ON "public"."live_room_messages" USING "btree" ("room_id", "updated_at", "id");



CREATE INDEX "live_room_messages_room_cursor_idx" ON "public"."live_room_messages" USING "btree" ("room_id", "created_at" DESC, "id" DESC) WHERE ("visibility_status" = 'visible'::"text");



CREATE INDEX "live_room_moderation_actions_message_idx" ON "public"."live_room_moderation_actions" USING "btree" ("message_id", "created_at" DESC);



CREATE INDEX "live_room_moderation_actions_moderator_idx" ON "public"."live_room_moderation_actions" USING "btree" ("moderator_user_id", "created_at" DESC) WHERE ("moderator_user_id" IS NOT NULL);



CREATE INDEX "live_room_post_activity_comment_idx" ON "public"."live_room_post_activity" USING "btree" ("comment_id") WHERE ("comment_id" IS NOT NULL);



CREATE INDEX "live_room_post_activity_post_idx" ON "public"."live_room_post_activity" USING "btree" ("post_id");



CREATE INDEX "live_room_post_activity_recipient_created_idx" ON "public"."live_room_post_activity" USING "btree" ("recipient_user_id", "created_at" DESC, "id" DESC);



CREATE INDEX "live_room_post_activity_recipient_unread_idx" ON "public"."live_room_post_activity" USING "btree" ("recipient_user_id", "created_at" DESC, "id" DESC) WHERE ("read_at" IS NULL);



CREATE INDEX "live_room_post_comment_reports_comment_idx" ON "public"."live_room_post_comment_reports" USING "btree" ("comment_id", "created_at" DESC);



CREATE INDEX "live_room_post_comment_reports_guest_idx" ON "public"."live_room_post_comment_reports" USING "btree" ("reporter_guest_session_id") WHERE ("reporter_guest_session_id" IS NOT NULL);



CREATE INDEX "live_room_post_comment_reports_member_idx" ON "public"."live_room_post_comment_reports" USING "btree" ("reporter_member_user_id") WHERE ("reporter_member_user_id" IS NOT NULL);



CREATE INDEX "live_room_post_comments_author_created_idx" ON "public"."live_room_post_comments" USING "btree" ("author_user_id", "created_at" DESC) WHERE ("visibility_status" = 'visible'::"text");



CREATE INDEX "live_room_post_comments_parent_idx" ON "public"."live_room_post_comments" USING "btree" ("parent_comment_id", "created_at") WHERE (("parent_comment_id" IS NOT NULL) AND ("visibility_status" = 'visible'::"text"));



CREATE INDEX "live_room_post_comments_post_created_idx" ON "public"."live_room_post_comments" USING "btree" ("post_id", "created_at", "id") WHERE ("visibility_status" = 'visible'::"text");



CREATE INDEX "live_room_post_moderation_actions_moderator_idx" ON "public"."live_room_post_moderation_actions" USING "btree" ("moderator_user_id", "created_at" DESC) WHERE ("moderator_user_id" IS NOT NULL);



CREATE INDEX "live_room_post_moderation_actions_post_idx" ON "public"."live_room_post_moderation_actions" USING "btree" ("post_id", "created_at" DESC);



CREATE INDEX "live_room_post_reports_guest_idx" ON "public"."live_room_post_reports" USING "btree" ("reporter_guest_session_id") WHERE ("reporter_guest_session_id" IS NOT NULL);



CREATE INDEX "live_room_post_reports_member_idx" ON "public"."live_room_post_reports" USING "btree" ("reporter_member_user_id") WHERE ("reporter_member_user_id" IS NOT NULL);



CREATE INDEX "live_room_post_reports_post_idx" ON "public"."live_room_post_reports" USING "btree" ("post_id", "created_at" DESC);



CREATE INDEX "live_room_posts_author_created_idx" ON "public"."live_room_posts" USING "btree" ("author_user_id", "created_at" DESC, "id" DESC) WHERE ("visibility_status" = 'visible'::"text");



CREATE INDEX "live_room_posts_event_idx" ON "public"."live_room_posts" USING "btree" ("referenced_event_id") WHERE ("referenced_event_id" IS NOT NULL);



CREATE INDEX "live_room_posts_related_tickers_gin_idx" ON "public"."live_room_posts" USING "gin" ("related_tickers") WHERE ("visibility_status" = 'visible'::"text");



CREATE INDEX "live_room_posts_room_created_idx" ON "public"."live_room_posts" USING "btree" ("room_id", "created_at" DESC, "id" DESC) WHERE ("visibility_status" = 'visible'::"text");



CREATE INDEX "live_room_posts_room_updated_idx" ON "public"."live_room_posts" USING "btree" ("room_id", "updated_at", "id");



CREATE UNIQUE INDEX "live_room_rooms_issuer_unique_idx" ON "public"."live_room_rooms" USING "btree" ("issuer_id") WHERE ("issuer_id" IS NOT NULL);



CREATE UNIQUE INDEX "live_room_social_verifications_handle_review_uidx" ON "public"."live_room_social_verifications" USING "btree" ("platform", "normalized_handle") WHERE ("status" = ANY (ARRAY['pending_review'::"text", 'verified'::"text"]));



CREATE INDEX "live_room_social_verifications_member_created_idx" ON "public"."live_room_social_verifications" USING "btree" ("member_user_id", "created_at" DESC, "id" DESC);



CREATE UNIQUE INDEX "live_room_social_verifications_member_platform_active_uidx" ON "public"."live_room_social_verifications" USING "btree" ("member_user_id", "platform") WHERE ("status" = ANY (ARRAY['draft'::"text", 'proof_ready'::"text", 'pending_review'::"text", 'verified'::"text"]));



CREATE INDEX "live_room_social_verifications_pending_idx" ON "public"."live_room_social_verifications" USING "btree" ("submitted_at", "id") WHERE ("status" = 'pending_review'::"text");



CREATE UNIQUE INDEX "live_room_social_verifications_proof_code_uidx" ON "public"."live_room_social_verifications" USING "btree" ("proof_code");



CREATE INDEX "live_room_social_verifications_public_badge_idx" ON "public"."live_room_social_verifications" USING "btree" ("member_user_id", "platform") WHERE (("status" = 'verified'::"text") AND ("show_on_profile" = true));



CREATE INDEX "live_room_social_verifications_reviewed_by_idx" ON "public"."live_room_social_verifications" USING "btree" ("reviewed_by");



CREATE INDEX "market_bars_expires_idx" ON "public"."market_bars" USING "btree" ("expires_at");



CREATE INDEX "market_group_snapshots_expires_idx" ON "public"."market_group_snapshots" USING "btree" ("expires_at");



CREATE INDEX "market_group_snapshots_parent_idx" ON "public"."market_group_snapshots" USING "btree" ("parent_key", "range", "interval", "sort_order");



CREATE INDEX "market_quotes_expires_idx" ON "public"."market_quotes" USING "btree" ("expires_at");



CREATE INDEX "market_snapshots_ticker_fetched_idx" ON "public"."market_snapshots" USING "btree" ("ticker", "fetched_at" DESC);



CREATE INDEX "notification_subscriptions_channel_idx" ON "public"."notification_subscriptions" USING "btree" ("channel", "enabled");



CREATE UNIQUE INDEX "prompt_templates_active_key_idx" ON "public"."prompt_templates" USING "btree" ("key") WHERE ("is_active" = true);



CREATE INDEX "raw_items_group_published_idx" ON "public"."raw_items" USING "btree" ("source_group", "published_at" DESC);



CREATE UNIQUE INDEX "raw_items_source_dedupe_idx" ON "public"."raw_items" USING "btree" ("source_code", "dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE UNIQUE INDEX "raw_items_source_unique_idx" ON "public"."raw_items" USING "btree" ("source_code", "source_unique_id") WHERE ("source_unique_id" IS NOT NULL);



CREATE INDEX "telegram_connect_tokens_expires_idx" ON "public"."telegram_connect_tokens" USING "btree" ("expires_at");



CREATE INDEX "telegram_connect_tokens_hash_idx" ON "public"."telegram_connect_tokens" USING "btree" ("token_hash");



CREATE INDEX "telegram_connect_tokens_user_idx" ON "public"."telegram_connect_tokens" USING "btree" ("user_id");



CREATE INDEX "theme_snapshots_theme_asof_idx" ON "public"."theme_snapshots" USING "btree" ("theme_group_slug", "as_of" DESC);



CREATE INDEX "ticker_classifications_sector_idx" ON "public"."ticker_classifications" USING "btree" ("sector_code", "sub_category_slug");



CREATE INDEX "ticker_theme_members_theme_idx" ON "public"."ticker_theme_members" USING "btree" ("theme_group_slug", "symbol");



CREATE INDEX "tickers_asset_type_idx" ON "public"."tickers" USING "btree" ("asset_type") WHERE ("asset_type" IS NOT NULL);



CREATE INDEX "tickers_fmp_industry_idx" ON "public"."tickers" USING "btree" ("fmp_industry") WHERE ("fmp_industry" IS NOT NULL);



CREATE INDEX "user_alert_deliveries_category_time_idx" ON "public"."user_alert_deliveries" USING "btree" ("user_id", "category", "delivered_at" DESC) WHERE ("category" IS NOT NULL);



CREATE INDEX "user_alert_deliveries_event_idx" ON "public"."user_alert_deliveries" USING "btree" ("alert_event_id") WHERE ("alert_event_id" IS NOT NULL);



CREATE INDEX "user_alert_deliveries_lane_time_idx" ON "public"."user_alert_deliveries" USING "btree" ("user_id", "alert_lane", "delivered_at" DESC);



CREATE INDEX "user_alert_deliveries_status_scheduled_idx" ON "public"."user_alert_deliveries" USING "btree" ("delivery_status", "scheduled_for");



CREATE UNIQUE INDEX "user_alert_deliveries_user_dedupe_key_unique" ON "public"."user_alert_deliveries" USING "btree" ("user_id", "dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE INDEX "user_alert_deliveries_user_status_scheduled_idx" ON "public"."user_alert_deliveries" USING "btree" ("user_id", "delivery_status", "scheduled_for");



CREATE INDEX "user_alert_deliveries_user_time_idx" ON "public"."user_alert_deliveries" USING "btree" ("user_id", "delivered_at" DESC);



CREATE INDEX "user_alert_tickers_user_enabled_idx" ON "public"."user_alert_tickers" USING "btree" ("user_id", "enabled", "ticker");



CREATE INDEX "user_delivery_channels_user_idx" ON "public"."user_delivery_channels" USING "btree" ("user_id", "channel", "enabled");



CREATE INDEX "user_delivery_channels_user_only_idx" ON "public"."user_delivery_channels" USING "btree" ("user_id");



CREATE INDEX "user_discovery_categories_user_enabled_idx" ON "public"."user_discovery_categories" USING "btree" ("user_id", "enabled");



CREATE INDEX "user_discovery_categories_user_idx" ON "public"."user_discovery_categories" USING "btree" ("user_id", "enabled", "category");



CREATE INDEX "user_discovery_categories_user_only_idx" ON "public"."user_discovery_categories" USING "btree" ("user_id");



CREATE INDEX "user_plan_subscriptions_trial_ends_at_idx" ON "public"."user_plan_subscriptions" USING "btree" ("trial_ends_at") WHERE ("trial_ends_at" IS NOT NULL);



CREATE INDEX "user_plan_subscriptions_user_idx" ON "public"."user_plan_subscriptions" USING "btree" ("user_id");



CREATE INDEX "watchlist_tickers_user_idx" ON "public"."watchlist_tickers" USING "btree" ("user_id", "ticker");



CREATE INDEX "watchlist_tickers_user_only_idx" ON "public"."watchlist_tickers" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "alert_delivery_event_runs_set_updated_at" BEFORE UPDATE ON "public"."alert_delivery_event_runs" FOR EACH ROW EXECUTE FUNCTION "public"."set_alert_delivery_event_runs_updated_at"();



CREATE OR REPLACE TRIGGER "alert_preferences_set_updated_at" BEFORE UPDATE ON "public"."alert_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_alert_updated_at"();



CREATE OR REPLACE TRIGGER "live_room_follows_set_updated_at" BEFORE UPDATE ON "public"."live_room_follows" FOR EACH ROW EXECUTE FUNCTION "private"."set_live_room_updated_at"();



CREATE OR REPLACE TRIGGER "live_room_guest_profiles_set_updated_at" BEFORE UPDATE ON "public"."live_room_guest_profiles" FOR EACH ROW EXECUTE FUNCTION "private"."set_live_room_updated_at"();



CREATE OR REPLACE TRIGGER "live_room_member_profiles_set_updated_at" BEFORE UPDATE ON "public"."live_room_member_profiles" FOR EACH ROW EXECUTE FUNCTION "private"."set_live_room_updated_at"();



CREATE OR REPLACE TRIGGER "live_room_messages_broadcast_change" AFTER INSERT OR UPDATE OF "visibility_status" ON "public"."live_room_messages" FOR EACH ROW EXECUTE FUNCTION "private"."broadcast_live_room_message_change"();



CREATE OR REPLACE TRIGGER "live_room_messages_set_updated_at" BEFORE UPDATE ON "public"."live_room_messages" FOR EACH ROW EXECUTE FUNCTION "private"."set_live_room_updated_at"();



CREATE OR REPLACE TRIGGER "live_room_messages_touch_community_activity" AFTER INSERT ON "public"."live_room_messages" FOR EACH ROW EXECUTE FUNCTION "private"."touch_live_room_community_activity"();



CREATE OR REPLACE TRIGGER "live_room_moderators_set_updated_at" BEFORE UPDATE ON "public"."live_room_moderators" FOR EACH ROW EXECUTE FUNCTION "private"."set_live_room_updated_at"();



CREATE OR REPLACE TRIGGER "live_room_post_comments_enqueue_activity" AFTER INSERT ON "public"."live_room_post_comments" FOR EACH ROW EXECUTE FUNCTION "private"."enqueue_live_room_comment_activity"();



CREATE OR REPLACE TRIGGER "live_room_post_comments_set_updated_at" BEFORE UPDATE ON "public"."live_room_post_comments" FOR EACH ROW EXECUTE FUNCTION "private"."set_live_room_updated_at"();



CREATE OR REPLACE TRIGGER "live_room_post_comments_validate_parent" BEFORE INSERT OR UPDATE OF "post_id", "parent_comment_id" ON "public"."live_room_post_comments" FOR EACH ROW EXECUTE FUNCTION "private"."validate_live_room_post_comment_parent"();



CREATE OR REPLACE TRIGGER "live_room_post_cross_targets_guard" BEFORE INSERT OR UPDATE OF "room_id", "related_tickers" ON "public"."live_room_posts" FOR EACH ROW EXECUTE FUNCTION "public"."validate_live_room_post_cross_targets"();



CREATE OR REPLACE TRIGGER "live_room_posts_enqueue_activity" AFTER INSERT ON "public"."live_room_posts" FOR EACH ROW EXECUTE FUNCTION "private"."enqueue_live_room_post_activity"();



CREATE OR REPLACE TRIGGER "live_room_posts_set_updated_at" BEFORE UPDATE ON "public"."live_room_posts" FOR EACH ROW EXECUTE FUNCTION "private"."set_live_room_updated_at"();



CREATE OR REPLACE TRIGGER "live_room_posts_touch_community_activity" AFTER INSERT ON "public"."live_room_posts" FOR EACH ROW EXECUTE FUNCTION "private"."touch_live_room_community_activity"();



CREATE OR REPLACE TRIGGER "live_room_rooms_set_updated_at" BEFORE UPDATE ON "public"."live_room_rooms" FOR EACH ROW EXECUTE FUNCTION "private"."set_live_room_updated_at"();



CREATE OR REPLACE TRIGGER "user_alert_tickers_set_updated_at" BEFORE UPDATE ON "public"."user_alert_tickers" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_alert_updated_at"();



CREATE OR REPLACE TRIGGER "user_delivery_channels_set_updated_at" BEFORE UPDATE ON "public"."user_delivery_channels" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_alert_updated_at"();



CREATE OR REPLACE TRIGGER "user_discovery_categories_set_updated_at" BEFORE UPDATE ON "public"."user_discovery_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_alert_updated_at"();



CREATE OR REPLACE TRIGGER "user_plan_subscriptions_set_updated_at" BEFORE UPDATE ON "public"."user_plan_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_alert_updated_at"();



CREATE OR REPLACE TRIGGER "user_profiles_set_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_alert_updated_at"();



CREATE OR REPLACE TRIGGER "watchlist_tickers_set_updated_at" BEFORE UPDATE ON "public"."watchlist_tickers" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_alert_updated_at"();



ALTER TABLE ONLY "public"."ai_outputs"
    ADD CONSTRAINT "ai_outputs_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_outputs"
    ADD CONSTRAINT "ai_outputs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_runs"
    ADD CONSTRAINT "ai_runs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_runs"
    ADD CONSTRAINT "ai_runs_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."alert_delivery_event_runs"
    ADD CONSTRAINT "alert_delivery_event_runs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alert_preferences"
    ADD CONSTRAINT "alert_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."notification_subscriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_analysis"
    ADD CONSTRAINT "event_analysis_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_calendar_items"
    ADD CONSTRAINT "event_calendar_items_confirmed_by_event_id_fkey" FOREIGN KEY ("confirmed_by_event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_calendar_items"
    ADD CONSTRAINT "event_calendar_items_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_calendar_items"
    ADD CONSTRAINT "event_calendar_items_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "public"."sources"("code");



ALTER TABLE ONLY "public"."event_calendar_items"
    ADD CONSTRAINT "event_calendar_items_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_calendar_items"
    ADD CONSTRAINT "event_calendar_items_superseded_by_item_id_fkey" FOREIGN KEY ("superseded_by_item_id") REFERENCES "public"."event_calendar_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_links"
    ADD CONSTRAINT "event_links_left_event_id_fkey" FOREIGN KEY ("left_event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_links"
    ADD CONSTRAINT "event_links_right_event_id_fkey" FOREIGN KEY ("right_event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_offering_terms"
    ADD CONSTRAINT "event_offering_terms_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_offering_terms"
    ADD CONSTRAINT "event_offering_terms_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_theme_links"
    ADD CONSTRAINT "event_theme_links_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_theme_links"
    ADD CONSTRAINT "event_theme_links_theme_group_slug_fkey" FOREIGN KEY ("theme_group_slug") REFERENCES "public"."theme_groups"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_tickers"
    ADD CONSTRAINT "event_tickers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_event_type_fkey" FOREIGN KEY ("event_type") REFERENCES "public"."event_types"("code");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "public"."sources"("code");



ALTER TABLE ONLY "public"."fmp_industry_mappings"
    ADD CONSTRAINT "fmp_industry_mappings_sector_code_sub_category_slug_fkey" FOREIGN KEY ("sector_code", "sub_category_slug") REFERENCES "public"."market_sub_categories"("sector_code", "slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_actor_blocks"
    ADD CONSTRAINT "live_room_actor_blocks_blocked_guest_session_id_fkey" FOREIGN KEY ("blocked_guest_session_id") REFERENCES "public"."live_room_guest_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_actor_blocks"
    ADD CONSTRAINT "live_room_actor_blocks_blocked_member_user_id_fkey" FOREIGN KEY ("blocked_member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_actor_blocks"
    ADD CONSTRAINT "live_room_actor_blocks_blocker_guest_session_id_fkey" FOREIGN KEY ("blocker_guest_session_id") REFERENCES "public"."live_room_guest_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_actor_blocks"
    ADD CONSTRAINT "live_room_actor_blocks_blocker_member_user_id_fkey" FOREIGN KEY ("blocker_member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_community_rooms"
    ADD CONSTRAINT "live_room_community_rooms_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_community_rooms"
    ADD CONSTRAINT "live_room_community_rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."live_room_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_conversations"
    ADD CONSTRAINT "live_room_direct_conversations_member_high_user_id_fkey" FOREIGN KEY ("member_high_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_conversations"
    ADD CONSTRAINT "live_room_direct_conversations_member_low_user_id_fkey" FOREIGN KEY ("member_low_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_conversations"
    ADD CONSTRAINT "live_room_direct_conversations_request_sender_user_id_fkey" FOREIGN KEY ("request_sender_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_message_reports"
    ADD CONSTRAINT "live_room_direct_message_report_conversation_id_message_id_fkey" FOREIGN KEY ("conversation_id", "message_id") REFERENCES "public"."live_room_direct_messages"("conversation_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_message_reports"
    ADD CONSTRAINT "live_room_direct_message_reports_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."live_room_direct_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_message_reports"
    ADD CONSTRAINT "live_room_direct_message_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."live_room_direct_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_message_reports"
    ADD CONSTRAINT "live_room_direct_message_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_message_settings"
    ADD CONSTRAINT "live_room_direct_message_settings_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_messages"
    ADD CONSTRAINT "live_room_direct_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."live_room_direct_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_messages"
    ADD CONSTRAINT "live_room_direct_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_reads"
    ADD CONSTRAINT "live_room_direct_reads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."live_room_direct_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_direct_reads"
    ADD CONSTRAINT "live_room_direct_reads_last_read_message_id_fkey" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."live_room_direct_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_direct_reads"
    ADD CONSTRAINT "live_room_direct_reads_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_follows"
    ADD CONSTRAINT "live_room_follows_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "public"."live_room_guest_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_follows"
    ADD CONSTRAINT "live_room_follows_last_read_message_id_fkey" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."live_room_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_follows"
    ADD CONSTRAINT "live_room_follows_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_follows"
    ADD CONSTRAINT "live_room_follows_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."live_room_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_guest_profiles"
    ADD CONSTRAINT "live_room_guest_profiles_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "public"."live_room_guest_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_member_follows"
    ADD CONSTRAINT "live_room_member_follows_followed_user_id_fkey" FOREIGN KEY ("followed_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_member_follows"
    ADD CONSTRAINT "live_room_member_follows_follower_user_id_fkey" FOREIGN KEY ("follower_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_member_follows"
    ADD CONSTRAINT "live_room_member_follows_last_read_message_id_fkey" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."live_room_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_member_presence"
    ADD CONSTRAINT "live_room_member_presence_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_member_profiles"
    ADD CONSTRAINT "live_room_member_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_message_reports"
    ADD CONSTRAINT "live_room_message_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."live_room_messages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_message_reports"
    ADD CONSTRAINT "live_room_message_reports_reporter_guest_session_id_fkey" FOREIGN KEY ("reporter_guest_session_id") REFERENCES "public"."live_room_guest_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_message_reports"
    ADD CONSTRAINT "live_room_message_reports_reporter_member_user_id_fkey" FOREIGN KEY ("reporter_member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_messages"
    ADD CONSTRAINT "live_room_messages_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "public"."live_room_guest_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_messages"
    ADD CONSTRAINT "live_room_messages_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_messages"
    ADD CONSTRAINT "live_room_messages_referenced_event_id_fkey" FOREIGN KEY ("referenced_event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_messages"
    ADD CONSTRAINT "live_room_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."live_room_rooms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_moderation_actions"
    ADD CONSTRAINT "live_room_moderation_actions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."live_room_messages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_moderation_actions"
    ADD CONSTRAINT "live_room_moderation_actions_moderator_user_id_fkey" FOREIGN KEY ("moderator_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_moderators"
    ADD CONSTRAINT "live_room_moderators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_post_activity"
    ADD CONSTRAINT "live_room_post_activity_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_post_activity"
    ADD CONSTRAINT "live_room_post_activity_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."live_room_post_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_post_activity"
    ADD CONSTRAINT "live_room_post_activity_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."live_room_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_post_activity"
    ADD CONSTRAINT "live_room_post_activity_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_post_activity"
    ADD CONSTRAINT "live_room_post_activity_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."live_room_rooms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_post_comment_reports"
    ADD CONSTRAINT "live_room_post_comment_reports_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."live_room_post_comments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_post_comment_reports"
    ADD CONSTRAINT "live_room_post_comment_reports_reporter_guest_session_id_fkey" FOREIGN KEY ("reporter_guest_session_id") REFERENCES "public"."live_room_guest_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_post_comment_reports"
    ADD CONSTRAINT "live_room_post_comment_reports_reporter_member_user_id_fkey" FOREIGN KEY ("reporter_member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_post_comments"
    ADD CONSTRAINT "live_room_post_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_post_comments"
    ADD CONSTRAINT "live_room_post_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."live_room_post_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_post_comments"
    ADD CONSTRAINT "live_room_post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."live_room_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_post_moderation_actions"
    ADD CONSTRAINT "live_room_post_moderation_actions_moderator_user_id_fkey" FOREIGN KEY ("moderator_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_post_moderation_actions"
    ADD CONSTRAINT "live_room_post_moderation_actions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."live_room_posts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_post_reports"
    ADD CONSTRAINT "live_room_post_reports_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."live_room_posts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_post_reports"
    ADD CONSTRAINT "live_room_post_reports_reporter_guest_session_id_fkey" FOREIGN KEY ("reporter_guest_session_id") REFERENCES "public"."live_room_guest_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_post_reports"
    ADD CONSTRAINT "live_room_post_reports_reporter_member_user_id_fkey" FOREIGN KEY ("reporter_member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_posts"
    ADD CONSTRAINT "live_room_posts_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_posts"
    ADD CONSTRAINT "live_room_posts_referenced_event_id_fkey" FOREIGN KEY ("referenced_event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_room_posts"
    ADD CONSTRAINT "live_room_posts_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."live_room_rooms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."live_room_social_verifications"
    ADD CONSTRAINT "live_room_social_verifications_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_room_social_verifications"
    ADD CONSTRAINT "live_room_social_verifications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."market_sub_categories"
    ADD CONSTRAINT "market_sub_categories_sector_code_fkey" FOREIGN KEY ("sector_code") REFERENCES "public"."market_sectors"("code") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."raw_items"
    ADD CONSTRAINT "raw_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."source_runs"("id");



ALTER TABLE ONLY "public"."raw_items"
    ADD CONSTRAINT "raw_items_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "public"."sources"("code");



ALTER TABLE ONLY "public"."source_runs"
    ADD CONSTRAINT "source_runs_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "public"."sources"("code");



ALTER TABLE ONLY "public"."telegram_connect_tokens"
    ADD CONSTRAINT "telegram_connect_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."theme_snapshots"
    ADD CONSTRAINT "theme_snapshots_theme_group_slug_fkey" FOREIGN KEY ("theme_group_slug") REFERENCES "public"."theme_groups"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ticker_classifications"
    ADD CONSTRAINT "ticker_classifications_sector_code_fkey" FOREIGN KEY ("sector_code") REFERENCES "public"."market_sectors"("code");



ALTER TABLE ONLY "public"."ticker_classifications"
    ADD CONSTRAINT "ticker_classifications_sector_code_sub_category_slug_fkey" FOREIGN KEY ("sector_code", "sub_category_slug") REFERENCES "public"."market_sub_categories"("sector_code", "slug");



ALTER TABLE ONLY "public"."ticker_classifications"
    ADD CONSTRAINT "ticker_classifications_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "public"."tickers"("symbol") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ticker_theme_members"
    ADD CONSTRAINT "ticker_theme_members_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "public"."tickers"("symbol") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ticker_theme_members"
    ADD CONSTRAINT "ticker_theme_members_theme_group_slug_fkey" FOREIGN KEY ("theme_group_slug") REFERENCES "public"."theme_groups"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_alert_deliveries"
    ADD CONSTRAINT "user_alert_deliveries_alert_event_id_fkey" FOREIGN KEY ("alert_event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_alert_deliveries"
    ADD CONSTRAINT "user_alert_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_alert_tickers"
    ADD CONSTRAINT "user_alert_tickers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_delivery_channels"
    ADD CONSTRAINT "user_delivery_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_discovery_categories"
    ADD CONSTRAINT "user_discovery_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_plan_subscriptions"
    ADD CONSTRAINT "user_plan_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watchlist_tickers"
    ADD CONSTRAINT "watchlist_tickers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE "public"."ai_outputs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alert_delivery_event_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alert_delivery_job_locks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alert_delivery_scheduler_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alert_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_logo_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_extended_mover_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_mover_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dedupe_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_analysis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_calendar_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_offering_terms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_theme_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_tickers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fmp_industry_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingest_workflow_locks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_actor_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_community_rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_direct_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_direct_message_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_direct_message_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_direct_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_direct_reads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_follows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_guest_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_guest_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_member_follows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_member_presence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_member_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_message_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_moderation_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_moderators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_post_activity" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_post_comment_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_post_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_post_moderation_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_post_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_room_social_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_bars" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_group_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_quotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_sectors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_sub_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prompt_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."raw_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."schema_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."source_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."telegram_connect_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."theme_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."theme_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticker_classifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticker_theme_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tickers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_alert_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_alert_tickers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_delivery_channels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_discovery_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_plan_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watchlist_tickers" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "private"."broadcast_live_room_message_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."enable_rls_for_new_public_tables"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."enqueue_live_room_comment_activity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."enqueue_live_room_comment_activity"() TO "service_role";



REVOKE ALL ON FUNCTION "private"."enqueue_live_room_post_activity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."enqueue_live_room_post_activity"() TO "service_role";



REVOKE ALL ON FUNCTION "private"."set_live_room_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."touch_live_room_community_activity"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."validate_live_room_post_comment_parent"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."validate_live_room_post_comment_parent"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."acquire_alert_delivery_job_lock"("p_job_name" "text", "p_ttl_seconds" integer, "p_locked_by" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."acquire_alert_delivery_job_lock"("p_job_name" "text", "p_ttl_seconds" integer, "p_locked_by" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."acquire_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text", "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."acquire_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text", "p_ttl_seconds" integer) TO "service_role";



GRANT ALL ON TABLE "public"."live_room_actor_blocks" TO "service_role";



REVOKE ALL ON FUNCTION "public"."block_live_room_message_author"("p_room_id" "uuid", "p_message_id" "uuid", "p_blocker_kind" "text", "p_blocker_member_user_id" "uuid", "p_blocker_guest_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."block_live_room_message_author"("p_room_id" "uuid", "p_message_id" "uuid", "p_blocker_kind" "text", "p_blocker_member_user_id" "uuid", "p_blocker_guest_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."block_live_room_post_author"("p_post_id" "uuid", "p_blocker_kind" "text", "p_blocker_member_user_id" "uuid", "p_blocker_guest_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."block_live_room_post_author"("p_post_id" "uuid", "p_blocker_kind" "text", "p_blocker_member_user_id" "uuid", "p_blocker_guest_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_live_room_community_room"("p_owner_user_id" "uuid", "p_slug" "text", "p_name" "text", "p_summary" "text", "p_topic" "text", "p_room_style" "text", "p_focus_tags" "text"[], "p_language" "text", "p_related_tickers" "text"[], "p_themes" "text"[], "p_industries" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_live_room_community_room"("p_owner_user_id" "uuid", "p_slug" "text", "p_name" "text", "p_summary" "text", "p_topic" "text", "p_room_style" "text", "p_focus_tags" "text"[], "p_language" "text", "p_related_tickers" "text"[], "p_themes" "text"[], "p_industries" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."live_room_community_tickers_valid"("p_values" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."live_room_community_tickers_valid"("p_values" "text"[]) TO "service_role";



GRANT ALL ON TABLE "public"."live_room_posts" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_live_room_post"("p_room_id" "uuid", "p_author_user_id" "uuid", "p_title" "text", "p_body" "text", "p_related_tickers" "text"[], "p_referenced_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_live_room_post"("p_room_id" "uuid", "p_author_user_id" "uuid", "p_title" "text", "p_body" "text", "p_related_tickers" "text"[], "p_referenced_event_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."live_room_post_comments" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_live_room_post_comment"("p_post_id" "uuid", "p_author_user_id" "uuid", "p_body" "text", "p_parent_comment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_live_room_post_comment"("p_post_id" "uuid", "p_author_user_id" "uuid", "p_body" "text", "p_parent_comment_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."live_room_social_verifications" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_live_room_social_verification"("p_member_user_id" "uuid", "p_platform" "text", "p_normalized_handle" "text", "p_profile_url" "text", "p_proof_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_live_room_social_verification"("p_member_user_id" "uuid", "p_platform" "text", "p_normalized_handle" "text", "p_profile_url" "text", "p_proof_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_live_room_post"("p_post_id" "uuid", "p_author_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_live_room_post"("p_post_id" "uuid", "p_author_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_live_room_post_comment"("p_comment_id" "uuid", "p_author_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_live_room_post_comment"("p_comment_id" "uuid", "p_author_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_filings_v2_facets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_filings_v2_facets"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_activity_summary"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_people_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_activity_summary"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_people_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_community_room"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_community_room"("p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_direct_conversation"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_before_created_at" timestamp with time zone, "p_before_message_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_direct_conversation"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_before_created_at" timestamp with time zone, "p_before_message_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_direct_inbox"("p_requester_user_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_direct_inbox"("p_requester_user_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_direct_message_settings"("p_member_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_direct_message_settings"("p_member_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_member_presence_summary"("p_member_user_id" "uuid", "p_ticker" "text", "p_message_ids" "uuid"[], "p_message_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_member_presence_summary"("p_member_user_id" "uuid", "p_ticker" "text", "p_message_ids" "uuid"[], "p_message_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_post_activity_summary"("p_recipient_user_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_post_activity_summary"("p_recipient_user_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_presence_setting"("p_member_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_presence_setting"("p_member_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_social_badges"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_message_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_social_badges"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_message_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_room_unread_summary"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_room_unread_summary"("p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_news_v2_facets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_news_v2_facets"() TO "service_role";



GRANT ALL ON TABLE "public"."live_room_messages" TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_live_room_message"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_author_display_name" "text", "p_author_emoji" "text", "p_author_plan" "text", "p_body" "text", "p_referenced_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_live_room_message"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_author_display_name" "text", "p_author_emoji" "text", "p_author_plan" "text", "p_body" "text", "p_referenced_event_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_live_room_community_rooms"("p_topic" "text", "p_room_style" "text", "p_focus_tag" "text", "p_language" "text", "p_theme" "text", "p_industry" "text", "p_search" "text", "p_sort" "text", "p_after_at" timestamp with time zone, "p_after_slug" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_live_room_community_rooms"("p_topic" "text", "p_room_style" "text", "p_focus_tag" "text", "p_language" "text", "p_theme" "text", "p_industry" "text", "p_search" "text", "p_sort" "text", "p_after_at" timestamp with time zone, "p_after_slug" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_live_room_social_verification_reviews"("p_admin_user_id" "uuid", "p_cursor_submitted_at" timestamp with time zone, "p_cursor_public_request_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_live_room_social_verification_reviews"("p_admin_user_id" "uuid", "p_cursor_submitted_at" timestamp with time zone, "p_cursor_public_request_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."live_room_community_focus_tags_valid"("p_values" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."live_room_community_focus_tags_valid"("p_values" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."live_room_community_industries_valid"("p_values" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."live_room_community_industries_valid"("p_values" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."live_room_community_themes_valid"("p_values" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."live_room_community_themes_valid"("p_values" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_live_room_direct_conversation_read"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_message_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_live_room_direct_conversation_read"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_message_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_live_room_follow_read"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_message_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_live_room_follow_read"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_message_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_live_room_member_activity_read"("p_follower_user_id" "uuid", "p_room_id" "uuid", "p_message_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_live_room_member_activity_read"("p_follower_user_id" "uuid", "p_room_id" "uuid", "p_message_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_live_room_post_activity_read"("p_recipient_user_id" "uuid", "p_activity_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_live_room_post_activity_read"("p_recipient_user_id" "uuid", "p_activity_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."moderate_live_room_message"("p_room_id" "uuid", "p_message_id" "uuid", "p_moderator_user_id" "uuid", "p_action" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."moderate_live_room_message"("p_room_id" "uuid", "p_message_id" "uuid", "p_moderator_user_id" "uuid", "p_action" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."moderate_live_room_post"("p_post_id" "uuid", "p_moderator_user_id" "uuid", "p_action" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."moderate_live_room_post"("p_post_id" "uuid", "p_moderator_user_id" "uuid", "p_action" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mutate_live_room_social_verification"("p_member_user_id" "uuid", "p_public_request_id" "uuid", "p_action" "text", "p_proof_url" "text", "p_proof_code" "text", "p_show_on_profile" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mutate_live_room_social_verification"("p_member_user_id" "uuid", "p_public_request_id" "uuid", "p_action" "text", "p_proof_url" "text", "p_proof_code" "text", "p_show_on_profile" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."news_v2_search_document"("p_ticker" "text", "p_company_name" "text", "p_company" "text", "p_issuer" "text", "p_source_code" "text", "p_source_name" "text", "p_event_type" "text", "p_sector" "text", "p_theme_group" "text", "p_sub_theme" "text", "p_title" "text", "p_summary" "text", "p_quick_take" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."news_v2_search_document"("p_ticker" "text", "p_company_name" "text", "p_company" "text", "p_issuer" "text", "p_source_code" "text", "p_source_name" "text", "p_event_type" "text", "p_sector" "text", "p_theme_group" "text", "p_sub_theme" "text", "p_title" "text", "p_summary" "text", "p_quick_take" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."news_v2_source_label"("p_source_code" "text", "p_source_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."news_v2_source_label"("p_source_code" "text", "p_source_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_alert_delivery_job_lock"("p_job_name" "text", "p_locked_by" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_alert_delivery_job_lock"("p_job_name" "text", "p_locked_by" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."renew_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text", "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."renew_ingest_workflow_lock"("p_lock_key" "text", "p_lock_owner" "text", "p_ttl_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_live_room_direct_message"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_message_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_live_room_direct_message"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_message_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_live_room_message"("p_room_id" "uuid", "p_message_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_live_room_message"("p_room_id" "uuid", "p_message_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_live_room_post"("p_post_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_live_room_post"("p_post_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_live_room_post_comment"("p_comment_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_live_room_post_comment"("p_comment_id" "uuid", "p_reporter_kind" "text", "p_reporter_member_user_id" "uuid", "p_reporter_guest_session_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."respond_live_room_direct_request"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."respond_live_room_direct_request"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_action" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_live_room_social_verification"("p_admin_user_id" "uuid", "p_public_request_id" "uuid", "p_decision" "text", "p_review_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_live_room_social_verification"("p_admin_user_id" "uuid", "p_public_request_id" "uuid", "p_decision" "text", "p_review_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_filings_v2"("p_query" "text", "p_signals" "text"[], "p_market_caps" "text"[], "p_form_types" "text"[], "p_event_types" "text"[], "p_impacts" "text"[], "p_published_after" timestamp with time zone, "p_cursor_published_at" timestamp with time zone, "p_cursor_id" "uuid", "p_include_total" boolean, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_filings_v2"("p_query" "text", "p_signals" "text"[], "p_market_caps" "text"[], "p_form_types" "text"[], "p_event_types" "text"[], "p_impacts" "text"[], "p_published_after" timestamp with time zone, "p_cursor_published_at" timestamp with time zone, "p_cursor_id" "uuid", "p_include_total" boolean, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_news_v2"("p_query" "text", "p_signals" "text"[], "p_market_caps" "text"[], "p_event_types" "text"[], "p_sources" "text"[], "p_sectors" "text"[], "p_themes" "text"[], "p_cursor_published_at" timestamp with time zone, "p_cursor_id" "uuid", "p_include_total" boolean, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_news_v2"("p_query" "text", "p_signals" "text"[], "p_market_caps" "text"[], "p_event_types" "text"[], "p_sources" "text"[], "p_sectors" "text"[], "p_themes" "text"[], "p_cursor_published_at" timestamp with time zone, "p_cursor_id" "uuid", "p_include_total" boolean, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_live_room_direct_message"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_live_room_direct_message"("p_requester_user_id" "uuid", "p_conversation_public_id" "uuid", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_alert_delivery_event_runs_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_alert_delivery_event_runs_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."live_room_follows" TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_live_room_chat_follow"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_followed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_live_room_chat_follow"("p_room_id" "uuid", "p_actor_kind" "text", "p_member_user_id" "uuid", "p_guest_session_id" "uuid", "p_followed" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_live_room_direct_message_settings"("p_member_user_id" "uuid", "p_receive_mode" "text", "p_request_filter" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_live_room_direct_message_settings"("p_member_user_id" "uuid", "p_receive_mode" "text", "p_request_filter" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_live_room_member_follow"("p_follower_user_id" "uuid", "p_room_id" "uuid", "p_message_id" "uuid", "p_followed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_live_room_member_follow"("p_follower_user_id" "uuid", "p_room_id" "uuid", "p_message_id" "uuid", "p_followed" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_live_room_member_presence_heartbeat"("p_member_user_id" "uuid", "p_ticker" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_live_room_member_presence_heartbeat"("p_member_user_id" "uuid", "p_ticker" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_live_room_presence_setting"("p_member_user_id" "uuid", "p_show_presence" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_live_room_presence_setting"("p_member_user_id" "uuid", "p_show_presence" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_user_alert_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_user_alert_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_live_room_direct_conversation"("p_requester_user_id" "uuid", "p_source_message_id" "uuid", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_live_room_direct_conversation"("p_requester_user_id" "uuid", "p_source_message_id" "uuid", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_live_room_post"("p_post_id" "uuid", "p_author_user_id" "uuid", "p_title" "text", "p_body" "text", "p_related_tickers" "text"[], "p_referenced_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_live_room_post"("p_post_id" "uuid", "p_author_user_id" "uuid", "p_title" "text", "p_body" "text", "p_related_tickers" "text"[], "p_referenced_event_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_live_room_post_comment"("p_comment_id" "uuid", "p_author_user_id" "uuid", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_live_room_post_comment"("p_comment_id" "uuid", "p_author_user_id" "uuid", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_live_room_post_cross_targets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_live_room_post_cross_targets"() TO "service_role";



GRANT ALL ON TABLE "public"."ai_outputs" TO "service_role";



GRANT ALL ON TABLE "public"."ai_runs" TO "service_role";



GRANT ALL ON TABLE "public"."alert_delivery_event_runs" TO "service_role";



GRANT ALL ON TABLE "public"."alert_delivery_job_locks" TO "service_role";



GRANT ALL ON TABLE "public"."alert_delivery_scheduler_runs" TO "service_role";



GRANT ALL ON TABLE "public"."alert_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."company_logo_cache" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_extended_mover_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_mover_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."dedupe_keys" TO "service_role";



GRANT ALL ON TABLE "public"."deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."event_analysis" TO "service_role";



GRANT ALL ON TABLE "public"."event_calendar_items" TO "service_role";



GRANT ALL ON TABLE "public"."event_links" TO "service_role";



GRANT ALL ON TABLE "public"."event_offering_terms" TO "service_role";



GRANT ALL ON TABLE "public"."event_theme_links" TO "service_role";



GRANT ALL ON TABLE "public"."event_tickers" TO "service_role";



GRANT ALL ON TABLE "public"."event_types" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."fmp_industry_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."ingest_workflow_locks" TO "service_role";



GRANT ALL ON TABLE "public"."integration_configs" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_community_rooms" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_direct_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_direct_message_reports" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_direct_message_settings" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_direct_messages" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_direct_reads" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_guest_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_guest_sessions" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."live_room_member_follows" TO "service_role";
REVOKE REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."live_room_member_follows" FROM "service_role";



GRANT ALL ON TABLE "public"."live_room_member_presence" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_member_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_message_reports" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_moderation_actions" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_moderators" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_post_activity" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_post_comment_reports" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_post_moderation_actions" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_post_reports" TO "service_role";



GRANT ALL ON TABLE "public"."live_room_rooms" TO "service_role";



GRANT ALL ON TABLE "public"."market_bars" TO "service_role";



GRANT ALL ON TABLE "public"."market_group_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."market_quotes" TO "service_role";



GRANT ALL ON TABLE "public"."market_sectors" TO "service_role";



GRANT ALL ON TABLE "public"."market_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."market_sub_categories" TO "service_role";



GRANT ALL ON TABLE "public"."notification_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."prompt_templates" TO "service_role";



GRANT ALL ON TABLE "public"."raw_items" TO "service_role";



GRANT ALL ON TABLE "public"."schema_versions" TO "service_role";



GRANT ALL ON TABLE "public"."source_runs" TO "service_role";



GRANT ALL ON TABLE "public"."sources" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_connect_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."theme_groups" TO "service_role";



GRANT ALL ON TABLE "public"."theme_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."ticker_classifications" TO "service_role";



GRANT ALL ON TABLE "public"."ticker_theme_members" TO "service_role";



GRANT ALL ON TABLE "public"."tickers" TO "service_role";



GRANT ALL ON TABLE "public"."user_alert_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."user_alert_tickers" TO "service_role";



GRANT ALL ON TABLE "public"."user_delivery_channels" TO "service_role";



GRANT ALL ON TABLE "public"."user_discovery_categories" TO "service_role";



GRANT ALL ON TABLE "public"."user_plan_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."watchlist_tickers" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


-- Event triggers are database-scoped and are not emitted by a schema-filtered
-- pg_dump, so preserve the reviewed hosted-development definition explicitly.
DROP EVENT TRIGGER IF EXISTS "stock_radar_enable_public_table_rls";
CREATE EVENT TRIGGER "stock_radar_enable_public_table_rls"
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
EXECUTE FUNCTION "private"."enable_rls_for_new_public_tables"();
