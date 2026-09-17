-- 0041: nao pagar duas vezes pelo MESMO audio (Fase 8, item 4 -- 17/09/2026).
--
-- Caso real: em 16/09 a mesma gravacao de 11 min virou 3 notas em 40 segundos (retentativas durante
-- a falta de credito da Anthropic). O log do Groq mostra 3 transcricoes identicas de 684 s.
--
-- Estas tabelas sao COPIAS temporarias de resultado, nunca a fonte dos dados do usuario (a nota
-- continua sendo). Por isso a limpeza diaria abaixo pode apagar linhas antigas sem perda nenhuma.
-- Sem policy de RLS de proposito: so a service role (edge functions) le e grava.

create table if not exists public.transcription_cache (
  user_id uuid not null references auth.users (id) on delete cascade,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  transcript text,
  provider text,
  -- Trabalho assincrono do AssemblyAI em andamento: uma segunda tentativa acompanha o MESMO job.
  job_id text,
  audio_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, file_sha256)
);
create index if not exists transcription_cache_job_idx on public.transcription_cache (job_id) where job_id is not null;
alter table public.transcription_cache enable row level security;

create table if not exists public.ai_result_cache (
  user_id uuid not null references auth.users (id) on delete cascade,
  task text not null,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, task, input_sha256)
);
alter table public.ai_result_cache enable row level security;

-- Nota recente do proprio usuario com a MESMA transcricao (comparada por hash, sem trafegar o texto
-- na URL). O app reaproveita essa nota em vez de criar uma copia. RLS de notes vale normalmente.
create or replace function public.recent_note_with_transcript(p_sha256 text, p_minutes integer default 360)
returns setof public.notes
language sql
stable
security invoker
set search_path = public
as $$
  select n.*
    from notes n
   where n.user_id = auth.uid()
     and n.deleted_at is null
     and n.created_at > now() - make_interval(mins => least(greatest(p_minutes, 1), 1440))
     and coalesce(n.transcript, '') <> ''
     and encode(sha256(convert_to(n.transcript, 'UTF8')), 'hex') = p_sha256
   order by n.created_at
   limit 1
$$;

revoke all on function public.recent_note_with_transcript(text, integer) from public, anon;
grant execute on function public.recent_note_with_transcript(text, integer) to authenticated;

-- Limpeza diaria das copias temporarias (7 dias de transcricao, 2 dias de resultado de IA).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ana-dedupe-cache-cleanup') then
    perform cron.unschedule('ana-dedupe-cache-cleanup');
  end if;
  perform cron.schedule(
    'ana-dedupe-cache-cleanup',
    '15 4 * * *',
    'delete from public.transcription_cache where created_at < now() - interval ''7 days''; delete from public.ai_result_cache where created_at < now() - interval ''2 days'';'
  );
end
$$;
