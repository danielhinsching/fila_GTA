-- Fila do GTA VI · Noite de Jogos Vice City
-- Tabelas com prefixo fila_ (não mexem em nada do LineUp). Toda escrita passa por funções (RPC).

create table if not exists fila_config (
  id int primary key default 1 check (id = 1),
  game_min int not null default 20,
  extend_min int not null default 10,
  gap_sec int not null default 30
);
insert into fila_config default values on conflict do nothing;

create table if not exists fila_secrets (
  station int primary key check (station between 1 and 4),
  pin text not null
);

create sequence if not exists fila_qseq;

create table if not exists fila_tickets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  station int not null check (station between 1 and 4),
  status text not null default 'waiting' check (status in ('waiting','playing','done','removed')),
  fast boolean not null default false,
  fast_at timestamptz,
  jumped_from int,
  extra_min int not null default 0,
  joined_at timestamptz not null default now(),
  queue_seq bigint not null default nextval('fila_qseq'),
  starts_at timestamptz,
  ends_at timestamptz
);
create index if not exists fila_tickets_station_status on fila_tickets (station, status);

-- ---------- acesso ----------
alter table fila_config enable row level security;
alter table fila_secrets enable row level security;
alter table fila_tickets enable row level security;
drop policy if exists fila_config_read on fila_config;
create policy fila_config_read on fila_config for select using (true);
drop policy if exists fila_tickets_read on fila_tickets;
create policy fila_tickets_read on fila_tickets for select using (status <> 'removed');
revoke all on fila_secrets from anon, authenticated;
revoke insert, update, delete on fila_tickets, fila_config from anon, authenticated;

-- ---------- helpers ----------
create or replace function fila_now() returns timestamptz language sql stable as $$ select now() $$;

create or replace function fila_check_pin(p_station int, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from fila_secrets where station = p_station and pin = btrim(coalesce(p_pin,''))) then
    raise exception 'PIN inválido' using errcode = '28000';
  end if;
end $$;

create or replace function fila_auth(p_station int, p_pin text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fila_secrets where station = p_station and pin = btrim(coalesce(p_pin,'')))
$$;

create or replace function fila_start_next(p_station int, p_start timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid; cfg fila_config;
begin
  select * into cfg from fila_config;
  select id into t from fila_tickets
   where station = p_station and status = 'waiting'
   order by fast desc, fast_at asc nulls last, queue_seq asc limit 1;
  if t is not null then
    update fila_tickets set status = 'playing', starts_at = p_start,
           ends_at = p_start + make_interval(mins => cfg.game_min)
     where id = t;
  end if;
end $$;

-- Idempotente: qualquer tela aberta (staff/telão) chama a cada poucos segundos.
create or replace function fila_tick() returns void
language plpgsql security definer set search_path = public as $$
declare s int; chain timestamptz; cfg fila_config;
begin
  perform pg_advisory_xact_lock(777);
  select * into cfg from fila_config;
  for s in 1..4 loop
    select ends_at into chain from fila_tickets
     where station = s and status = 'playing' and ends_at <= now() limit 1;
    if chain is not null then
      update fila_tickets set status = 'done' where station = s and status = 'playing' and ends_at <= now();
      perform fila_start_next(s, greatest(chain + make_interval(secs => cfg.gap_sec), now()));
    elsif not exists (select 1 from fila_tickets where station = s and status = 'playing') then
      perform fila_start_next(s, now() + make_interval(secs => cfg.gap_sec));
    end if;
    chain := null;
  end loop;
end $$;

-- ---------- ações do jogador ----------
create or replace function fila_join(p_name text) returns fila_tickets
language plpgsql security definer set search_path = public as $$
declare s int; best int; bestload numeric; load numeric; cfg fila_config; r fila_tickets;
begin
  perform pg_advisory_xact_lock(777);
  select * into cfg from fila_config;
  p_name := btrim(coalesce(p_name,''));
  if char_length(p_name) < 1 then raise exception 'Informe seu nome'; end if;
  p_name := left(p_name, 30);
  for s in 1..4 loop
    select coalesce((select greatest(extract(epoch from ends_at - now()),0) from fila_tickets where station = s and status = 'playing' limit 1),0)
         + (select count(*) from fila_tickets where station = s and status in ('waiting','playing')) * cfg.gap_sec
         + (select count(*) from fila_tickets where station = s and status = 'waiting') * cfg.game_min * 60
      into load;
    if bestload is null or load < bestload then best := s; bestload := load; end if;
  end loop;
  insert into fila_tickets (name, station) values (p_name, best) returning * into r;
  perform fila_tick();
  select * into r from fila_tickets where id = r.id;
  return r;
end $$;

-- ---------- ações do staff (PIN da estação) ----------
create or replace function fila_fast(p_ticket uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare t fila_tickets; rank int;
begin
  perform pg_advisory_xact_lock(777);
  select * into t from fila_tickets where id = p_ticket and status = 'waiting';
  if t.id is null then raise exception 'Ticket não está aguardando'; end if;
  perform fila_check_pin(t.station, p_pin);
  if t.fast then return; end if;
  select count(*) + 1 into rank from fila_tickets
   where station = t.station and status = 'waiting' and id <> t.id
     and (fast or queue_seq < t.queue_seq);
  update fila_tickets set fast = true, fast_at = now(), jumped_from = rank where id = t.id;
end $$;

create or replace function fila_unfast(p_ticket uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare t fila_tickets;
begin
  perform pg_advisory_xact_lock(777);
  select * into t from fila_tickets where id = p_ticket and status = 'waiting';
  if t.id is null then raise exception 'Ticket não está aguardando'; end if;
  perform fila_check_pin(t.station, p_pin);
  update fila_tickets set fast = false, fast_at = null, jumped_from = null where id = t.id;
end $$;

create or replace function fila_extend(p_station int, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare cfg fila_config; n int;
begin
  perform pg_advisory_xact_lock(777);
  perform fila_check_pin(p_station, p_pin);
  select * into cfg from fila_config;
  update fila_tickets set ends_at = ends_at + make_interval(mins => cfg.extend_min), extra_min = extra_min + cfg.extend_min
   where station = p_station and status = 'playing';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Ninguém jogando nesta estação'; end if;
end $$;

create or replace function fila_finish(p_station int, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fila_check_pin(p_station, p_pin);
  update fila_tickets set ends_at = now() where station = p_station and status = 'playing';
  perform fila_tick();
end $$;

-- Ausente: vai para o fim da fila; o próximo começa em 10s.
create or replace function fila_absent(p_ticket uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare t fila_tickets;
begin
  perform pg_advisory_xact_lock(777);
  select * into t from fila_tickets where id = p_ticket and status in ('waiting','playing');
  if t.id is null then raise exception 'Ticket não encontrado'; end if;
  perform fila_check_pin(t.station, p_pin);
  update fila_tickets set status = 'waiting', fast = false, fast_at = null, jumped_from = null,
         starts_at = null, ends_at = null, extra_min = 0, queue_seq = nextval('fila_qseq')
   where id = t.id;
  if t.status = 'playing' then
    perform fila_start_next(t.station, now() + interval '10 seconds');
  end if;
end $$;

create or replace function fila_remove(p_ticket uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare t fila_tickets;
begin
  perform pg_advisory_xact_lock(777);
  select * into t from fila_tickets where id = p_ticket and status in ('waiting','playing');
  if t.id is null then raise exception 'Ticket não encontrado'; end if;
  perform fila_check_pin(t.station, p_pin);
  update fila_tickets set status = 'removed' where id = t.id;
  if t.status = 'playing' then
    perform fila_start_next(t.station, now() + interval '10 seconds');
  end if;
end $$;

create or replace function fila_add(p_name text, p_station int, p_pin text, p_fast boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare w int;
begin
  perform pg_advisory_xact_lock(777);
  perform fila_check_pin(p_station, p_pin);
  p_name := left(btrim(coalesce(p_name,'')), 30);
  if p_name = '' then raise exception 'Informe o nome'; end if;
  select count(*) + 1 into w from fila_tickets where station = p_station and status = 'waiting';
  insert into fila_tickets (name, station, fast, fast_at, jumped_from)
  values (p_name, p_station, p_fast, case when p_fast then now() end, case when p_fast then w end);
  perform fila_tick();
end $$;

grant execute on function fila_auth(int,text), fila_now(), fila_tick(), fila_join(text), fila_fast(uuid,text), fila_unfast(uuid,text),
  fila_extend(int,text), fila_finish(int,text), fila_absent(uuid,text), fila_remove(uuid,text),
  fila_add(text,int,text,boolean) to anon, authenticated;
revoke execute on function fila_check_pin(int,text), fila_start_next(int,timestamptz) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'fila_tickets') then
    alter publication supabase_realtime add table fila_tickets;
  end if;
end $$;
