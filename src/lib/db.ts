// Common data-layer contract implemented by both the mock (localStorage)
// backend and the Supabase backend.

import type {
  AdminUserRow,
  Folder,
  Note,
  Profile,
  ProfilePatch,
  RecentNote,
  SupportTicket,
  TicketTopic,
  UsageEvent,
  UsageEventType,
} from './types'

export interface SignUpInput {
  first_name: string
  last_name: string
  email: string
  phone: string
  password: string
}

export interface Db {
  // --- auth ---
  getCurrentProfile(): Promise<Profile | null>
  signIn(email: string, password: string): Promise<Profile>
  signUp(input: SignUpInput): Promise<Profile>
  signOut(): Promise<void>

  // --- profiles ---
  listProfiles(): Promise<Profile[]>
  updateMyProfile(id: string, patch: ProfilePatch): Promise<Profile>
  /** Admin: edita nome/e-mail de um usuario. */
  adminUpdateUser(id: string, patch: { first_name: string; last_name: string; email: string }): Promise<void>
  /** Admin: exclui um usuario e seus dados. */
  adminDeleteUser(id: string): Promise<void>

  // --- pastas ---
  listFolders(userId: string): Promise<Folder[]>
  createFolder(userId: string, name: string, color: string): Promise<Folder>
  updateFolder(id: string, patch: { name?: string; color?: string }): Promise<void>
  deleteFolder(id: string): Promise<void>

  // --- suporte ---
  createTicket(input: {
    user_id: string
    topic: TicketTopic
    subject: string
    message: string
    meta?: Record<string, string>
  }): Promise<void>
  /** Admin: grava a resposta (a pessoa ve em Suporte e no sininho) e marca como resolvido. */
  replyTicket(id: string, reply: string, adminId: string): Promise<void>
  /** Admin: resolve ou reabre um chamado. */
  setTicketStatus(id: string, status: 'aberto' | 'resolvido'): Promise<void>
  /** Todos os chamados (admin). */
  listTickets(): Promise<(SupportTicket & { profile?: Profile })[]>
  /** Apenas os chamados do proprio usuario. */
  listMyTickets(userId: string): Promise<SupportTicket[]>

  // --- notes ---
  listNotes(userId: string): Promise<Note[]>
  /** So o necessario para a lista de recentes (sem transcricao/resumo): roda em toda tela. */
  listRecentNotes(userId: string, limit?: number): Promise<RecentNote[]>
  /** As favoritas (coracao) para o menu lateral -- mesma linha leve das recentes. */
  listFavoriteNotes(userId: string, limit?: number): Promise<RecentNote[]>
  /** Marca/desmarca o coracao. Nao mexe em updated_at: favoritar nao e editar a nota. */
  setNoteFavorite(id: string, favorite: boolean): Promise<void>
  getNote(id: string): Promise<Note | null>
  createNote(input: Partial<Note> & { user_id: string; title: string }): Promise<Note>
  updateNote(id: string, patch: Partial<Note>): Promise<Note>
  /** Soft-delete: manda para a lixeira. */
  deleteNote(id: string): Promise<void>
  listTrash(userId: string): Promise<Note[]>
  restoreNote(id: string): Promise<void>
  /** Remove definitivamente (o audio deve ser apagado pelo chamador). */
  deleteNotePermanent(id: string): Promise<void>
  /** Envia uma COPIA da nota para um amigo aceito. A copia leva transcricao, resumos,
   *  analise, action items etc., mas NAO o audio nem o chat; o destinatario vira dono
   *  dela e edita a vontade. 'exists' = a pessoa ja tem uma copia viva desta nota. */
  shareNoteCopy(noteId: string, recipientId: string): Promise<'sent' | 'exists'>
  /** Legado do modelo por referencia (pre-0037): tira o proprio usuario de shared_with.
   *  Mantido so para sessoes antigas em cache; copias recebidas usam deleteNote normal. */
  leaveSharedNote(id: string): Promise<void>

  // --- usage / admin ---
  logUsage(userId: string, type: UsageEventType, noteId?: string | null): Promise<void>
  listUsage(): Promise<UsageEvent[]>
  adminRows(): Promise<AdminUserRow[]>
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
