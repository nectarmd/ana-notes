-- Nomes dos falantes (17/09/2026).
--
-- A transcricao continua com os rotulos da diarizacao ("Falante A: ..."), intacta. Os nomes ficam
-- aqui, por rotulo, e sao aplicados na hora de mostrar, exportar e mandar para a IA -- assim
-- renomear ou desfazer nunca reescreve o texto original.
--
-- Formato:
--   {
--     "checked_at": "2026-09-17T12:00:00Z",   -- quando a identificacao automatica rodou (null = nunca)
--     "names": {
--       "A": { "name": "Carla", "source": "auto",   "evidence": [{ "type": "addressed", "turn": 12, "quote": "...", "reply_turn": 13 }] },
--       "B": { "name": "João",  "source": "manual" }
--     }
--   }
alter table public.notes add column if not exists speakers jsonb;

-- A copia compartilhada leva os nomes junto (sem eles, quem recebe veria "Falante A").
create or replace function public._create_shared_copy(src public.notes, p_recipient uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null or p_recipient = src.user_id then
    return 'skipped';
  end if;
  if not exists (select 1 from public.profiles where id = p_recipient) then
    return 'skipped';
  end if;

  -- Reenvio da mesma nota: se a pessoa ja tem uma copia viva, nao duplica (se ela jogou a
  -- copia na lixeira, um novo envio cria outra -- lixeira e caminho de exclusao).
  if exists (
    select 1 from public.notes
    where shared_from_note_id = src.id and user_id = p_recipient and deleted_at is null
  ) then
    return 'exists';
  end if;

  insert into public.notes (
    user_id, title, emoji, type, device, template, context,
    duration_seconds, language, transcript, summary, detailed_summary,
    analysis, mindmap, action_items, status, priority, speakers,
    shared_by, shared_from_note_id, created_at
  ) values (
    p_recipient, src.title, src.emoji, src.type, src.device, src.template, src.context,
    src.duration_seconds, src.language, src.transcript, src.summary, src.detailed_summary,
    src.analysis, src.mindmap, src.action_items, 'ready', src.priority, src.speakers,
    src.user_id, src.id, src.created_at
  );
  -- Fora do insert (ficam no default/null): audio_url, keep_audio, audio_deleted_at (audio
  -- nao e compartilhado), chat (conversa privada), folder/folder_id (pasta e por usuario),
  -- shared_with (sempre vazio), deleted_at. created_at preservado: e a data da reuniao.
  return 'sent';
end;
$$;

revoke all on function public._create_shared_copy(public.notes, uuid) from public, anon, authenticated;
