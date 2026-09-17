-- 0040: urgencia das tarefas (baixa, normal, alta), pedido do administrador em 17/09/2026.
--
-- Tarefas avulsas ganham a coluna. Os itens de acao das notas guardam o mesmo campo dentro do JSON
-- de notes.action_items (`priority`), sem migracao: item sem o campo vale como 'normal'.
alter table public.tasks
  add column if not exists priority text not null default 'normal';

alter table public.tasks
  drop constraint if exists tasks_priority_check;
alter table public.tasks
  add constraint tasks_priority_check check (priority in ('low', 'normal', 'high'));
