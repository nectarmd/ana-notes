-- Central de avisos (sininho da Home), 17/09/2026.
--
-- 1) notices: avisos publicados pelo admin em /admin/dicas, com link opcional, publico e periodo.
-- 2) notification_reads: o que cada usuario ja marcou como lido. A chave e texto porque o sininho
--    junta avisos do admin com eventos derivados (nota recebida, pedido de amizade, resposta do
--    suporte...), que nao tem uma tabela propria de "notificacao".
-- 3) support_tickets ganha resposta do admin e contexto tecnico (versao/dispositivo) -- antes o
--    chamado ia para o admin e a pessoa nunca recebia retorno dentro do app.

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null default '' check (char_length(body) <= 400),
  link text check (link is null or char_length(link) <= 300),
  kind text not null default 'info' check (kind in ('info', 'novidade', 'alerta', 'manutencao')),
  audience text not null default 'all' check (audience in ('all', 'windows', 'admins')),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists notices_created_at_idx on public.notices (created_at desc);
alter table public.notices enable row level security;

drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices for select to authenticated
  using (
    public.is_admin()
    or (
      active
      and audience <> 'admins'
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now())
    )
  );

drop policy if exists notices_admin_insert on public.notices;
create policy notices_admin_insert on public.notices for insert to authenticated
  with check (public.is_admin());
drop policy if exists notices_admin_update on public.notices;
create policy notices_admin_update on public.notices for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists notices_admin_delete on public.notices;
create policy notices_admin_delete on public.notices for delete to authenticated
  using (public.is_admin());

create table if not exists public.notification_reads (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 160),
  read_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.notification_reads enable row level security;

-- Dono le/marca/desmarca as proprias. Admin le todas: e o "lido por N pessoas" de cada aviso.
drop policy if exists notification_reads_select on public.notification_reads;
create policy notification_reads_select on public.notification_reads for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists notification_reads_insert on public.notification_reads;
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists notification_reads_delete on public.notification_reads;
create policy notification_reads_delete on public.notification_reads for delete to authenticated
  using (user_id = auth.uid());

alter table public.support_tickets add column if not exists reply text;
alter table public.support_tickets add column if not exists replied_at timestamptz;
alter table public.support_tickets add column if not exists replied_by uuid references public.profiles(id) on delete set null;
alter table public.support_tickets add column if not exists meta jsonb;

-- Antes so existia insert/select: o admin nao conseguia nem marcar um chamado como resolvido.
drop policy if exists tickets_admin_update on public.support_tickets;
create policy tickets_admin_update on public.support_tickets for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Leituras de eventos derivados (nota recebida, mensagem, chamado) so importam enquanto a origem
-- aparece no sininho (ate 30 dias). As de avisos do admin ficam: um aviso sem data de fim
-- voltaria a aparecer como "nao lido" se a leitura sumisse.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ana-notification-reads-cleanup') then
    perform cron.unschedule('ana-notification-reads-cleanup');
  end if;
  perform cron.schedule(
    'ana-notification-reads-cleanup',
    '25 4 * * *',
    'delete from public.notification_reads where read_at < now() - interval ''90 days'' and key not like ''notice:%'';'
  );
end $$;
