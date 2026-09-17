// localStorage-backed implementation of Db. Lets the whole app run without
// any backend or API keys. NOT for production auth (passwords are local only).

import { config, isAdminEmail, isAllowedDomain } from './config'
import { deleteAudio } from './audioStore'
import type { Db, SignUpInput } from './db'
import { uid } from './db'
import { RETENTION_DEFAULT } from './types'
import type {
  AdminUserRow,
  Folder,
  Note,
  Profile,
  SupportTicket,
  UsageEvent,
  UsageEventType,
} from './types'

const K = {
  session: 'tailor.session',
  profiles: 'tailor.profiles',
  passwords: 'tailor.passwords',
  notes: 'tailor.notes',
  usage: 'tailor.usage',
  folders: 'tailor.folders',
  tickets: 'tailor.tickets',
  seeded: 'tailor.seeded.v2',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function seed(): void {
  if (localStorage.getItem(K.seeded)) return

  // Cria SOMENTE a conta de administrador para permitir o primeiro acesso.
  // Nenhuma nota, metrica ou usuario de exemplo: o painel Admin passa a refletir
  // exclusivamente o uso real feito dentro do app.
  const admin: Profile = {
    id: uid('u_'),
    first_name: 'Flavio',
    last_name: 'Junior',
    email: config.adminEmail,
    phone: '+55 11 90000-0000',
    role: 'admin',
    avatar_url: null,
    instagram: null,
    linkedin: null,
    audio_retention_days: RETENTION_DEFAULT,
    created_at: new Date().toISOString(),
  }

  // Migracao: limpa qualquer dado de seed antigo (usuarios/notas/eventos de exemplo).
  write(K.profiles, [admin])
  write(K.passwords, { [admin.email]: 'Tailor@007' })
  write(K.notes, [])
  write(K.usage, [])

  localStorage.setItem(K.seeded, '1')
}

function getProfiles(): Profile[] {
  return read<Profile[]>(K.profiles, [])
}

/** Limpeza preguicosa (modo demo): remove o audio de notas expiradas (>N dias, sem keep_audio). */
function cleanupExpiredAudio(): void {
  const notes = read<Note[]>(K.notes, [])
  const cutoff = Date.now() - config.audioRetentionDays * 86400000
  let changed = false
  for (const n of notes) {
    if (
      !n.keep_audio &&
      !n.audio_deleted_at &&
      n.audio_url &&
      Date.parse(n.created_at) < cutoff
    ) {
      deleteAudio(n.audio_url) // apaga o blob no IndexedDB (fire-and-forget)
      n.audio_url = null
      n.audio_deleted_at = new Date().toISOString()
      changed = true
    }
  }
  if (changed) write(K.notes, notes)
}

export const mockDb: Db = {
  async getCurrentProfile() {
    seed()
    const id = localStorage.getItem(K.session)
    if (!id) return null
    return getProfiles().find((p) => p.id === id) ?? null
  },

  async signIn(email, password) {
    seed()
    const normalized = email.trim().toLowerCase()
    const passwords = read<Record<string, string>>(K.passwords, {})
    const profile = getProfiles().find((p) => p.email.toLowerCase() === normalized)
    if (!profile || passwords[profile.email] !== password) {
      throw new Error('E-mail ou senha invalidos.')
    }
    localStorage.setItem(K.session, profile.id)
    return profile
  },

  async signUp(input: SignUpInput) {
    seed()
    const email = input.email.trim().toLowerCase()
    if (!isAllowedDomain(email)) {
      throw new Error(`Apenas e-mails @${config.allowedDomain} podem se cadastrar.`)
    }
    const profiles = getProfiles()
    if (profiles.some((p) => p.email.toLowerCase() === email)) {
      throw new Error('Ja existe uma conta com este e-mail.')
    }
    const profile: Profile = {
      id: uid('u_'),
      first_name: input.first_name.trim(),
      last_name: input.last_name.trim(),
      email,
      phone: input.phone.trim(),
      role: isAdminEmail(email) ? 'admin' : 'member',
      avatar_url: null,
      instagram: null,
      linkedin: null,
      audio_retention_days: RETENTION_DEFAULT,
      created_at: new Date().toISOString(),
    }
    profiles.push(profile)
    write(K.profiles, profiles)
    const passwords = read<Record<string, string>>(K.passwords, {})
    passwords[email] = input.password
    write(K.passwords, passwords)
    localStorage.setItem(K.session, profile.id)
    return profile
  },

  async signOut() {
    localStorage.removeItem(K.session)
  },

  async listProfiles() {
    seed()
    return getProfiles()
  },

  async updateMyProfile(id, patch) {
    const profiles = getProfiles()
    const idx = profiles.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error('Perfil nao encontrado.')
    profiles[idx] = { ...profiles[idx], ...patch }
    write(K.profiles, profiles)
    return profiles[idx]
  },

  async adminUpdateUser(id, patch) {
    const profiles = getProfiles()
    const idx = profiles.findIndex((p) => p.id === id)
    if (idx === -1) return
    profiles[idx] = {
      ...profiles[idx],
      first_name: patch.first_name,
      last_name: patch.last_name,
      email: patch.email.trim().toLowerCase(),
    }
    write(K.profiles, profiles)
  },

  async adminDeleteUser(id) {
    write(K.profiles, getProfiles().filter((p) => p.id !== id))
    const notes = read<Note[]>(K.notes, [])
    write(K.notes, notes.filter((n) => n.user_id !== id))
    const usage = read<UsageEvent[]>(K.usage, [])
    write(K.usage, usage.filter((e) => e.user_id !== id))
  },

  async listFolders(userId) {
    return read<Folder[]>(K.folders, [])
      .filter((f) => f.user_id === userId)
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async createFolder(userId, name, color) {
    const folders = read<Folder[]>(K.folders, [])
    const folder: Folder = { id: uid('f_'), user_id: userId, name, color, created_at: new Date().toISOString() }
    folders.push(folder)
    write(K.folders, folders)
    return folder
  },

  async updateFolder(id, patch) {
    const folders = read<Folder[]>(K.folders, [])
    const idx = folders.findIndex((f) => f.id === id)
    if (idx !== -1) {
      folders[idx] = { ...folders[idx], ...patch }
      write(K.folders, folders)
    }
  },

  async deleteFolder(id) {
    write(K.folders, read<Folder[]>(K.folders, []).filter((f) => f.id !== id))
    const notes = read<Note[]>(K.notes, [])
    let changed = false
    notes.forEach((n) => {
      if (n.folder_id === id) {
        n.folder_id = null
        changed = true
      }
    })
    if (changed) write(K.notes, notes)
  },

  async createTicket(input) {
    const tickets = read<SupportTicket[]>(K.tickets, [])
    tickets.push({
      id: uid('t_'),
      user_id: input.user_id,
      topic: input.topic,
      subject: input.subject,
      message: input.message,
      status: 'aberto',
      created_at: new Date().toISOString(),
      meta: input.meta ?? null,
    })
    write(K.tickets, tickets)
  },

  async replyTicket(id, reply, adminId) {
    const tickets = read<SupportTicket[]>(K.tickets, []).map((t) =>
      t.id === id
        ? { ...t, reply: reply.trim(), replied_at: new Date().toISOString(), replied_by: adminId, status: 'resolvido' as const }
        : t,
    )
    write(K.tickets, tickets)
  },

  async setTicketStatus(id, status) {
    write(
      K.tickets,
      read<SupportTicket[]>(K.tickets, []).map((t) => (t.id === id ? { ...t, status } : t)),
    )
  },

  async listTickets() {
    const tickets = read<SupportTicket[]>(K.tickets, [])
    const profiles = getProfiles()
    return tickets
      .map((t) => ({ ...t, profile: profiles.find((p) => p.id === t.user_id) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  async listMyTickets(userId) {
    return read<SupportTicket[]>(K.tickets, [])
      .filter((t) => t.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  async listNotes(userId) {
    seed()
    cleanupExpiredAudio()
    const notes = read<Note[]>(K.notes, [])
    // Igual a producao pos-0037: compartilhar cria copia, entao a lista e so o que e meu.
    return notes
      .filter((n) => !n.deleted_at && n.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  async listTrash(userId) {
    let notes = read<Note[]>(K.notes, [])
    // Exclui DEFINITIVAMENTE o que esta na lixeira ha mais de 7 dias (limpeza preguicosa no demo).
    const cutoff = Date.now() - 7 * 86400000
    const expired = notes.filter((n) => n.deleted_at && Date.parse(n.deleted_at) < cutoff)
    if (expired.length) {
      for (const n of expired) {
        if (n.audio_url) deleteAudio(n.audio_url)
      }
      const expiredIds = new Set(expired.map((n) => n.id))
      notes = notes.filter((n) => !expiredIds.has(n.id))
      write(K.notes, notes)
    }
    return notes
      .filter((n) => n.deleted_at && n.user_id === userId)
      .sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''))
  },

  async restoreNote(id) {
    const notes = read<Note[]>(K.notes, [])
    const idx = notes.findIndex((n) => n.id === id)
    if (idx !== -1) {
      notes[idx].deleted_at = null
      write(K.notes, notes)
    }
  },

  async deleteNotePermanent(id) {
    const notes = read<Note[]>(K.notes, [])
    write(K.notes, notes.filter((n) => n.id !== id))
  },

  async shareNoteCopy(noteId, recipientId) {
    // Espelha o RPC share_note_copy (0037): copia sem audio, sem chat e sem pasta.
    const notes = read<Note[]>(K.notes, [])
    const src = notes.find((n) => n.id === noteId)
    if (!src) throw new Error('Nota nao encontrada.')
    const existing = notes.find(
      (n) => n.shared_from_note_id === noteId && n.user_id === recipientId && !n.deleted_at,
    )
    if (existing) return 'exists'
    notes.push({
      ...src,
      id: uid('n_'),
      user_id: recipientId,
      folder: null,
      folder_id: null,
      audio_url: null,
      keep_audio: false,
      audio_deleted_at: null,
      chat: [],
      shared_with: [],
      shared_by: src.user_id,
      shared_from_note_id: src.id,
      status: 'ready',
      deleted_at: null,
      updated_at: new Date().toISOString(),
    })
    write(K.notes, notes)
    return 'sent'
  },

  async leaveSharedNote(id) {
    const myId = localStorage.getItem(K.session)
    if (!myId) return
    const notes = read<Note[]>(K.notes, [])
    const idx = notes.findIndex((n) => n.id === id)
    if (idx !== -1) {
      notes[idx].shared_with = notes[idx].shared_with.filter((u) => u !== myId)
      write(K.notes, notes)
    }
  },

  async getNote(id) {
    cleanupExpiredAudio()
    const notes = read<Note[]>(K.notes, [])
    return notes.find((n) => n.id === id) ?? null
  },

  async createNote(input) {
    const notes = read<Note[]>(K.notes, [])
    const now = new Date().toISOString()
    const note: Note = {
      id: uid('n_'),
      user_id: input.user_id,
      title: input.title,
      emoji: input.emoji ?? null,
      type: input.type ?? 'recording',
      device: input.device ?? null,
      template: input.template ?? 'geral',
      context: input.context ?? '',
      folder: input.folder ?? null,
      folder_id: input.folder_id ?? null,
      duration_seconds: input.duration_seconds ?? 0,
      audio_url: input.audio_url ?? null,
      language: input.language ?? 'pt-BR',
      transcript: input.transcript ?? '',
      summary: input.summary ?? '',
      detailed_summary: input.detailed_summary ?? null,
      analysis: input.analysis ?? null,
      mindmap: input.mindmap ?? null,
      action_items: input.action_items ?? [],
      chat: input.chat ?? [],
      shared_with: input.shared_with ?? [],
      shared_by: input.shared_by ?? null,
      shared_from_note_id: input.shared_from_note_id ?? null,
      status: input.status ?? 'processing',
      priority: input.priority ?? null,
      keep_audio: input.keep_audio ?? false,
      audio_deleted_at: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    }
    notes.push(note)
    write(K.notes, notes)
    return note
  },

  async updateNote(id, patch) {
    const notes = read<Note[]>(K.notes, [])
    const idx = notes.findIndex((n) => n.id === id)
    if (idx === -1) throw new Error('Nota nao encontrada.')
    notes[idx] = { ...notes[idx], ...patch, updated_at: new Date().toISOString() }
    write(K.notes, notes)
    return notes[idx]
  },

  async deleteNote(id) {
    const notes = read<Note[]>(K.notes, [])
    const idx = notes.findIndex((n) => n.id === id)
    if (idx !== -1) {
      notes[idx].deleted_at = new Date().toISOString()
      write(K.notes, notes)
    }
  },

  async logUsage(userId, type, noteId = null) {
    const usage = read<UsageEvent[]>(K.usage, [])
    usage.push({ id: uid('e_'), user_id: userId, note_id: noteId, type, created_at: new Date().toISOString() })
    write(K.usage, usage)
  },

  async listUsage() {
    return read<UsageEvent[]>(K.usage, [])
  },

  async adminRows(): Promise<AdminUserRow[]> {
    seed()
    const profiles = getProfiles()
    const notes = read<Note[]>(K.notes, [])
    const usage = read<UsageEvent[]>(K.usage, [])
    const aiTypes: UsageEventType[] = ['ai_summary', 'ai_detailed', 'ai_analysis', 'ai_chat']

    return profiles.map((profile) => {
      const uEvents = usage.filter((e) => e.user_id === profile.id)
      const userNotes = notes.filter((n) => n.user_id === profile.id)
      const last = uEvents
        .map((e) => e.created_at)
        .concat(userNotes.map((n) => n.created_at))
        .sort()
        .pop()
      return {
        profile,
        notesCount: userNotes.length,
        recordings: uEvents.filter((e) => e.type === 'recording').length,
        transcriptions: uEvents.filter((e) => e.type === 'transcription').length,
        aiSuggestions: uEvents.filter((e) => aiTypes.includes(e.type)).length,
        ttsCount: uEvents.filter((e) => e.type === 'tts').length,
        lastActivity: last ?? null,
      }
    })
  },
}
