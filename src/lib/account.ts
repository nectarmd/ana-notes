import { config } from './config'
import { supabase } from './supabase'

/** Exclusao definitiva da propria conta (Google Play e Apple exigem isto no app). */
export async function deleteMyAccount(): Promise<void> {
  if (config.mockMode) {
    // Demo (sem backend): limpa o armazenamento local.
    localStorage.clear()
    return
  }
  if (!supabase) throw new Error('Sem conexão com o servidor.')

  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('delete-account', {
    body: {},
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
}
