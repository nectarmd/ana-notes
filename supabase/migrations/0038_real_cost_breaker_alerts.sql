-- 0038: custo REAL x custo de tabela, freio em unidades humanas, disjuntor por provedor,
-- codigos de erro no audit_log, alertas para o administrador e relatorio agregado de uso.
--
-- POR QUE (achados de 2026-09-17, com os dados de producao):
--  * O painel somava ~US$ 20,54 em 30 dias quando o gasto real era US$ 5,31: Groq e AssemblyAI
--    rodam em tier gratuito/credito e entravam como custo.
--  * O FREIO (usage_guard) usava esse mesmo valor inflado: um usuario podia bater o limite diario
--    sem gastar um centavo de verdade, e o teto mensal contava dinheiro que nao saia do caixa.
--  * O painel lia linhas cruas com .limit(5000): com 25 usuarios isso estoura e TODOS os KPIs
--    ficam errados em silencio. Agora a agregacao roda aqui, no banco.
--  * Os creditos da Anthropic acabaram em 26/08 e de novo em 16/09 e ninguem foi avisado: a
--    Larissa tentou 16 vezes seguidas. Daqui saem o disjuntor e os alertas para o admin.

-- =====================================================================================
-- 1) app_settings: modo de cobranca e limites de cada provedor, freio em unidades humanas
-- =====================================================================================
alter table public.app_settings
  add column if not exists provider_billing jsonb not null
    default '{"anthropic":"paid","openai":"paid","groq":"free","assemblyai":"free"}'::jsonb,
  add column if not exists provider_limits jsonb not null default jsonb_build_object(
    'groq', jsonb_build_object(
      'requests_min', 20, 'requests_day', 2000, 'audio_seconds_hour', 7200, 'audio_seconds_day', 28800,
      'fonte', 'console.groq.com/docs/rate-limits, plano gratuito, consultado em 17/09/2026'),
    'assemblyai', jsonb_build_object(
      'credit_usd', 50,
      'fonte', 'assemblyai.com/pricing: US$ 50 de credito no cadastro; US$ 0,21/h (+US$ 0,02/h com diarizacao), consultado em 17/09/2026'),
    'anthropic', jsonb_build_object(
      'balance_usd', null, 'balance_set_at', null,
      'fonte', 'saldo pre-pago informado pelo administrador (console.anthropic.com > Billing)')
  ),
  -- "Chamadas por minuto" nao diz nada a quem administra: uma nota sao 3 ou 4 chamadas. Notas por
  -- hora e minutos de audio por dia sao as unidades em que a decisao e tomada de verdade.
  add column if not exists ai_notes_per_hour_per_user integer not null default 20,
  add column if not exists ai_audio_minutes_per_day_per_user integer not null default 480,
  -- Disjuntor por provedor: {"anthropic": {"code": "...", "until": "...", "since": "..."}}
  add column if not exists ai_breaker jsonb not null default '{}'::jsonb;

alter table public.app_settings drop constraint if exists app_settings_notes_per_hour_check;
alter table public.app_settings add constraint app_settings_notes_per_hour_check
  check (ai_notes_per_hour_per_user between 1 and 500);
alter table public.app_settings drop constraint if exists app_settings_audio_minutes_check;
alter table public.app_settings add constraint app_settings_audio_minutes_check
  check (ai_audio_minutes_per_day_per_user between 1 and 1440);

-- =====================================================================================
-- 2) api_usage: modo de cobranca e custo real, gravados NO MOMENTO da chamada
-- =====================================================================================
alter table public.api_usage
  add column if not exists billing_mode text not null default 'paid',
  add column if not exists real_cost_usd numeric(12, 6) not null default 0;

alter table public.api_usage drop constraint if exists api_usage_billing_mode_check;
alter table public.api_usage add constraint api_usage_billing_mode_check
  check (billing_mode in ('paid', 'free'));

create index if not exists api_usage_task_idx on public.api_usage (task, created_at desc);

-- Gravado por trigger, e nao por cada edge function: e a unica forma de a regra valer para TODO
-- insert (ai, transcribe, os que vierem) sem depender de alguem lembrar de passar o campo. O modo
-- fica congelado na linha -- trocar o Groq para "pago" amanha nao reescreve o passado sozinho.
create or replace function public.api_usage_set_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
begin
  select s.provider_billing ->> new.provider into v_mode from app_settings s limit 1;
  new.billing_mode := case when v_mode = 'free' then 'free' else 'paid' end;
  new.real_cost_usd := case when new.billing_mode = 'paid' then new.cost_usd else 0 end;
  return new;
end;
$$;

drop trigger if exists api_usage_billing on public.api_usage;
create trigger api_usage_billing
  before insert on public.api_usage
  for each row execute function public.api_usage_set_billing();

-- Preco de TABELA do AssemblyAI estava desatualizado no codigo (US$ 0,37/h). Corrige o historico
-- para US$ 0,21/h (+0,02/h com diarizacao). E correcao de dado nosso, nao dado de usuario.
update public.api_usage
   set cost_usd = audio_seconds * (0.21 + case when model like '%speaker%' then 0.02 else 0 end) / 3600.0
 where provider = 'assemblyai';

-- Backfill do historico conforme o administrador informou em 17/09/2026 (Groq e AssemblyAI sem
-- cobranca). Se isso mudar, set_provider_billing() remarca a partir de uma data.
update public.api_usage set billing_mode = 'free', real_cost_usd = 0
 where provider in ('groq', 'assemblyai');
update public.api_usage set billing_mode = 'paid', real_cost_usd = cost_usd
 where provider in ('anthropic', 'openai');

-- =====================================================================================
-- 3) audit_log: codigo do erro
-- =====================================================================================
-- O usuario ve uma mensagem simples; o admin ve o CODIGO e a causa tecnica. Agrupar por codigo e
-- o que transforma 66 linhas de "credit balance" em "1 problema, 33 ocorrencias, 6 usuarios".
alter table public.audit_log add column if not exists code text;
create index if not exists audit_log_code_idx on public.audit_log (code, created_at desc);

-- =====================================================================================
-- 4) admin_alerts: problemas que SO o administrador resolve
-- =====================================================================================
create table if not exists public.admin_alerts (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  severity text not null check (severity in ('warning', 'error', 'critical')),
  title text not null,
  detail jsonb,
  occurrences integer not null default 1,
  affected_users uuid[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- null com resolved_at preenchido = resolvido AUTOMATICAMENTE (o provedor voltou a responder)
  resolved_by uuid references auth.users (id) on delete set null
);

-- No maximo UM alerta aberto por codigo: repeticoes incrementam, nao empilham.
create unique index if not exists admin_alerts_open_code on public.admin_alerts (code) where resolved_at is null;
create index if not exists admin_alerts_last_seen_idx on public.admin_alerts (last_seen_at desc);

alter table public.admin_alerts enable row level security;

drop policy if exists admin_alerts_admin_select on public.admin_alerts;
create policy admin_alerts_admin_select on public.admin_alerts
  for select using (public.is_admin());

drop policy if exists admin_alerts_admin_update on public.admin_alerts;
create policy admin_alerts_admin_update on public.admin_alerts
  for update using (public.is_admin()) with check (public.is_admin());

create or replace function public.raise_admin_alert(
  p_code text, p_severity text, p_title text, p_detail jsonb, p_user uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into admin_alerts (code, severity, title, detail, affected_users)
  values (p_code, p_severity, p_title, p_detail,
          case when p_user is null then '{}'::uuid[] else array[p_user] end)
  on conflict (code) where resolved_at is null do update
     set occurrences = admin_alerts.occurrences + 1,
         last_seen_at = now(),
         detail = coalesce(excluded.detail, admin_alerts.detail),
         severity = excluded.severity,
         affected_users = case
           when p_user is null or p_user = any (admin_alerts.affected_users) then admin_alerts.affected_users
           else array_append(admin_alerts.affected_users, p_user)
         end;
end;
$$;

revoke all on function public.raise_admin_alert(text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.raise_admin_alert(text, text, text, jsonb, uuid) to service_role;

-- =====================================================================================
-- 5) Disjuntor por provedor
-- =====================================================================================
-- Quando o problema e do PROVEDOR (credito esgotado, chave revogada), chamar de novo so repete a
-- falha e gera mais log. O disjuntor abre por alguns minutos: as chamadas voltam o erro na hora,
-- sem ir ao provedor. Passado o prazo, a proxima chamada testa; se der certo, fecha sozinho.
create or replace function public.trip_ai_breaker(p_provider text, p_code text, p_minutes integer)
returns void
language sql
security definer
set search_path = public
as $$
  update app_settings
     set ai_breaker = coalesce(ai_breaker, '{}'::jsonb) || jsonb_build_object(
       p_provider, jsonb_build_object(
         'code', p_code,
         'until', now() + make_interval(mins => greatest(p_minutes, 1)),
         'since', coalesce(ai_breaker -> p_provider ->> 'since', now()::text)
       ));
$$;

-- Devolve true se havia disjuntor aberto (quem chama resolve o alerta correspondente).
create or replace function public.clear_ai_breaker(p_provider text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select ai_breaker -> p_provider ->> 'code' into v_code from app_settings limit 1;
  if v_code is null then
    return false;
  end if;
  update app_settings set ai_breaker = ai_breaker - p_provider;
  update admin_alerts set resolved_at = now(), resolved_by = null
   where code = v_code and resolved_at is null;
  return true;
end;
$$;

revoke all on function public.trip_ai_breaker(text, text, integer) from public, anon, authenticated;
revoke all on function public.clear_ai_breaker(text) from public, anon, authenticated;
grant execute on function public.trip_ai_breaker(text, text, integer) to service_role;
grant execute on function public.clear_ai_breaker(text) to service_role;

-- =====================================================================================
-- 6) usage_guard v2: custo REAL, notas por hora, minutos de audio, disjuntor, uso do Groq
-- =====================================================================================
create or replace function public.usage_guard(p_user uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'day_cost_user', coalesce((
      select sum(real_cost_usd) from api_usage
      where user_id = p_user and created_at >= date_trunc('day', now())
    ), 0),
    'month_cost_global', coalesce((
      select sum(real_cost_usd) from api_usage
      where created_at >= date_trunc('month', now())
    ), 0),
    'calls_last_min', (
      select count(*) from api_usage
      where user_id = p_user and created_at >= now() - interval '1 minute'
    ),
    -- Toda nota processada gera exatamente UM resumo: e o contador honesto de "notas".
    'notes_last_hour', (
      select count(*) from api_usage
      where user_id = p_user and task = 'summary' and created_at >= now() - interval '1 hour'
    ),
    'audio_seconds_today_user', coalesce((
      select sum(audio_seconds) from api_usage
      where user_id = p_user and created_at >= date_trunc('day', now())
    ), 0),
    'groq_audio_seconds_last_hour', coalesce((
      select sum(audio_seconds) from api_usage
      where provider = 'groq' and created_at >= now() - interval '1 hour'
    ), 0),
    'groq_audio_seconds_today', coalesce((
      select sum(audio_seconds) from api_usage
      where provider = 'groq' and created_at >= date_trunc('day', now())
    ), 0),
    'ai_enabled', s.ai_enabled,
    'daily_usd_per_user', s.ai_daily_usd_per_user,
    'monthly_usd_global', s.ai_monthly_usd_global,
    'rate_per_min', s.ai_rate_per_min,
    'notes_per_hour', s.ai_notes_per_hour_per_user,
    'audio_minutes_per_day', s.ai_audio_minutes_per_day_per_user,
    'provider_billing', s.provider_billing,
    'provider_limits', s.provider_limits,
    'breaker', s.ai_breaker
  )
  from app_settings s
  limit 1;
$$;

revoke all on function public.usage_guard(uuid) from public, anon, authenticated;
grant execute on function public.usage_guard(uuid) to service_role;

-- =====================================================================================
-- 7) Relatorio agregado para o painel (so admin)
-- =====================================================================================
create or replace function public.usage_report(p_from timestamptz, p_to timestamptz, p_provider text default null)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v json;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  with u as (
    select * from api_usage
     where created_at >= p_from and created_at <= p_to
       and (p_provider is null or provider = p_provider)
  )
  select json_build_object(
    'totals', (
      select json_build_object(
        'calls', count(*),
        'cost_list', coalesce(sum(cost_usd), 0),
        'cost_real', coalesce(sum(real_cost_usd), 0),
        'input_tokens', coalesce(sum(input_tokens), 0),
        'output_tokens', coalesce(sum(output_tokens), 0),
        'cache_read_tokens', coalesce(sum(cache_read_tokens), 0),
        'cache_write_tokens', coalesce(sum(cache_write_tokens), 0),
        'audio_seconds', coalesce(sum(audio_seconds), 0),
        'users', count(distinct user_id)
      ) from u
    ),
    'by_provider', coalesce((
      select json_agg(x order by x.cost_real desc, x.cost_list desc) from (
        select provider,
               bool_or(billing_mode = 'paid') as has_paid,
               bool_or(billing_mode = 'free') as has_free,
               count(*) as calls,
               sum(cost_usd) as cost_list, sum(real_cost_usd) as cost_real,
               sum(audio_seconds) as audio_seconds,
               sum(input_tokens + output_tokens) as tokens
          from u group by provider
      ) x
    ), '[]'::json),
    'by_task', coalesce((
      select json_agg(x order by x.cost_real desc, x.cost_list desc) from (
        select task, provider, model,
               count(*) as calls,
               sum(cost_usd) as cost_list, sum(real_cost_usd) as cost_real,
               sum(audio_seconds) as audio_seconds,
               sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
               sum(cache_read_tokens) as cache_read_tokens, sum(cache_write_tokens) as cache_write_tokens
          from u group by task, provider, model
      ) x
    ), '[]'::json),
    'by_user', coalesce((
      select json_agg(x order by x.cost_real desc, x.cost_list desc) from (
        select u.user_id,
               nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as name,
               p.email,
               count(*) as calls,
               sum(u.cost_usd) as cost_list, sum(u.real_cost_usd) as cost_real,
               sum(u.audio_seconds) as audio_seconds,
               count(*) filter (where u.task = 'summary') as notes
          from u left join profiles p on p.id = u.user_id
         group by u.user_id, p.first_name, p.last_name, p.email
      ) x
    ), '[]'::json),
    'by_user_task', coalesce((
      select json_agg(x) from (
        select user_id, task, provider,
               count(*) as calls,
               sum(cost_usd) as cost_list, sum(real_cost_usd) as cost_real,
               sum(audio_seconds) as audio_seconds,
               sum(input_tokens + output_tokens) as tokens
          from u group by user_id, task, provider
      ) x
    ), '[]'::json),
    'by_day', coalesce((
      select json_agg(x order by x.day) from (
        select (created_at at time zone 'America/Sao_Paulo')::date as day, provider,
               count(*) as calls,
               sum(cost_usd) as cost_list, sum(real_cost_usd) as cost_real,
               sum(audio_seconds) as audio_seconds
          from u group by 1, 2
      ) x
    ), '[]'::json),
    'notes', (
      select json_build_object(
        'count', count(*),
        'with_audio', count(*) filter (where duration_seconds > 0),
        'audio_seconds', coalesce(sum(duration_seconds), 0),
        'users', count(distinct user_id)
      )
        from notes
       where created_at >= p_from and created_at <= p_to and deleted_at is null
    ),
    -- Sempre a partir do inicio dos tempos (nao do periodo): credito e saldo sao acumulados.
    'lifetime', json_build_object(
      'assemblyai_cost_list', coalesce((select sum(cost_usd) from api_usage where provider = 'assemblyai'), 0),
      'anthropic_real_since_balance', coalesce((
        select sum(real_cost_usd) from api_usage, app_settings s
         where provider = 'anthropic'
           and (s.provider_limits -> 'anthropic' ->> 'balance_set_at') is not null
           and created_at >= (s.provider_limits -> 'anthropic' ->> 'balance_set_at')::timestamptz
      ), 0),
      'groq_audio_seconds_last_hour', coalesce((select sum(audio_seconds) from api_usage
        where provider = 'groq' and created_at >= now() - interval '1 hour'), 0),
      'groq_audio_seconds_today', coalesce((select sum(audio_seconds) from api_usage
        where provider = 'groq' and created_at >= date_trunc('day', now())), 0),
      'groq_requests_today', (select count(*) from api_usage
        where provider = 'groq' and created_at >= date_trunc('day', now())),
      'groq_peak_hour_seconds_30d', coalesce((select max(s) from (select sum(audio_seconds) s from api_usage
        where provider = 'groq' and created_at >= now() - interval '30 days'
        group by date_trunc('hour', created_at)) h), 0),
      'groq_peak_day_seconds_30d', coalesce((select max(s) from (select sum(audio_seconds) s from api_usage
        where provider = 'groq' and created_at >= now() - interval '30 days'
        group by date_trunc('day', created_at)) d), 0)
    )
  ) into v;

  return v;
end;
$$;

revoke all on function public.usage_report(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.usage_report(timestamptz, timestamptz, text) to authenticated;

-- =====================================================================================
-- 8) Trocar o modo de cobranca de um provedor (so admin), opcionalmente remarcando o historico
-- =====================================================================================
create or replace function public.set_provider_billing(p_provider text, p_mode text, p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_mode not in ('paid', 'free') or p_provider not in ('anthropic', 'groq', 'assemblyai', 'openai') then
    raise exception 'invalid';
  end if;

  update app_settings
     set provider_billing = provider_billing || jsonb_build_object(p_provider, p_mode),
         updated_at = now();

  if p_since is not null then
    update api_usage
       set billing_mode = p_mode,
           real_cost_usd = case when p_mode = 'paid' then cost_usd else 0 end
     where provider = p_provider and created_at >= p_since;
    get diagnostics v_rows = row_count;
  end if;

  return v_rows;
end;
$$;

revoke all on function public.set_provider_billing(text, text, timestamptz) from public, anon;
grant execute on function public.set_provider_billing(text, text, timestamptz) to authenticated;
