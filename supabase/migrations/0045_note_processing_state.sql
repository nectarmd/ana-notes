-- Estado do processamento da nota (23/09/2026).
--
-- Ate agora a pessoa ficava presa na tela de gravacao ate transcricao e resumo terminarem: se um
-- provedor falhasse, ela via o relogio girando e nao tinha nada nas maos. A partir de agora a nota
-- nasce assim que a gravacao termina, e o resto acontece em segundo plano. Estas colunas sao o que
-- permite a TELA DA NOTA explicar o que esta acontecendo -- inclusive depois de fechar e abrir o
-- app, quando nao existe mais nenhum estado em memoria.
--
-- processing_stage: 'transcribing' | 'summarizing' | null (null = nada pendente)
-- processing_error: ultima falha, em linguagem de usuario. null quando deu certo.
-- processing_attempts: quantas vezes ja tentamos concluir esta nota.
alter table public.notes
  add column if not exists processing_stage text,
  add column if not exists processing_error text,
  add column if not exists processing_attempts integer not null default 0;

-- A copia compartilhada nao leva estado de processamento: ela nasce pronta (ver 0043).
comment on column public.notes.processing_stage is 'Etapa em andamento: transcribing | summarizing | null';
comment on column public.notes.processing_error is 'Ultima falha do processamento, em linguagem de usuario';
