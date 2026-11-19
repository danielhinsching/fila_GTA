-- Fila do GTA VI · Noite de Jogos Vice City  (schema v2)
-- Seguro para rodar de novo: não apaga tickets existentes.
--
-- Segurança:
--  * A tabela de tickets é PRIVADA (RLS sem política de leitura). Ninguém lê direto com a chave pública.
--  * O jogador só recebe o próprio ticket (fila_me). O telão recebe o quadro público (fila_board).
--  * O staff usa fila_staff_view / fila_staff_do com PIN da estação (5 erros = bloqueio de 60 s).
--  * Um aparelho só pode ter 1 ticket ativo por vez.
--  * Tempo real: o front assina apenas fila_pulse (um contador) e busca os dados pelas funções acima.

-- ---------------------------------------------------------------- tabelas
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

create table if not exists fila_pin_guard (
  station int primary key,
  fails int not null default 0,
  locked_until timestamptz
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
alter table fila_tickets add column if not exists device text;
create index if not exists fila_tickets_station_status on fila_tickets (station, status);
create index if not exists fila_tickets_device on fila_tickets (device) where status in ('waiting','playing');

create table if not exists fila_pulse (id int primary key default 1 check (id = 1), n bigint not null default 0);
insert into fila_pulse default values on conflict do nothing;

-- ---------------------------------------------------------------- limpeza da versão anterior
drop function if exists fila_fast(uuid,text), fila_unfast(uuid,text), fila_extend(int,text), fila_finish(int,text),
  fila_absent(uuid,text), fila_remove(uuid,text), fila_add(text,int,text,boolean), fila_auth(int,text),
  fila_join(text), fila_check_pin(int,text);

-- ---------------------------------------------------------------- acesso
alter table fila_config enable row level security;
alter table fila_secrets enable row level security;
alter table fila_pin_guard enable row level security;
alter table fila_tickets enable row level security;
alter table fila_pulse enable row level security;
drop policy if exists fila_tickets_read on fila_tickets;            -- v1 liberava leitura: removido
drop policy if exists fila_config_read on fila_config;
create policy fila_config_read on fila_config for select using (true);
drop policy if exists fila_pulse_read on fila_pulse;
create policy fila_pulse_read on fila_pulse for select using (true);
revoke all on fila_secrets, fila_pin_guard, fila_tickets from anon, authenticated;
revoke insert, update, delete on fila_config, fila_pulse from anon, authenticated;

-- avisa as telas abertas que algo mudou (sem expor dados)
create or replace function fila_bump() returns trigger language plpgsql security definer set search_path = public as $$
begin update fila_pulse set n = n + 1 where id = 1; return null; end $$;
drop trigger if exists fila_tickets_bump on fila_tickets;
create trigger fila_tickets_bump after insert or update or delete on fila_tickets
  for each statement execute function fila_bump();

-- ---------------------------------------------------------------- helpers internos
create or replace function fila_now() returns timestamptz language sql stable as $$ select now() $$;

-- 'ok' | 'bad' | 'locked'
create or replace function fila_pin_state(p_station int, p_pin text) returns text
language plpgsql security definer set search_path = public as $$
declare g fila_pin_guard; nf int;
begin
  select * into g from fila_pin_guard where station = p_station;
  if g.locked_until is not null and g.locked_until > now() then return 'locked'; end if;
  if exists (select 1 from fila_secrets where station = p_station and pin = btrim(coalesce(p_pin,''))) then
    delete from fila_pin_guard where station = p_station;
    return 'ok';
  end if;
  nf := case when g.locked_until is not null and g.locked_until <= now() then 1 else coalesce(g.fails,0) + 1 end;
  insert into fila_pin_guard (station, fails, locked_until)
  values (p_station, nf, case when nf >= 5 then now() + interval '60 seconds' end)
  on conflict (station) do update set fails = excluded.fails, locked_until = excluded.locked_until;
  return 'bad';
end $$;

create or replace function fila_start_next(p_station int, p_start timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid; cfg fila_config;
begin
  select * into cfg from fila_config;
  select id into t from fila_tickets where station = p_station and status = 'waiting'
   order by fast desc, fast_at asc nulls last, queue_seq asc limit 1;
  if t is not null then
    update fila_tickets set status = 'playing', starts_at = p_start,
           ends_at = p_start + make_interval(mins => cfg.game_min) where id = t;
  end if;
end $$;

-- Posição e horário previsto de cada pessoa aguardando: início = base + n*intervalo + (n-1)*duração
create or replace function fila_slots(p_station int)
returns table (id uuid, pos int, est_start timestamptz)
language sql stable security definer set search_path = public as $$
  with cfg as (select * from fila_config limit 1),
  base as (select coalesce((select ends_at from fila_tickets where station = p_station and status = 'playing' limit 1), now()) as b),
  w as (select t.id, row_number() over (order by t.fast desc, t.fast_at asc nulls last, t.queue_seq asc)::int as pos
          from fila_tickets t where t.station = p_station and t.status = 'waiting')
  select w.id, w.pos,
         base.b + (w.pos * cfg.gap_sec + (w.pos - 1) * cfg.game_min * 60) * interval '1 second'
    from w, base, cfg
$$;

-- Estado de uma estação em JSON. p_ids = true só para o staff.
create or replace function fila_station_json(p_station int, p_ids boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg fila_config; pl jsonb; wl jsonb; n int; b timestamptz; qend timestamptz;
begin
  select * into cfg from fila_config;
  select case when p_ids then jsonb_build_object('id', id) else '{}'::jsonb end
         || jsonb_build_object('name', name, 'fast', fast, 'extra_min', extra_min, 'starts_at', starts_at, 'ends_at', ends_at)
    into pl from fila_tickets where station = p_station and status = 'playing' limit 1;
  select coalesce(jsonb_agg(
           (case when p_ids then jsonb_build_object('id', t.id) else '{}'::jsonb end)
           || jsonb_build_object('name', t.name, 'fast', t.fast, 'jumped_from', t.jumped_from, 'pos', s.pos, 'est_start', s.est_start)
           order by s.pos), '[]'::jsonb)
    into wl from fila_slots(p_station) s join fila_tickets t on t.id = s.id;
  select count(*) into n from fila_tickets where station = p_station and status = 'waiting';
  select coalesce((select ends_at from fila_tickets where station = p_station and status = 'playing' limit 1), now()) into b;
  qend := b + ((n + 1) * cfg.gap_sec + n * cfg.game_min * 60) * interval '1 second';
  return jsonb_build_object('station', p_station, 'playing', pl, 'waiting', wl, 'queue_end', qend,
                            'wait_new_s', greatest(0, ceil(extract(epoch from qend - now())))::int);
end $$;

create or replace function fila_config_json() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('game_min', game_min, 'extend_min', extend_min, 'gap_sec', gap_sec) from fila_config limit 1
$$;

-- Idempotente: qualquer tela aberta chama; vira o relógio da fila.
create or replace function fila_tick() returns void
language plpgsql security definer set search_path = public as $$
declare s int; chain timestamptz; cfg fila_config;
begin
  perform pg_advisory_xact_lock(777);
  select * into cfg from fila_config;
  for s in 1..4 loop
    select ends_at into chain from fila_tickets where station = s and status = 'playing' and ends_at <= now() limit 1;
    if chain is not null then
      update fila_tickets set status = 'done' where station = s and status = 'playing' and ends_at <= now();
      perform fila_start_next(s, greatest(chain + make_interval(secs => cfg.gap_sec), now()));
    elsif not exists (select 1 from fila_tickets where station = s and status = 'playing') then
      perform fila_start_next(s, now() + make_interval(secs => cfg.gap_sec));
    end if;
    chain := null;
  end loop;
end $$;

-- ---------------------------------------------------------------- jogador
-- Só o PRÓPRIO ticket. Não devolve nome de ninguém.
create or replace function fila_me(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t fila_tickets; pl fila_tickets; ahead int; v_pos int; v_est timestamptz;
begin
  select * into t from fila_tickets where id = p_id;
  if t.id is null then return jsonb_build_object('now', now(), 'config', fila_config_json(), 'ticket', null); end if;
  select * into pl from fila_tickets where station = t.station and status = 'playing' limit 1;
  if t.status = 'waiting' then
    select pos, est_start into v_pos, v_est from fila_slots(t.station) where id = t.id;
    ahead := v_pos - 1 + case when pl.id is not null then 1 else 0 end;
  end if;
  return jsonb_build_object(
    'now', now(), 'config', fila_config_json(),
    'ticket', jsonb_build_object('id', t.id, 'name', t.name, 'station', t.station, 'status', t.status, 'fast', t.fast,
                                 'jumped_from', t.jumped_from, 'extra_min', t.extra_min, 'starts_at', t.starts_at, 'ends_at', t.ends_at),
    'pos', v_pos, 'ahead', ahead, 'est_start', v_est,
    'current_starts_at', pl.starts_at, 'current_ends_at', pl.ends_at);
end $$;

create or replace function fila_join(p_name text, p_device text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s int; best int; bestload numeric; load numeric; cfg fila_config; r fila_tickets;
begin
  perform pg_advisory_xact_lock(777);
  p_name := left(regexp_replace(btrim(coalesce(p_name,'')), '[[:cntrl:]]', '', 'g'), 30);
  if char_length(p_name) < 1 then return jsonb_build_object('error', 'nome'); end if;
  p_device := left(btrim(coalesce(p_device,'')), 64);
  if p_device <> '' then      -- 1 ticket ativo por aparelho
    select * into r from fila_tickets where device = p_device and status in ('waiting','playing') limit 1;
    if r.id is not null then return fila_me(r.id); end if;
  end if;
  select * into cfg from fila_config;
  for s in 1..4 loop
    select coalesce((select greatest(extract(epoch from ends_at - now()),0) from fila_tickets where station = s and status = 'playing' limit 1),0)
         + (select count(*) from fila_tickets where station = s and status in ('waiting','playing')) * cfg.gap_sec
         + (select count(*) from fila_tickets where station = s and status = 'waiting') * cfg.game_min * 60
      into load;
    if bestload is null or load < bestload then best := s; bestload := load; end if;
  end loop;
  insert into fila_tickets (name, station, device) values (p_name, best, nullif(p_device,'')) returning * into r;
  perform fila_tick();
  return fila_me(r.id);
end $$;

-- ---------------------------------------------------------------- quadro público (telão)
create or replace function fila_board() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('now', now(), 'config', fila_config_json(),
    'stations', jsonb_build_array(fila_station_json(1,false), fila_station_json(2,false), fila_station_json(3,false), fila_station_json(4,false)))
$$;

-- ---------------------------------------------------------------- staff
create or replace function fila_staff_view(p_station int, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if p_station not between 1 and 4 then return jsonb_build_object('ok', false, 'error', 'estacao'); end if;
  st := fila_pin_state(p_station, p_pin);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'error', st); end if;
  return jsonb_build_object('ok', true, 'now', now(), 'config', fila_config_json(), 'station', fila_station_json(p_station, true));
end $$;

create or replace function fila_staff_do(p_action text, p_station int, p_pin text,
                                         p_ticket uuid default null, p_name text default null, p_fast boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st text; t fila_tickets; cfg fila_config; n int; w int; rk int;
begin
  if p_station not between 1 and 4 then return jsonb_build_object('ok', false, 'error', 'estacao'); end if;
  st := fila_pin_state(p_station, p_pin);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'error', st); end if;
  perform pg_advisory_xact_lock(777);
  select * into cfg from fila_config;

  if p_action = 'extend' then
    update fila_tickets set ends_at = ends_at + make_interval(mins => cfg.extend_min), extra_min = extra_min + cfg.extend_min
     where station = p_station and status = 'playing';
    get diagnostics n = row_count;
    if n = 0 then return jsonb_build_object('ok', false, 'error', 'ninguem_jogando'); end if;

  elsif p_action = 'finish' then
    update fila_tickets set ends_at = now() where station = p_station and status = 'playing';
    perform fila_tick();

  elsif p_action = 'add' then
    p_name := left(regexp_replace(btrim(coalesce(p_name,'')), '[[:cntrl:]]', '', 'g'), 30);
    if p_name = '' then return jsonb_build_object('ok', false, 'error', 'nome'); end if;
    select count(*) + 1 into w from fila_tickets where station = p_station and status = 'waiting';
    insert into fila_tickets (name, station, fast, fast_at, jumped_from)
    values (p_name, p_station, coalesce(p_fast,false), case when p_fast then now() end, case when p_fast then w end);
    perform fila_tick();

  else   -- ações sobre um ticket da própria estação
    select * into t from fila_tickets where id = p_ticket and station = p_station and status in ('waiting','playing');
    if t.id is null then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
    if p_action = 'fast' then
      if t.status <> 'waiting' then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
      if not t.fast then
        select count(*) + 1 into rk from fila_tickets
         where station = p_station and status = 'waiting' and id <> t.id and (fast or queue_seq < t.queue_seq);
        update fila_tickets set fast = true, fast_at = now(), jumped_from = rk where id = t.id;
      end if;
    elsif p_action = 'unfast' then
      update fila_tickets set fast = false, fast_at = null, jumped_from = null where id = t.id and status = 'waiting';
    elsif p_action = 'absent' then      -- vai para o fim; o próximo começa em 10 s
      update fila_tickets set status = 'waiting', fast = false, fast_at = null, jumped_from = null,
             starts_at = null, ends_at = null, extra_min = 0, queue_seq = nextval('fila_qseq') where id = t.id;
      if t.status = 'playing' then perform fila_start_next(p_station, now() + interval '10 seconds'); end if;
    elsif p_action = 'remove' then
      update fila_tickets set status = 'removed' where id = t.id;
      if t.status = 'playing' then perform fila_start_next(p_station, now() + interval '10 seconds'); end if;
    else
      return jsonb_build_object('ok', false, 'error', 'acao');
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- permissões
do $$ declare f record; begin          -- só as funções fila_*; não toca em nada de outros sistemas
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'fila\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function fila_now(), fila_tick(), fila_me(uuid), fila_join(text,text), fila_board(),
  fila_staff_view(int,text), fila_staff_do(text,int,text,uuid,text,boolean) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'fila_tickets') then
      alter publication supabase_realtime drop table fila_tickets;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'fila_pulse') then
      alter publication supabase_realtime add table fila_pulse;
    end if;
  end if;
end $$;
