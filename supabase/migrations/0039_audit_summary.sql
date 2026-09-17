-- 0039: log de auditoria agregado por PROBLEMA (codigo), calculado no banco.
--
-- POR QUE (17/09/2026): a tela /admin/audit mostrava KPIs contando so os 50 registros carregados
-- ("Registros carregados: 50" com centenas de eventos no periodo) e listava linha a linha -- o
-- "credit balance" de 16/09 eram 66 linhas soltas para UM problema. Agora a tela agrupa por codigo,
-- com contagem, usuarios afetados, primeira e ultima ocorrencia, e resolve o grupo inteiro de uma vez.

-- Codigo efetivo de uma linha: o gravado (desde a 0038) ou, para o historico anterior, deduzido do
-- texto -- assim o passado e o presente do MESMO problema caem no mesmo grupo.
create or replace function public.audit_code_of(p_code text, p_message text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(p_code, ''), case
    when p_message ilike '%credit balance%' then 'AI_CREDIT_EXHAUSTED'
    when p_message ilike '%authentication_error%' or p_message ilike '%invalid x-api-key%' then 'AI_AUTH_INVALID'
    when p_message ilike '%overloaded%' then 'AI_OVERLOADED'
    when p_message ilike '%entity too large%' or p_message ilike '%muito grande para o provedor%' then 'TRANSCRIBE_PROVIDER_TOO_LARGE'
    when p_message ilike '%file is empty%' then 'TRANSCRIBE_EMPTY_FILE'
    when p_message ilike '%could not process file%' or p_message ilike '%conseguimos ler este%' then 'TRANSCRIBE_INVALID_MEDIA'
    when p_message ilike '%sistema MUDO%' then 'RECORDER_SYSTEM_AUDIO_MUTED'
    when p_message ilike '%sistema AUSENTE%' then 'RECORDER_SYSTEM_AUDIO_MISSING'
    when p_message ilike '%Failed to send a request%' or p_message ilike '%Failed to fetch%'
      or p_message ilike '%Load failed%' or p_message ilike '%NetworkError%' then 'NETWORK'
    when p_message ilike '%Cannot coerce the result to a single JSON object%' then 'CLIENT_SINGLE_ROW_NOT_FOUND'
    when p_message ilike '%orcamento indisponivel%' or p_message ilike '%verificar o orcamento%' then 'BUDGET_UNAVAILABLE'
    when p_message ilike '%Transcricao vazia%' then 'TRANSCRIBE_EMPTY_RESULT'
    when p_message ilike '%groq%' and (p_message ilike '%Bad Gateway%' or p_message ilike '%Service Unavailable%') then 'TRANSCRIBE_PROVIDER_ERROR'
    when p_message ilike '%Anthropic%' and (p_message ilike '%Bad Gateway%' or p_message ilike '%api_error%') then 'AI_PROVIDER_ERROR'
    when p_message = 'Script error.' then 'CLIENT_SCRIPT_ERROR'
    else null
  end)
$$;

-- Assinatura curta de uma mensagem sem codigo: numeros e UUIDs viram "#", para "nota 123" e
-- "nota 456" serem o mesmo problema.
create or replace function public.audit_pattern_of(p_message text)
returns text
language sql
immutable
as $$
  select left(regexp_replace(coalesce(p_message, ''), '[0-9a-f]{8}-[0-9a-f-]{27}|[0-9]+', '#', 'g'), 140)
$$;

create or replace function public.audit_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_severities text[] default null,
  p_categories text[] default null,
  p_search text default null,
  p_include_resolved boolean default false
)
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

  with a as (
    select l.*, public.audit_code_of(l.code, l.message) as gcode, public.audit_pattern_of(l.message) as pattern
      from audit_log l
     where l.created_at >= p_from and l.created_at <= p_to
       and (p_severities is null or l.severity = any (p_severities))
       and (p_categories is null or l.category = any (p_categories))
       and (p_search is null or p_search = '' or l.message ilike '%' || p_search || '%' or l.code ilike '%' || p_search || '%')
       and (p_include_resolved or l.resolved_at is null)
  ),
  g as (
    select coalesce(gcode, 'SEM_CODIGO') as code,
           case when gcode is null then pattern end as pattern,
           count(*) as occurrences,
           count(*) filter (where resolved_at is null) as open,
           count(distinct user_id) as users,
           min(case severity when 'critical' then 0 when 'error' then 1 when 'warning' then 2 else 3 end) as worst,
           min(created_at) as first_at,
           max(created_at) as last_at,
           array_agg(distinct source) as sources,
           (array_agg(message order by created_at desc))[1] as sample
      from a
     group by coalesce(gcode, 'SEM_CODIGO'), case when gcode is null then pattern end
  )
  select json_build_object(
    'totals', (
      select json_build_object(
        'events', count(*),
        'errors', count(*) filter (where severity in ('error', 'critical')),
        'critical', count(*) filter (where severity = 'critical'),
        'users', count(distinct user_id)
      ) from a
    ),
    'groups', coalesce((
      select json_agg(json_build_object(
        'code', code, 'pattern', pattern, 'occurrences', occurrences, 'open', open, 'users', users,
        'severity', case worst when 0 then 'critical' when 1 then 'error' when 2 then 'warning' else 'info' end,
        'first_at', first_at, 'last_at', last_at, 'sources', sources, 'sample', sample
      ) order by worst, last_at desc)
      from g
    ), '[]'::json)
  ) into v;

  return v;
end;
$$;

revoke all on function public.audit_summary(timestamptz, timestamptz, text[], text[], text, boolean) from public, anon;
grant execute on function public.audit_summary(timestamptz, timestamptz, text[], text[], text, boolean) to authenticated;

-- Ocorrencias de UM grupo (codigo, ou padrao de mensagem quando SEM_CODIGO), mais recentes primeiro.
create or replace function public.audit_occurrences(
  p_code text,
  p_pattern text,
  p_from timestamptz,
  p_to timestamptz,
  p_include_resolved boolean default false,
  p_limit integer default 100
)
returns setof audit_log
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return query
    select l.* from audit_log l
     where l.created_at >= p_from and l.created_at <= p_to
       and (p_include_resolved or l.resolved_at is null)
       and (
         (p_code <> 'SEM_CODIGO' and public.audit_code_of(l.code, l.message) = p_code)
         or (p_code = 'SEM_CODIGO' and public.audit_code_of(l.code, l.message) is null
             and public.audit_pattern_of(l.message) = p_pattern)
       )
     order by l.created_at desc
     limit least(greatest(p_limit, 1), 500);
end;
$$;

revoke all on function public.audit_occurrences(text, text, timestamptz, timestamptz, boolean, integer) from public, anon;
grant execute on function public.audit_occurrences(text, text, timestamptz, timestamptz, boolean, integer) to authenticated;

-- Resolve (ou reabre) o grupo inteiro no periodo. Devolve quantas linhas mudaram.
create or replace function public.audit_resolve_group(
  p_code text,
  p_pattern text,
  p_from timestamptz,
  p_to timestamptz,
  p_resolve boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  update audit_log l
     set resolved_at = case when p_resolve then now() else null end,
         resolved_by = case when p_resolve then auth.uid() else null end
   where l.created_at >= p_from and l.created_at <= p_to
     and (case when p_resolve then l.resolved_at is null else l.resolved_at is not null end)
     and (
       (p_code <> 'SEM_CODIGO' and public.audit_code_of(l.code, l.message) = p_code)
       or (p_code = 'SEM_CODIGO' and public.audit_code_of(l.code, l.message) is null
           and public.audit_pattern_of(l.message) = p_pattern)
     );
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.audit_resolve_group(text, text, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.audit_resolve_group(text, text, timestamptz, timestamptz, boolean) to authenticated;
