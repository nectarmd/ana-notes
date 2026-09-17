-- Notas favoritas (17/09/2026).
--
-- O coracao no canto do cartao marca a nota; o menu lateral mostra as marcadas (antes ele
-- listava as 5 mais recentes, o que nao ajudava quem volta sempre nas mesmas notas).
--
-- E pessoal: a copia criada por _create_shared_copy nao inclui esta coluna, entao quem recebe
-- uma nota compartilhada comeca com ela desmarcada.
alter table public.notes add column if not exists favorite boolean not null default false;

-- A consulta do menu lateral e "as favoritas deste usuario, mais novas primeiro".
create index if not exists notes_user_favorite_idx
  on public.notes (user_id, created_at desc)
  where favorite and deleted_at is null;
