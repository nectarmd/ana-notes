import { useEffect, useRef, useState } from 'react'
import { Play, Pause, RotateCcw, RotateCw } from 'lucide-react'
import { getAudioUrl } from '../lib/audioStore'
import { fmtClock } from '../lib/format'
import { Spinner } from './ui'

const SPEEDS = [1, 1.25, 1.5, 2]

const clock = (n: number) => (Number.isFinite(n) && n >= 0 ? fmtClock(n) : '--:--')

export function AudioPlayer({ audioRef, durationHint = 0 }: { audioRef: string; durationHint?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [seeking, setSeeking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [speedIdx, setSpeedIdx] = useState(0)
  const el = useRef<HTMLAudioElement | null>(null)
  const probing = useRef(false)

  useEffect(() => {
    let objUrl: string | null = null
    getAudioUrl(audioRef).then((u) => {
      objUrl = u && u.startsWith('blob:') ? u : null
      setUrl(u)
      setLoading(false)
    })
    return () => {
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
  }, [audioRef])

  /**
   * O MediaRecorder grava WebM sem a duracao no cabecalho: `audio.duration` vem Infinity.
   * Isso quebrava o tempo total, o max do slider e o seek. Truque padrao: pular para um
   * tempo absurdo, deixar o browser varrer o arquivo, ler a duracao real e voltar ao inicio.
   */
  function resolveDuration(a: HTMLAudioElement) {
    if (Number.isFinite(a.duration) && a.duration > 0) {
      setDuration(a.duration)
      return
    }
    const onTimeUpdate = () => {
      a.removeEventListener('timeupdate', onTimeUpdate)
      if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration)
      else setDuration(durationHint) // ultimo recurso: o que salvamos na nota
      a.currentTime = 0
      setCurrent(0)
      probing.current = false
    }
    probing.current = true
    a.addEventListener('timeupdate', onTimeUpdate)
    a.currentTime = 1e101 // forca a varredura
  }

  async function toggle() {
    const a = el.current
    if (!a) return
    setError(null)
    if (playing) {
      a.pause()
      return
    }
    try {
      await a.play()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível reproduzir.')
    }
  }

  function seekTo(v: number) {
    const a = el.current
    if (!a || !Number.isFinite(v)) return
    const limit = duration || durationHint || v
    a.currentTime = Math.min(Math.max(0, v), limit)
    setCurrent(a.currentTime)
  }

  function skip(sec: number) {
    const a = el.current
    if (a) seekTo(a.currentTime + sec)
  }

  function cycleSpeed() {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    if (el.current) el.current.playbackRate = SPEEDS[next]
  }

  if (loading)
    return (
      <div className="card p-4 grid place-items-center h-24">
        <Spinner className="text-accent" />
      </div>
    )

  if (!url)
    return (
      <div className="card p-4 text-sm text-content-muted text-center">
        Áudio não disponível para reprodução.
      </div>
    )

  const max = duration || durationHint || 0

  return (
    <div className="card p-4">
      <audio
        ref={el}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => resolveDuration(e.currentTarget)}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setDuration(d)
        }}
        onTimeUpdate={(e) => {
          if (!seeking && !probing.current) setCurrent(e.currentTarget.currentTime)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError('Falha ao carregar o áudio.')}
      />

      <input
        type="range"
        min={0}
        max={max || 1}
        value={Math.min(current, max || current)}
        step={0.1}
        disabled={!max}
        // Enquanto arrasta, o timeupdate nao pode sobrescrever a posicao do cursor.
        onPointerDown={() => setSeeking(true)}
        onPointerUp={() => setSeeking(false)}
        onPointerCancel={() => setSeeking(false)}
        onKeyDown={() => setSeeking(true)}
        onKeyUp={() => setSeeking(false)}
        onChange={(e) => seekTo(Number(e.target.value))}
        className="w-full accent-accent mb-2 cursor-pointer disabled:cursor-not-allowed"
        aria-label="Progresso do áudio"
      />

      <div className="flex items-center justify-between text-xs text-content-muted mb-3 tabular-nums">
        <span>{clock(current)}</span>
        <span>{clock(max)}</span>
      </div>

      {error && <p className="alert-error text-xs mb-3">{error}</p>}

      <div className="flex items-center justify-center gap-4">
        <button onClick={() => skip(-10)} className="grid place-items-center h-11 w-11 rounded-full bg-surface-elevated text-content-secondary" aria-label="Voltar 10s">
          <RotateCcw size={20} />
        </button>
        <button onClick={toggle} className="btn-primary h-14 w-14 rounded-full p-0" aria-label={playing ? 'Pausar' : 'Reproduzir'}>
          {playing ? <Pause size={24} /> : <Play size={24} />}
        </button>
        <button onClick={() => skip(10)} className="grid place-items-center h-11 w-11 rounded-full bg-surface-elevated text-content-secondary" aria-label="Avancar 10s">
          <RotateCw size={20} />
        </button>
        <button onClick={cycleSpeed} className="grid place-items-center h-11 min-w-11 px-3 rounded-full bg-surface-elevated text-content-secondary font-semibold text-sm" aria-label="Velocidade">
          {SPEEDS[speedIdx]}x
        </button>
      </div>
    </div>
  )
}
