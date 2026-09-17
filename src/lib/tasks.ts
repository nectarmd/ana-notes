// Tarefas avulsas (criadas a mao). As tarefas vindas de notas continuam em `notes.action_items`.

import { supabase } from './supabase'
import type { Task, TaskPriority } from './types'
import { TASK_TEXT_MAX } from './types'

function client() {
  if (!supabase) throw new Error('Supabase nao configurado')
  return supabase
}

export const tasksEnabled = () => !!supabase

export interface TaskInput {
  text: string
  owner?: string
  due?: string
  priority?: TaskPriority
}

export async function listTasks(userId: string): Promise<Task[]> {
  if (!supabase) return []
  const { data, error } = await client()
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Task[]
}

export async function createTask(userId: string, input: TaskInput): Promise<Task> {
  const text = input.text.trim().slice(0, TASK_TEXT_MAX)
  if (!text) throw new Error('Tarefa vazia')

  const { data, error } = await client()
    .from('tasks')
    .insert({
      user_id: userId,
      text,
      owner: input.owner?.trim() || null,
      due: input.due || null,
      priority: input.priority ?? 'normal',
    })
    .select()
    .single()
  if (error) throw error
  return data as Task
}

export async function updateTask(id: string, patch: Partial<TaskInput> & { done?: boolean }): Promise<Task> {
  const row: Record<string, unknown> = {}
  if (patch.text !== undefined) {
    const text = patch.text.trim().slice(0, TASK_TEXT_MAX)
    if (!text) throw new Error('Tarefa vazia')
    row.text = text
  }
  if (patch.owner !== undefined) row.owner = patch.owner.trim() || null
  if (patch.due !== undefined) row.due = patch.due || null
  if (patch.priority !== undefined) row.priority = patch.priority
  if (patch.done !== undefined) row.done = patch.done
  const { data, error } = await client().from('tasks').update(row).eq('id', id).select().single()
  if (error) throw error
  return data as Task
}

export async function setTaskDone(id: string, done: boolean): Promise<Task> {
  return updateTask(id, { done })
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await client().from('tasks').delete().eq('id', id)
  if (error) throw error
}
