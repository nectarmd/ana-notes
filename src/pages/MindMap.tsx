import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Network } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../lib/api'
import { generateMindMap, hasMindMap } from '../lib/ai'
import type { Note } from '../lib/types'
import { Spinner } from '../components/ui'
import { MindMapView } from '../components/MindMapView'
import { useToast } from '../components/Toast'
import { useT } from '../lib/i18n'
import { logClientError, logSilentError } from '../lib/auditLog'
import { withSpeakerNames } from '../lib/speakers'

/** Pagina do mapa mental de uma nota. Gera na primeira vez e salva; nas proximas abre o salvo. */
export function MindMapPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const toast = useToast()
  const t = useT()
  const [note, setNote] = useState<Note | null | undefined>(undefined)
  const [generating, setGenerating] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!id) return
    db.getNote(id)
      .then(setNote)
      .catch((err) => {
        // Uma falha de rede vira exatamente a mesma tela de "nota nao encontrada" -- indistinguivel
        // do caso real, sem isto.
        logSilentError('client:MindMap.getNote', err)
        setNote(null)
      })
  }, [id])

  async function generate(current: Note) {
    if (generating) return
    setGenerating(true)
    try {
      const mindmap = await generateMindMap(withSpeakerNames(current).transcript, {
        template: current.template,
        context: current.context,
      })
      // Um mapa sem ramos so serviria para travar a nota num mapa vazio: nao salva, deixa repetir.
      if (!hasMindMap(mindmap)) {
        logClientError({
          severity: 'warning',
          category: 'system',
          source: 'client:MindMap.generate',
          message: 'IA devolveu mapa mental vazio (sem branches)',
          note_id: current.id,
        })
        toast(t('common.error'), 'error')
        return
      }
      const updated = await db.updateNote(current.id, { mindmap })
      if (profile) await db.logUsage(profile.id, 'ai_analysis', current.id)
      setNote(updated)
    } catch (err) {
      logSilentError('client:MindMap.generate', err)
      toast(t('common.error'), 'error')
    } finally {
      setGenerating(false)
    }
  }

  // Gera automaticamente na primeira vez (quando a nota ainda nao tem mapa salvo).
  useEffect(() => {
    if (note && !hasMindMap(note.mindmap) && !startedRef.current) {
      startedRef.current = true
      generate(note)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note])

  if (note === undefined)
    return (
      <div className="min-h-dvh grid place-items-center">
        <Spinner size={26} className="text-accent" />
      </div>
    )
  if (note === null)
    return (
      <div className="min-h-dvh grid place-items-center px-6 text-center">
        <div>
          <p className="text-content-secondary mb-4">{t('note.notFound')}</p>
          <button className="btn-primary" onClick={() => navigate('/')}>{t('note.back')}</button>
        </div>
      </div>
    )

  return (
    <div className="px-5 safe-top pb-16 max-w-5xl mx-auto">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/nota/${note.id}`)}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label={t('note.back')}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold flex items-center gap-2">
            <Network size={20} className="text-accent shrink-0" /> {t('note.mindmap')}
          </h1>
          <p className="text-sm text-content-muted truncate">{note.title}</p>
        </div>
        {/* "Gerar de novo" removido a pedido: cada geracao custa tokens e o mapa ja fica salvo
            na nota. Para alterar o mapa, baixe em SVG ou OPML pela barra do proprio mapa. */}
      </header>

      {generating && !hasMindMap(note.mindmap) ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Spinner size={28} className="text-accent mb-4" />
          <p className="font-display font-semibold">{t('note.generating')}...</p>
          <p className="text-content-muted text-sm mt-1">{t('note.mindmapHint')}</p>
        </div>
      ) : hasMindMap(note.mindmap) ? (
        <MindMapView map={note.mindmap} title={note.title} />
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-content-secondary mb-4">{t('common.error')}</p>
          <button className="btn-primary" onClick={() => generate(note)}>
            {t('note.mindmap')}
          </button>
        </div>
      )}
    </div>
  )
}
