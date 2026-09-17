// Domain types shared across data layer, UI and mock.

import type { NoteSpeakers } from './speakers'

export type UserRole = 'admin' | 'member'

export interface Folder {
  id: string
  user_id: string
  name: string
  color: string
  created_at: string
}

/** Periodo de auto-delete do audio (Config > Preferencias). */
export type RetentionDays = 3 | 7 | 14
export const RETENTION_CHOICES: RetentionDays[] = [3, 7, 14]
export const RETENTION_DEFAULT: RetentionDays = 3

export interface Profile {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  role: UserRole
  avatar_url: string | null
  /** @handle do Instagram, sem o @. */
  instagram: string | null
  /** URL do perfil no LinkedIn (ou so o handle). */
  linkedin: string | null
  audio_retention_days: RetentionDays
  created_at: string
}

/** Campos que o proprio usuario pode editar no seu perfil. */
export type ProfilePatch = Partial<
  Pick<
    Profile,
    'first_name' | 'last_name' | 'avatar_url' | 'phone' | 'instagram' | 'linkedin' | 'audio_retention_days'
  >
>

/** So o necessario para exibir alguem na busca de amigos e no chat. */
export type PersonRef = Pick<Profile, 'id' | 'first_name' | 'last_name' | 'email' | 'avatar_url'>

/** Tarefa avulsa: criada a mao, sem nota de origem. */
export interface Task {
  id: string
  user_id: string
  text: string
  owner: string | null
  due: string | null
  done: boolean
  /** Urgencia (migration 0040). */
  priority: TaskPriority
  created_at: string
}

export const TASK_TEXT_MAX = 140
export const FRIEND_MSG_MAX = 50
/** Mensagens entre amigos somem depois disso (limpeza diaria em retention-cleanup). */
export const FRIEND_CHAT_DAYS = 7

export type FriendshipStatus = 'pending' | 'accepted'

export interface Friendship {
  id: string
  requester_id: string
  addressee_id: string
  status: FriendshipStatus
  created_at: string
}

/** Uma amizade ja resolvida do ponto de vista do usuario atual. */
export interface FriendEdge {
  friendship: Friendship
  /** O outro lado da amizade. */
  person: PersonRef
  /** Convite que chegou para mim e ainda nao respondi. */
  incoming: boolean
  unread: number
}

export type FriendMessageKind = 'message' | 'poke'

export interface FriendMessage {
  id: string
  sender_id: string
  recipient_id: string
  kind: FriendMessageKind
  body: string | null
  read_at: string | null
  created_at: string
}

export interface Tip {
  id: string
  title: string | null
  body: string
  active: boolean
  electron_only: boolean
  created_by: string | null
  created_at: string
}

export type TeamLinkStatus = 'pending' | 'accepted'

export interface TeamLink {
  id: string
  manager_id: string
  member_id: string
  status: TeamLinkStatus
  group_id: string | null
  created_at: string
}

export interface TeamGroup {
  id: string
  owner_id: string
  name: string
  color: string
  created_at: string
}

/** Um vinculo de equipe ja resolvido do ponto de vista de quem chama. */
export interface TeamEdge {
  link: TeamLink
  /** O outro lado do vinculo (o membro, do ponto de vista do manager). */
  person: PersonRef
  /** Convite que chegou pra mim (sou o member) e ainda nao respondi. */
  incoming: boolean
}

export type TicketTopic = 'financeiro' | 'tecnico' | 'feedback' | 'outros'
export interface SupportTicket {
  id: string
  user_id: string
  topic: TicketTopic
  subject: string
  message: string
  status: 'aberto' | 'resolvido'
  created_at: string
  /** Resposta do admin (0042). */
  reply?: string | null
  replied_at?: string | null
  replied_by?: string | null
  /** Contexto tecnico enviado junto (versao do site/app, dispositivo). */
  meta?: Record<string, string> | null
}

/** Aviso do sininho publicado pelo admin (0042). */
export type NoticeKind = 'info' | 'novidade' | 'alerta' | 'manutencao'
export type NoticeAudience = 'all' | 'windows' | 'admins'
export interface Notice {
  id: string
  title: string
  body: string
  link: string | null
  kind: NoticeKind
  audience: NoticeAudience
  starts_at: string | null
  ends_at: string | null
  active: boolean
  created_by: string | null
  created_at: string
}

export type NoteSourceType = 'recording' | 'upload' | 'file' | 'link' | 'call' | 'video' | 'image'
export type NoteDevice = 'mobile' | 'desktop' | null
export type NotePriority = 'alta' | 'media' | 'baixa'

/** Urgencia de uma tarefa (avulsa ou vinda de nota). Ausente = 'normal'. */
export type TaskPriority = 'low' | 'normal' | 'high'

export interface ActionItem {
  id: string
  text: string
  /** A IA devolve null quando nao identifica responsavel/prazo. */
  owner?: string | null
  due?: string | null
  done: boolean
  priority?: TaskPriority
}

/** Estruturada saida da "Analise de Reuniao". */
export interface MeetingAnalysis {
  overallScore?: number // 0-100
  tone: string
  strengths: string[]
  improvements: string[]
  questionsAsked: string[]
  suggestedQuestions: string[]
  pacing: string
  keyPoints: string[]
  risks: string[]
}

export interface MindMapBranch {
  title: string
  children: string[]
}
export interface MindMap {
  central: string
  branches: MindMapBranch[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface Note {
  id: string
  user_id: string
  title: string
  emoji?: string | null
  type: NoteSourceType
  device: NoteDevice
  template: string
  context: string
  folder: string | null
  folder_id: string | null
  duration_seconds: number
  audio_url: string | null
  language: string
  transcript: string
  summary: string
  detailed_summary: string | null
  analysis: MeetingAnalysis | null
  mindmap: MindMap | null
  action_items: ActionItem[]
  chat: ChatMessage[]
  /** Legado do modelo por referencia: hoje vive vazio (compartilhar cria copia, ver 0037). */
  shared_with: string[] // profile ids
  /** Copia recebida: quem enviou. null = nota criada pelo proprio usuario. */
  shared_by: string | null
  /** Copia recebida: nota de origem (evita duplicar a copia num reenvio). */
  shared_from_note_id: string | null
  status: 'processing' | 'ready' | 'error'
  priority: NotePriority | null
  /** Nomes dos falantes por rotulo da diarizacao (0043). A transcricao guarda os rotulos intactos. */
  speakers?: NoteSpeakers | null
  /** Coracao do cartao (0044). E pessoal: a copia compartilhada nasce sem ele. */
  favorite: boolean
  keep_audio: boolean
  audio_deleted_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

/** Linha leve da lista de recentes do menu lateral (sem transcricao). */
export type RecentNote = Pick<Note, 'id' | 'title' | 'type' | 'duration_seconds' | 'status' | 'created_at'>

export type UsageEventType =
  | 'recording'
  | 'transcription'
  | 'ai_summary'
  | 'ai_detailed'
  | 'ai_analysis'
  | 'ai_chat'
  | 'ai_feedback'
  | 'tts'

export interface UsageEvent {
  id: string
  user_id: string
  note_id: string | null
  type: UsageEventType
  created_at: string
}

export type AnnouncementType = 'info' | 'warning' | 'maintenance' | 'promo'

export interface BudgetAlert {
  id: string
  day: string
  spend_usd: number
  threshold_usd: number
  acknowledged: boolean
  created_at: string
}

export interface AppSettings {
  announcement_enabled: boolean
  announcement_type: AnnouncementType
  announcement_message: string
  announcement_starts_at: string | null
  announcement_ends_at: string | null
  announcement_version: number
  maintenance_enabled: boolean
  maintenance_message: string
  maintenance_eta: string
  /** Troca a dica mostrada na Home sozinha a cada N horas (mesma dica pra todo mundo). */
  tips_rotate_enabled: boolean
  tips_rotate_hours: number
  /** Freios de gasto com IA (Config > Admin). Valores em USD sao de gasto REAL (migration 0038). */
  ai_enabled: boolean
  ai_daily_usd_per_user: number
  ai_monthly_usd_global: number
  /** Protecao anti-abuso: chamadas por minuto por usuario (uma nota sao 3 ou 4 chamadas). */
  ai_rate_per_min: number
  ai_daily_alert_usd: number
  ai_notes_per_hour_per_user: number
  ai_audio_minutes_per_day_per_user: number
  /** Cobranca de cada provedor: 'free' nao conta como gasto real. */
  provider_billing: Record<string, 'paid' | 'free'>
  /** Limites de plano/credito de cada provedor (tier gratuito do Groq, credito do AssemblyAI...). */
  provider_limits: ProviderLimits
  /** Disjuntor aberto por provedor (credito esgotado, chave recusada). */
  ai_breaker: Record<string, { code: string; until: string; since: string }>
}

export interface ProviderLimits {
  groq?: {
    requests_min?: number
    requests_day?: number
    audio_seconds_hour?: number
    audio_seconds_day?: number
    fonte?: string
  }
  assemblyai?: { credit_usd?: number; fonte?: string }
  anthropic?: { balance_usd?: number | null; balance_set_at?: string | null; fonte?: string }
}

/** Problema que so o administrador resolve (credito esgotado, limite atingido...). */
export interface AdminAlert {
  id: string
  code: string
  severity: 'warning' | 'error' | 'critical'
  title: string
  detail: Record<string, unknown> | null
  occurrences: number
  affected_users: string[]
  first_seen_at: string
  last_seen_at: string
  resolved_at: string | null
  resolved_by: string | null
}

/** Linha agregada usada no painel de administrador. */
export interface AdminUserRow {
  profile: Profile
  notesCount: number
  recordings: number
  transcriptions: number
  aiSuggestions: number
  ttsCount: number
  lastActivity: string | null
}
