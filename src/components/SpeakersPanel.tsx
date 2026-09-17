import { useState } from 'react'
import { BadgeCheck, Pencil, Quote, Sparkles, UserRound, Users } from 'lucide-react'
import type { Note } from '../lib/types'
import { db } from '../lib/api'
import { identifySpeakers } from '../lib/ai'
import { aiError } from '../lib/aiError'
import { logSilentError } from '../lib/auditLog'
import {
  mergeAutoNames,
  setManualName,
  speakerInitials,
  speakerLabels,
  SPEAKER_NAME_MAX,
  type SpeakerName,
} from '../lib/speakers'
import { SPEAKER_TONES } from './NoteContent'
import { Sheet, Spinner } from './ui'
import { useToast } from './Toast'
import { useT } from '../lib/i18n'

/**
 * "Quem falou" (17/09/2026). A diarizacao so separa as vozes (Falante A, B...). Aqui a pessoa ve os
 * nomes que a propria conversa provou -- com o trecho que prova --, pede uma nova busca e da ou
 * corrige nomes a mao. Nome manual nunca e trocado pela busca automatica.
 */
export function SpeakersPanel({
  note,
  canEdit,
  onSaved,
}: {
  note: Note
  canEdit: boolean
  onSaved: (updated: Note) => void
}) {
  const t = useT()
  const toast = useToast()
  const labels = speakerLabels(note.transcript)
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [proof, setProof] = useState<{ label: string; info: SpeakerName } | null>(null)

  if (labels.length < 2) return null

  const names = note.speakers?.names ?? {}
  const checked = !!note.speakers?.checked_at
  const autoCount = labels.filter((l) => names[l]?.source === 'auto').length

  async function search() {
    setSearching(true)
    try {
      const auto = await identifySpeakers(note.transcript)
      const merged = mergeAutoNames(note.speakers, auto)
      const updated = await db.updateNote(note.id, { speakers: merged })
      onSaved(updated)
      const found = Object.keys(auto).length
      toast(
        found === 0
          ? t('speakers.foundNone')
          : t(found === 1 ? 'speakers.foundOne' : 'speakers.foundMany').replace('{n}', String(found)),
        found === 0 ? 'info' : 'success',
      )
    } catch (err) {
      logSilentError('client:SpeakersPanel.search', err)
      toast(aiError(err, t('common.error')), 'error')
    } finally {
      setSearching(false)
    }
  }

  function openEdit(label: string) {
    setDraft(names[label]?.name ?? '')
    setEditing(label)
  }

  async function save(name: string) {
    if (!editing) return
    setSaving(true)
    try {
      const updated = await db.updateNote(note.id, { speakers: setManualName(note.speakers, editing, name) })
      onSaved(updated)
      setEditing(null)
    } catch (err) {
      logSilentError('client:SpeakersPanel.save', err)
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const proofLine = (e: NonNullable<SpeakerName['evidence']>[number]) =>
    e.type === 'self' ? t('speakers.proofSelf') : e.type === 'handoff' ? t('speakers.proofHandoff') : t('speakers.proofAddressed')

  return (
    <div className="card p-4 mb-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="flex items-center gap-2 font-display font-semibold mr-auto">
          <Users size={17} className="text-accent" /> {t('speakers.title')}
          <span className="text-xs font-normal text-content-muted">({labels.length})</span>
        </h3>
        {canEdit && (
          <button onClick={search} disabled={searching} className="btn-ghost h-8 px-2.5 text-xs">
            {searching ? <Spinner size={13} /> : <Sparkles size={13} />}
            {searching ? t('speakers.searching') : checked ? t('speakers.searchAgain') : t('speakers.search')}
          </button>
        )}
      </div>

      <ul className="flex flex-wrap gap-2">
        {labels.map((label, i) => {
          const info = names[label]
          const tone = SPEAKER_TONES[i % SPEAKER_TONES.length]
          return (
            <li
              key={label}
              className="flex items-center gap-2 rounded-full border border-surface-border bg-surface-elevated pl-1 pr-1.5 py-1 min-w-0 max-w-full"
            >
              <span className={`grid place-items-center h-7 w-7 rounded-full text-[11px] font-bold shrink-0 ${tone}`}>
                {info ? speakerInitials(info.name) : label}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight truncate">
                  {info ? info.name : `${t('speakers.label')} ${label}`}
                </span>
                <span className="block text-[10px] text-content-muted leading-tight">
                  {info ? (info.source === 'auto' ? t('speakers.sourceAuto') : t('speakers.sourceManual')) : t('speakers.noName')}
                </span>
              </span>
              {info?.source === 'auto' && (info.evidence?.length ?? 0) > 0 && (
                <button
                  onClick={() => setProof({ label, info })}
                  className="grid place-items-center h-7 w-7 rounded-full text-emerald-600 dark:text-emerald-400 hover:bg-surface-card shrink-0"
                  aria-label={t('speakers.why')}
                  title={t('speakers.why')}
                >
                  <BadgeCheck size={15} />
                </button>
              )}
              {canEdit && (
                <button
                  onClick={() => openEdit(label)}
                  className="grid place-items-center h-7 w-7 rounded-full text-content-muted hover:text-content-primary hover:bg-surface-card shrink-0"
                  aria-label={info ? t('speakers.rename') : t('speakers.give')}
                  title={info ? t('speakers.rename') : t('speakers.give')}
                >
                  <Pencil size={13} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-content-muted mt-3">
        {!checked ? t('speakers.hintNever') : autoCount === 0 ? t('speakers.hintNone') : t('speakers.hintSome')}
      </p>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={names[editing ?? '']?.name ? t('speakers.rename') : t('speakers.give')}
      >
        <p className="text-sm text-content-secondary mb-3">
          {t('speakers.editHint').replace('{label}', `${t('speakers.label')} ${editing ?? ''}`)}
        </p>
        <label className="label">{t('speakers.nameLabel')}</label>
        <input
          className="input mb-4"
          maxLength={SPEAKER_NAME_MAX}
          placeholder={t('speakers.namePh')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && draft.trim() && save(draft)}
          autoFocus
        />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary flex-1" onClick={() => save(draft)} disabled={saving || !draft.trim()}>
            {saving ? <Spinner /> : <UserRound size={17} />} {t('common.save')}
          </button>
          {names[editing ?? ''] && (
            <button className="btn-outline flex-1" onClick={() => save('')} disabled={saving}>
              {t('speakers.clear').replace('{label}', `${t('speakers.label')} ${editing ?? ''}`)}
            </button>
          )}
        </div>
      </Sheet>

      <Sheet open={!!proof} onClose={() => setProof(null)} title={t('speakers.whyTitle').replace('{name}', proof?.info.name ?? '')}>
        <p className="text-sm text-content-secondary mb-4">
          {t('speakers.whyIntro').replace('{label}', `${t('speakers.label')} ${proof?.label ?? ''}`)}
        </p>
        <ul className="space-y-3 mb-4">
          {(proof?.info.evidence ?? []).map((e, i) => (
            <li key={i} className="rounded-xl bg-surface-elevated border border-surface-border p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted mb-1">{proofLine(e)}</p>
              <p className="flex gap-2 text-sm">
                <Quote size={14} className="text-accent shrink-0 mt-0.5" />
                <span className="break-words">{e.quote}</span>
              </p>
            </li>
          ))}
        </ul>
        {canEdit && proof && (
          <button
            className="btn-outline w-full"
            onClick={() => {
              const label = proof.label
              setProof(null)
              openEdit(label)
            }}
          >
            <Pencil size={15} /> {t('speakers.wrong')}
          </button>
        )}
      </Sheet>
    </div>
  )
}
