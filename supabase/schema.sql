create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table if not exists public.profiles (
  player_token uuid primary key,
  nickname text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  password text,
  host_token uuid not null,
  max_players int not null check (max_players between 1 and 5),
  target_money numeric(10, 2) not null check (target_money > 0),
  starting_money numeric(10, 2) not null check (starting_money between 10 and 1000),
  base_bet numeric(10, 2) not null check (base_bet between 1 and 100),
  status text not null default 'waiting' check (status in ('waiting', 'in_game', 'finished')),
  winner_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.rooms
drop constraint if exists rooms_max_players_check;

alter table if exists public.rooms
add constraint rooms_max_players_check check (max_players between 1 and 5);

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_token uuid not null,
  nickname text not null,
  balance numeric(10, 2) not null check (balance >= 0),
  is_host boolean not null default false,
  is_ready boolean not null default false,
  status text not null default 'active' check (status in ('active', 'disconnected', 'eliminated', 'left')),
  last_seen_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, player_token),
  unique(room_id, nickname)
);

create table if not exists public.room_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_token uuid not null,
  nickname text not null,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_no int not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  state jsonb not null,
  started_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, round_no)
);

create table if not exists public.game_logs (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_id uuid references public.games(id) on delete set null,
  round_no int,
  event_type text not null,
  player_token uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_rooms_status_created_at on public.rooms(status, created_at desc);
create index if not exists idx_room_players_room_id on public.room_players(room_id);
create index if not exists idx_room_players_last_seen_at on public.room_players(last_seen_at);
create index if not exists idx_room_messages_room_id_created_at on public.room_messages(room_id, created_at);
create index if not exists idx_games_room_id_round_no on public.games(room_id, round_no desc);
create index if not exists idx_game_logs_room_id_created_at on public.game_logs(room_id, created_at desc);

create or replace function public.check_reconnect_eligibility(
  p_room_id uuid,
  p_player_token uuid
)
returns table (
  elapsed_sec int,
  can_reconnect boolean
)
language sql
security definer
as $$
  select
    greatest(0, floor(extract(epoch from (now() - rp.last_seen_at)))::int) as elapsed_sec,
    extract(epoch from (now() - rp.last_seen_at)) <= 30 as can_reconnect
  from public.room_players rp
  where rp.room_id = p_room_id
    and rp.player_token = p_player_token
    and rp.status in ('active', 'disconnected')
  order by rp.updated_at desc
  limit 1;
$$;

create or replace function public.get_reconnect_candidate(p_player_token uuid)
returns table (
  room_id uuid,
  room_name text,
  room_status text,
  last_seen_at timestamptz,
  elapsed_sec int,
  can_reconnect boolean
)
language sql
security definer
as $$
  select
    r.id as room_id,
    r.name as room_name,
    r.status as room_status,
    rp.last_seen_at,
    greatest(0, floor(extract(epoch from (now() - rp.last_seen_at)))::int) as elapsed_sec,
    extract(epoch from (now() - rp.last_seen_at)) <= 30 as can_reconnect
  from public.room_players rp
  join public.rooms r on r.id = rp.room_id
  where rp.player_token = p_player_token
    and rp.status in ('active', 'disconnected')
    and r.status <> 'finished'
  order by rp.updated_at desc
  limit 1;
$$;

create or replace function public.purge_old_game_logs()
returns void
language plpgsql
security definer
as $$
begin
  delete from public.game_logs
  where created_at < now() - interval '30 days';
end;
$$;

do $do$
declare
  has_job boolean;
begin
  if to_regclass('cron.job') is not null then
    execute $query$
      select exists (select 1 from cron.job where jobname = 'purge_game_logs_30d_daily')
    $query$
    into has_job;

    if not has_job then
      perform cron.schedule(
        'purge_game_logs_30d_daily',
        '10 4 * * *',
        $cron$select public.purge_old_game_logs();$cron$
      );
    end if;
  end if;
end
$do$;
