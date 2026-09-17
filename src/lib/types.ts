// Domain types shared across data layer, UI and mock.

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
  keep_audio: boolean
  audio_deleted_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

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
  /** Freios de gasto com IA (Config > Admin). */
  ai_enabled: boolean
  ai_daily_usd_per_user: number
  ai_monthly_usd_global: number
  ai_rate_per_min: number
  ai_daily_alert_usd: number
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
