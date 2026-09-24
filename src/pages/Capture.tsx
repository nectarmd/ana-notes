import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Mic,
  Image as ImageIcon,
  Pause,
  Play,
  Square,
  Upload,
  FileText,
  Link2,
  Video,
  MonitorSmartphone,
  Headphones,
  Info,
} from 'lucide-react'
import { extractFile, extractLink, FileError, TEXT_FILE_ACCEPT } from '../lib/extract'
import { AUDIO_ACCEPT, VIDEO_ACCEPT, isAudioFile, isVideoFile } from '../lib/mediaKind'
import { IMAGE_ACCEPT, isSupportedImage, MAX_IMAGE_MB, prepareImage } from '../lib/image'
import { aiError } from '../lib/aiError'
import { logClientError, logSilentError } from '../lib/auditLog'
import { activeCooldown, cooldownSecondsLeft, formatWait } from '../lib/appError'
import { useAuth } from '../auth/AuthProvider'
import {
  useRecorder,
  canCaptureSystemAudio,
  supportsTabAudio,
  isMobileBrowser,
  canKeepScreenAwake,
} from '../lib/useRecorder'
import { isElectron } from '../lib/electron'
import { SystemAudioHelp } from '../components/SystemAudioHelp'
import { useToast } from '../components/Toast'
import { db, config } from '../lib/api'
import { uid } from '../lib/db'
import {
  generateActionItems,
  generateSummary,
  generateSummaryAndItems,
  identifySpeakers,
  summarizeImage,
} from '../lib/ai'
import { hasSpeakers, mergeAutoNames, NOTE_CHANGED_EVENT, type NoteSpeakers } from '../lib/speakers'
import { findRecentNoteWithTranscript } from '../lib/noteDedupe'
import {
  saveAudio,
  savePendingRecording,
  listPendingRecordings,
  getPendingRecordingBlob,
  deletePendingRecording,
  setPendingRecordingNote,
  type PendingRecordingMeta,
} from '../lib/audioStore'
import { isSilentAudio } from '../lib/audioLevel'
import { enfileirarNota } from '../lib/noteJobs'
import { currentDevice } from '../lib/device'
import { fmtClock, fmtDuration } from '../lib/format'
import { AutoTextarea, Spinner } from '../components/ui'
import { ConsentSheet, RecordingNotice } from '../components/ConsentSheet'
import { hasRecordingConsent, setRecordingConsent } from '../lib/consent'
import { takePendingUpload } from '../lib/sharedFile'
import { bgRecorder, canRecordInBackground } from '../lib/bgRecorder'
import { TEMPLATES } from '../lib/templates'
import type { Note, NoteSourceType } from '../lib/types'

type Mode = 'record' | 'meeting' | 'upload' | 'video' | 'file' | 'link' | 'image'

// Mesmo limite do servidor (transcribe: MAX_FILE_MB). Acima de 24 MB o arquivo vai para o
// AssemblyAI, que aceita video; o limite antigo de 25 MB era do Whisper.
const MAX_VIDEO_MB = 60

const STEPS = ['Transcrevendo áudio', 'Gerando resumo e itens de ação', 'Finalizando'] as const

/** Intervalo dos checkpoints de gravacao em andamento (ver useEffect de checkpoint abaixo). */
const CHECKPOINT_MS = 20_000

export function Capture() {
  const [params, setParams] = useSearchParams()
  const mode = (params.get('mode') as Mode) || 'record'
  const navigate = useNavigate()
  const { profile } = useAuth()
  const recorder = useRecorder()
  const toast = useToast()

  // Prefill via query (ex.: vindo de um evento do calendario).
  const [title, setTitle] = useState(params.get('title') ?? '')
  const [template, setTemplate] = useState('geral')
  const [context, setContext] = useState(params.get('context') ?? '')
  const [diarize, setDiarize] = useState(false)
  const [textInput, setTextInput] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [imageWords, setImageWords] = useState(150)
  const [processing, setProcessing] = useState(false)
  // Revela o botao "Cancelar" no spinner so depois de alguns segundos: um processamento rapido
  // (imagem/texto) nem chega a mostra-lo; um que travou da a saida pro usuario.
  const [showCancel, setShowCancel] = useState(false)
  const [step, setStep] = useState(0)
  /** Aviso extra durante o processamento (ex.: audio grande transcrevendo ha X min). O subtitulo
   *  padrao promete "alguns segundos" -- para um arquivo de 1 h isso parece travado. */
const [stepNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A ultima tentativa parou no aviso de "gravacao silenciosa": habilita o botao de
  // transcrever mesmo assim (a decisao e do usuario, nunca do app).
  const [silentDetected, setSilentDetected] = useState(false)
  // Segundos ate poder tentar de novo (limite de uso ou problema que so o administrador resolve).
  // Sem isto a Larissa tentou 16 vezes seguidas em 16/09 contra creditos esgotados.
  const [cooldownLeft, setCooldownLeft] = useState(0)
  useEffect(() => {
    if (!error) {
      setCooldownLeft(0)
      return
    }
    const tick = () => setCooldownLeft(cooldownSecondsLeft())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [error])
  const fileRef = useRef<HTMLInputElement | null>(null)

  /**
   * Rede de seguranca contra perder a gravacao se o processamento falhar no meio do caminho
   * (rede caiu, sessao expirou etc.). Todos os refs abaixo sao por TENTATIVA (um ciclo de
   * finalize + possiveis retries do mesmo audio) e sao zerados ao iniciar uma nova captura.
   */
  const pendingKeyRef = useRef<string | null>(null)
  const createdNoteRef = useRef<Note | null>(null)
  const lastFinalizeOptsRef = useRef<Parameters<typeof finalize>[0] | null>(null)
  // Identifica a tentativa de finalize em andamento. Se o usuario CANCELAR (ou disparar um
  // retry) enquanto uma chamada de rede esta pendurada, incrementamos isto -- a tentativa
  // antiga, ao terminar tarde, ve que nao e mais a atual e NAO sequestra a tela (nem navega,
  // nem apaga a gravacao pendente). Sem isto, um upload/transcricao que trava numa rede movel
  // instavel deixava o usuario preso pra sempre no spinner de "processando".
  const finalizeAttemptRef = useRef(0)
  // Gravacoes de tentativas ANTERIORES (sessao/aba diferente) que ficaram sem processar.
  const [pendingRecordings, setPendingRecordings] = useState(() => listPendingRecordings())
  const [resumingKey, setResumingKey] = useState<string | null>(null)

  // "Cancelar" surge 12s apos comecar a processar (e some assim que o processamento termina).
  // Tempo suficiente pra um processamento normal terminar sozinho; se travou de vez, da a saida.
  useEffect(() => {
    if (!processing) {
      setShowCancel(false)
      return
    }
    const id = setTimeout(() => setShowCancel(true), 12000)
    return () => clearTimeout(id)
  }, [processing])

  const autoStoppedRef = useRef(false)
  const isAudioMode = mode === 'record' || mode === 'meeting'
  // No web-mobile a captura do audio interno nao existe: mostramos so um aviso, sem formulario.
  const meetingBlocked = mode === 'meeting' && !canCaptureSystemAudio()

  // Aviso de gravacao: exibido uma vez por usuario, antes da primeira gravacao.
  const [consentOpen, setConsentOpen] = useState(false)
  const pendingStartRef = useRef<null | (() => Promise<void>)>(null)

  /** Garante o aceite do aviso antes de iniciar qualquer captura de audio. */
  function withConsent(start: () => Promise<void>) {
    if (hasRecordingConsent(profile?.id)) {
      void start()
      return
    }
    pendingStartRef.current = start
    setConsentOpen(true)
  }

  function acceptConsent() {
    setRecordingConsent(profile?.id)
    setConsentOpen(false)
    const start = pendingStartRef.current
    pendingStartRef.current = null
    if (start) void start()
  }

  // Auto-iniciar (atalho Ctrl+Shift+G do app Windows -> ?autostart=1): ja dispara a gravacao de
  // reuniao sem clicar em "Iniciar". So no modo reuniao e onde a captura do audio do PC existe.
  // O gesto que o getDisplayMedia exige vem do executeJavaScript(userGesture=true) no main.cjs.
  // Limpamos o param assim que dispara pra nao reiniciar em re-render/refresh.
  const autostart = params.get('autostart') === '1'
  useEffect(() => {
    if (!autostart || mode !== 'meeting' || !canCaptureSystemAudio()) return
    if (recorder.state !== 'idle') return
    setParams(
      (prev) => {
        prev.delete('autostart')
        return prev
      },
      { replace: true },
    )
    withConsent(startMeeting)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, mode])

  // Diagnostico: registra no audit_log quando a reuniao no PC NAO capta o audio do sistema (so o
  // mic). Sem isto, o caso "gravou so a minha voz" nao deixa rastro nenhum pro admin investigar
  // (aconteceu com a Giovana em 31/07 -- chamada de WhatsApp cujo audio nao entrou no loopback).
  const sysWarnLoggedRef = useRef(false)
  useEffect(() => {
    if (mode !== 'meeting') return
    if (!recorder.systemAudioMissing && !recorder.systemSilent) return
    if (sysWarnLoggedRef.current) return
    sysWarnLoggedRef.current = true
    logClientError({
      severity: 'warning',
      category: 'silent',
      source: 'client:recorder',
      code: recorder.systemAudioMissing ? 'RECORDER_SYSTEM_AUDIO_MISSING' : 'RECORDER_SYSTEM_AUDIO_MUTED',
      message: recorder.systemAudioMissing
        ? 'Reunião no PC: áudio do sistema AUSENTE (gravando só o microfone).'
        : 'Reunião no PC: áudio do sistema MUDO por 30s+ (gravando só o microfone).',
      detail: { inApp: isElectron(), missing: recorder.systemAudioMissing, silent: recorder.systemSilent },
    })
  }, [recorder.systemAudioMissing, recorder.systemSilent, mode])

  // No APK Android o modo microfone usa o gravador NATIVO: sobrevive a tela apagada.
  // (Gravar Meet continua no navegador — depende do getDisplayMedia.)
  const useNative = canRecordInBackground() && mode === 'record'
  const [nState, setNState] = useState<'idle' | 'recording' | 'paused'>('idle')
  const [nSecs, setNSecs] = useState(0)

  useEffect(() => {
    if (!useNative || nState === 'idle') return
    const id = setInterval(() => {
      bgRecorder
        .status()
        .then((s) => setNSecs(s.seconds))
        .catch(() => {})
    }, 1000)
    return () => clearInterval(id)
  }, [useNative, nState])

  // Estado unificado (nativo ou navegador) usado pela UI.
  const recState = useNative ? nState : recorder.state
  const recSeconds = useNative ? nSecs : recorder.seconds
  const recLevel = useNative ? 0 : recorder.level

  /**
   * Gravando (ou pausado): o formulario sai da tela. Ele so servia antes de comecar e,
   * montado, empurrava o cronometro e os botoes de pausar/parar para baixo da dobra.
   */
  const recActive = isAudioMode && recState !== 'idle' && !recorder.error

  async function startRecord() {
    autoStoppedRef.current = false
    if (useNative) {
      await bgRecorder.start()
      setNState('recording')
      setNSecs(0)
      return
    }
    await recorder.start()
  }

  async function togglePause() {
    if (useNative) {
      if (nState === 'recording') {
        await bgRecorder.pause()
        setNState('paused')
      } else {
        await bgRecorder.resume()
        setNState('recording')
      }
      return
    }
    if (recorder.state === 'recording') recorder.pause()
    else recorder.resume()
  }

  // Encerra automaticamente ao atingir o limite de 2 horas (nativo ou navegador).
  useEffect(() => {
    if (
      isAudioMode &&
      recState === 'recording' &&
      recSeconds >= config.recordingMaxSeconds &&
      !autoStoppedRef.current
    ) {
      autoStoppedRef.current = true
      onStopRecording()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recSeconds])

  // Reuniao: se o usuario parar o compartilhamento pelo navegador, finaliza.
  useEffect(() => {
    if (recorder.ended && !autoStoppedRef.current) {
      autoStoppedRef.current = true
      onStopRecording()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.ended])

  /**
   * Rede de seguranca contra perder a gravacao INTEIRA se o navegador travar, a aba fechar
   * sozinha ou o computador desligar ANTES do usuario clicar em Encerrar: sem isto, o audio
   * so existe em memoria (o MediaRecorder so entrega dados no stop()) e some com a aba.
   * So roda na gravacao pelo navegador (nativo no Android ja grava direto em arquivo, em
   * disco, sobrevivendo a app fechar).
   */
  const lastCheckpointSizeRef = useRef(0)
  useEffect(() => {
    if (useNative || (recState !== 'recording' && recState !== 'paused')) return
    if (!pendingKeyRef.current) pendingKeyRef.current = uid('rec_')
    const pendingKey = pendingKeyRef.current
    const today = new Date().toLocaleDateString('pt-BR')

    const tick = async () => {
      const blob = recorder.snapshot()
      // So regrava quando ha audio novo desde o ultimo checkpoint (evita gravar o mesmo
      // blob repetidas vezes no IndexedDB enquanto pausado ou sem novidade).
      if (!blob || blob.size === 0 || blob.size === lastCheckpointSizeRef.current) return
      lastCheckpointSizeRef.current = blob.size
      await savePendingRecording(pendingKey, blob, {
        mode,
        type: 'recording',
        title,
        template,
        context,
        diarize,
        duration: recSeconds,
        fallbackTitle: mode === 'meeting' ? `Reunião ${today}` : `Gravação ${today}`,
        skipAudioStore: false,
        skipActionItems: false,
        savedAt: new Date().toISOString(),
      })
    }
    const id = window.setInterval(tick, CHECKPOINT_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useNative, recState])

  // Avisa antes de fechar/recarregar a aba durante uma gravacao: reduz a causa mais comum de
  // "gravacao interrompida" (fechar sem querer). Os checkpoints acima cobrem o que passar disso.
  useEffect(() => {
    if (useNative || (recState !== 'recording' && recState !== 'paused')) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [useNative, recState])

  // Arquivo vindo do menu "Compartilhar" do Android: processa direto, sem o usuario
  // precisar escolher de novo. Nao mostra o aviso de gravacao (nos nao gravamos nada aqui).
  const sharedHandledRef = useRef(false)
  useEffect(() => {
    if (params.get('shared') !== '1' || sharedHandledRef.current || !profile) return
    const file = takePendingUpload()
    if (!file) return
    sharedHandledRef.current = true
    // isVideoFile (e nao File.type direto): share do Android tambem chega sem MIME as vezes.
    const isVideo = isVideoFile(file) && !isAudioFile(file)
    void finalize({
      type: isVideo ? 'video' : 'upload',
      audioBlob: file,
      duration: 0,
      fallbackTitle: file.name.replace(/\.[^.]+$/, '') || 'Áudio compartilhado',
      skipAudioStore: isVideo,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  async function finalize(input: {
    type: NoteSourceType
    transcript?: string
    duration?: number
    audioBlob?: Blob
    fallbackTitle: string
    skipAudioStore?: boolean
    /** Resumo ja pronto (ex.: visao de imagem): evita uma segunda chamada paga a IA. */
    summary?: string
    /** Conteudo sem action items (imagem): pula mais uma chamada. */
    skipActionItems?: boolean
    /** O usuario mandou transcrever mesmo com o aviso de gravacao silenciosa. */
    ignoreSilence?: boolean
  }) {
    if (!profile) return
    let opts = input
    setProcessing(true)
    setError(null)
    setSilentDetected(false)
    // Esta tentativa deixa de valer se o usuario cancelar (ou reiniciar) enquanto ela roda.
    const attempt = ++finalizeAttemptRef.current
    const superseded = () => finalizeAttemptRef.current !== attempt

    // Mesma chave durante toda a vida desta tentativa (inclusive em retries): nao persiste
    // blobs duplicados nem confunde qual gravacao pendente pertence a qual tentativa.
    if (!pendingKeyRef.current) pendingKeyRef.current = uid('rec_')
    const pendingKey = pendingKeyRef.current

    // 0 byte: o gravador morreu no meio e o stop() veio vazio. Mandar pro provedor so devolve
    // "groq 400: file is empty", que nao diz nada -- e o usuario reenviava 3, 4 vezes seguidas
    // (36 tentativas assim no audit_log entre 07/08 e 21/08). Sem isto o `isSilentAudio` abaixo
    // tambem nao pega: um blob vazio nem chega a decodificar.
    //
    // ANTES de desistir, olha o checkpoint: a cada 20s a gravacao em andamento e salva neste
    // aparelho sob a mesma chave. Se o gravador morreu depois disso, o checkpoint e a UNICA
    // copia do audio -- e ate a v0.19.3 este mesmo finalize o SOBRESCREVIA com o blob vazio
    // logo abaixo, destruindo a copia enquanto a tela dizia "continua salva neste aparelho"
    // (2026-09-04, iPhone: 49 min de gravacao, 0 byte no fim).
    if (opts.audioBlob && opts.audioBlob.size === 0 && !createdNoteRef.current) {
      const saved = await getPendingRecordingBlob(pendingKey).catch(() => null)
      if (superseded()) return
      if (saved && saved.size > 0) {
        const meta = listPendingRecordings().find((p) => p.key === pendingKey)?.meta
        // A duracao REAL e a do checkpoint (o cronometro seguiu contando depois que o gravador
        // morreu); sem meta, fica sem duracao em vez de inventar uma.
        opts = { ...opts, audioBlob: saved, duration: meta?.duration ?? 0 }
        toast('A gravação foi interrompida no meio. Recuperamos o áudio salvo até o último ponto de segurança.', 'info')
      } else {
        // Nao ha o que tentar de novo com este audio: sem o botao "Tentar novamente".
        lastFinalizeOptsRef.current = null
        setError(
          isMobileBrowser()
            ? 'Esta gravação não capturou áudio nenhum (arquivo vazio): o celular tirou o microfone do ANA no meio (tela bloqueada, câmera ou outro app) e nada chegou a ser gravado. Não há áudio para transcrever. Da próxima vez, mantenha o ANA aberto e a tela ligada até encerrar.'
            : 'Esta gravação não capturou áudio nenhum (arquivo vazio) — provavelmente o computador suspendeu a captura no meio. Não há áudio para transcrever.',
        )
        setProcessing(false)
        return
      }
    }
    lastFinalizeOptsRef.current = opts

    try {
      // Salva o audio no IndexedDB do navegador ANTES de qualquer chamada de rede. Se algo
      // falhar mais adiante (rede, sessao expirada, IA fora do ar), a gravacao continua
      // recuperavel: nunca se perde so porque o processamento deu errado.
      if (opts.audioBlob && !createdNoteRef.current) {
        await savePendingRecording(pendingKey, opts.audioBlob, {
          mode,
          type: opts.type,
          title,
          template,
          context,
          diarize,
          duration: opts.duration ?? 0,
          fallbackTitle: opts.fallbackTitle,
          skipAudioStore: !!opts.skipAudioStore,
          skipActionItems: !!opts.skipActionItems,
          savedAt: new Date().toISOString(),
        })
      }

      let note = createdNoteRef.current

      // ------------------------------------------------------------------------------------
      // GRAVACAO DE AUDIO: a nota nasce AGORA, antes de transcrever.
      //
      // Ate 23/09/2026 a tela segurava a pessoa ate transcricao e resumo terminarem. Se um
      // provedor falhava, ela via o relogio girando, clicava em parar de novo e achava o app
      // quebrado -- mesmo com o audio salvo. Agora ela sai daqui com a nota na mao e o resto
      // corre em segundo plano (ver noteJobs.ts), com o andamento gravado na propria nota.
      // ------------------------------------------------------------------------------------
      if (opts.audioBlob) {
        // Evita transcricao "alucinada" quando a gravacao ficou muda. SO AVISA — jamais apaga: o
        // audio segue salvo neste aparelho e o usuario decide se transcreve mesmo assim. (Um
        // delete que rodava aqui destruiu uma reuniao de 69 min em 04/08/2026 por um falso
        // positivo de silencio.) So GRAVACOES proprias passam pelo filtro: um ARQUIVO enviado e
        // ato deliberado, e o filtro decodifica o audio INTEIRO para PCM na memoria (um m4a de
        // ~50 MB/53 min vira ~1 GB) antes mesmo do upload.
        if (opts.type === 'recording' && !opts.ignoreSilence && (await isSilentAudio(opts.audioBlob))) {
          if (superseded()) return
          setSilentDetected(true)
          setError(
            'Não captamos quase nenhum áudio nesta gravação. Ela continua salva neste aparelho — você pode transcrever mesmo assim.',
          )
          setProcessing(false)
          return
        }

        if (!note) {
          note = await db.createNote({
            user_id: profile.id,
            title: title.trim() || opts.fallbackTitle,
            type: opts.type,
            device: currentDevice(),
            template,
            context,
            duration_seconds: opts.duration ?? 0,
            language: 'pt-BR',
            transcript: '',
            summary: '',
            action_items: [],
            status: 'processing',
            processing_stage: 'transcribing',
          })
          if (superseded()) return
          // Liga a gravacao salva neste aparelho a nota: retomar depois reaproveita ESTA nota.
          setPendingRecordingNote(pendingKey, note.id)
          // So contabiliza uso DEPOIS que a nota existe de verdade.
          await db.logUsage(profile.id, 'recording')
          await db.logUsage(profile.id, 'transcription')
        }

        enfileirarNota({
          noteId: note.id,
          pendingKey,
          userId: profile.id,
          title: note.title,
          meta: {
            diarize,
            template,
            context,
            skipAudioStore: !!opts.skipAudioStore,
            skipActionItems: !!opts.skipActionItems,
          },
        })
        // A fila assume daqui: esta tela nao guarda mais nada desta gravacao.
        pendingKeyRef.current = null
        createdNoteRef.current = null
        lastFinalizeOptsRef.current = null
        setProcessing(false)
        navigate(`/nota/${note.id}`, { replace: true })
        return
      }

      // Se uma tentativa anterior desta MESMA gravacao ja criou a nota (e so falhou depois --
      // na IA, ao salvar o audio), nao criamos outra: vamos direto para o que faltou.
      if (!note) {
        let transcript = opts.transcript ?? ''
        let language = 'pt-BR'

        // (O caminho de audio sai antes daqui: a nota nasce e a fila assume.)

        // A nota nasce AQUI, com o transcript e status 'processing' -- ANTES da IA. Na ordem
        // antiga (resumir, depois criar) qualquer falha da IA descartava a transcricao inteira:
        // em 26/08 um 401 da Anthropic jogou fora 83 min ja transcritos e pagos, e o usuario
        // teria de transcrever tudo de novo. Agora uma falha custa so a etapa de IA.
        // A MESMA transcricao ja virou nota nas ultimas horas (retentativa, segunda aba, audio
        // reenviado): abre essa nota em vez de criar uma copia. Em 16/09 uma gravacao virou 3 notas.
        const existing = await findRecentNoteWithTranscript(transcript)
        if (superseded()) return
        if (existing) {
          note = existing
          toast('Esta gravação já tinha virado uma nota. Abrimos a mesma, sem duplicar.', 'info')
        } else {
          note = await db.createNote({
            user_id: profile.id,
            title: title.trim() || opts.fallbackTitle,
            type: opts.type,
            device: currentDevice(),
            template,
            context,
            duration_seconds: opts.duration ?? 0,
            language,
            transcript,
            summary: '',
            action_items: [],
            status: 'processing',
          })
        }
        createdNoteRef.current = note
        // Liga a gravacao salva neste aparelho a nota: se a IA falhar e o usuario retomar depois
        // (outra sessao, outro dia), reaproveita ESTA nota em vez de criar uma copia.
        setPendingRecordingNote(pendingKey, note.id)

        // So contabiliza uso DEPOIS que a nota existe de verdade: uma tentativa que falhou
        // antes disso nao gerou nada e nao deveria custar orcamento na conta do usuario.
        if (opts.audioBlob && !existing) {
          await db.logUsage(profile.id, 'recording')
          await db.logUsage(profile.id, 'transcription')
        }
      }

      // Persiste o audio ANTES da IA (exceto video: o video e descartado apos extrair o audio).
      // Na ordem antiga o audio so subia depois do resumo dar certo: quando os creditos da
      // Anthropic acabaram em 16/09/2026, 11 notas ficaram com o audio so no aparelho de cada
      // usuaria. Uma falha aqui nao impede o resumo -- o audio segue salvo neste aparelho.
      if (opts.audioBlob && !opts.skipAudioStore && !note.audio_url) {
        try {
          const ref = await saveAudio(note.id, profile.id, opts.audioBlob)
          if (ref) note = await db.updateNote(note.id, { audio_url: ref })
          createdNoteRef.current = note
        } catch (upErr) {
          logSilentError('client:Capture.saveAudio', upErr)
        }
      }

      // Resumo e itens de acao. Fica FORA do bloco acima de proposito: uma nota que parou aqui
      // numa tentativa anterior (IA fora do ar, chave invalida, rede) e concluida agora
      // reaproveitando o transcript ja salvo, em vez de transcrever o audio outra vez.
      if (note.status !== 'ready') {
        const meta = { template, context }

        setStep(1)
        // Nomes dos falantes EM PARALELO com o resumo (a busca leva de 5 a 40 s e nao pode atrasar a
        // nota). O resumo sai com "Falante A" e a tela troca pelo nome na hora de mostrar. Falha aqui
        // nunca derruba o processamento: a nota fica sem nomes e da para tentar de novo nela.
        const namesJob: Promise<NoteSpeakers | null> =
          hasSpeakers(note.transcript) && !note.speakers?.checked_at
            ? identifySpeakers(note.transcript)
                .then((auto) => mergeAutoNames(createdNoteRef.current?.speakers, auto))
                .catch((err) => {
                  logSilentError('client:Capture.identifySpeakers', err)
                  return null
                })
            : Promise.resolve(null)
        let summary = opts.summary ?? ''
        let actionItems: Note['action_items'] = []
        if (!summary && !opts.skipActionItems) {
          // Caso normal: resumo e itens numa chamada so.
          const r = await generateSummaryAndItems(note.transcript, meta)
          summary = r.summary
          actionItems = r.actionItems
        } else {
          if (!summary) summary = await generateSummary(note.transcript, meta)
          if (!opts.skipActionItems) actionItems = await generateActionItems(note.transcript, meta)
        }

        setStep(2)
        // Espera os nomes so mais um pouco; se ainda nao chegaram, a nota abre assim mesmo e os
        // nomes sao gravados quando chegarem (a tela da nota escuta NOTE_CHANGED_EVENT).
        const NAMES_WAIT_MS = 6000
        const early = await Promise.race([
          namesJob,
          new Promise<undefined>((r) => setTimeout(() => r(undefined), NAMES_WAIT_MS)),
        ])
        note = await db.updateNote(note.id, {
          summary,
          action_items: actionItems,
          status: 'ready',
          ...(early ? { speakers: early } : {}),
        })
        if (early === undefined) {
          const noteId = note.id
          void namesJob.then(async (late) => {
            if (!late) return
            try {
              await db.updateNote(noteId, { speakers: late })
              window.dispatchEvent(new CustomEvent(NOTE_CHANGED_EVENT, { detail: noteId }))
            } catch (err) {
              logSilentError('client:Capture.saveSpeakersLate', err)
            }
          })
        }
        createdNoteRef.current = note
        await db.logUsage(profile.id, 'ai_summary')
      }

      // Cancelado no meio do caminho: a nota ja foi criada (fica salva, sem perda), mas nao
      // navegamos nem apagamos a pendencia -- deixa o usuario no controle da tela.
      if (superseded()) return

      // Sucesso completo: a rede de seguranca nao e mais necessaria para esta gravacao.
      await deletePendingRecording(pendingKey)
      pendingKeyRef.current = null
      createdNoteRef.current = null

      navigate(`/nota/${note.id}`, { replace: true })
    } catch (err) {
      // Uma tentativa cancelada que falha tarde nao deve reescrever a tela do usuario.
      if (superseded()) return
      // A nota existe e tem transcricao, mas ficou sem resumo. Deixa-la em "processando" a
      // esconde para sempre atras do spinner: a Larissa ficou com tres notas assim desde
      // 16/09/2026 (dia em que os creditos da Anthropic acabaram). Marcada como pronta, ela abre,
      // mostra a transcricao e oferece o botao de gerar o resumo -- e o "Tentar novamente" aqui
      // continua valendo.
      if (createdNoteRef.current) {
        void db.updateNote(createdNoteRef.current.id, { status: 'ready' }).catch((e) => {
          logSilentError('client:Capture.destravarNota', e)
        })
      }
      // Com a nota ja criada, o transcript esta salvo e o "tentar novamente" so refaz a IA --
      // dizer isso evita o usuario achar que perdeu a gravacao e regravar a reuniao.
      setError(
        aiError(
          err,
          createdNoteRef.current
            ? 'Falha ao gerar o resumo. A transcrição já está salva na nota — toque em "Tentar novamente" para concluir.'
            : 'Falha ao processar. Tente novamente.',
        ),
      )
      setProcessing(false)
      // NAO apaga a gravacao pendente aqui: e o que permite o botao "Tentar novamente" (e,
      // numa proxima visita, o banner de recuperacao) reaproveitar o audio em vez de perde-lo.
    }
  }

  /** Sai do spinner de "processando" sem perder a gravacao: a chamada de rede que ficou
   *  pendurada (rede movel instavel) continua invalidada em segundo plano, e o usuario pode
   *  tentar de novo pelo botao. Resolve o "clico em tentar novamente e fica travado". */
  function cancelProcessing() {
    finalizeAttemptRef.current++ // invalida a tentativa em andamento
    setProcessing(false)
    setError('Processamento interrompido. Sua gravação foi salva — toque em "Tentar novamente".')
  }

  /** Salva no computador o audio guardado no navegador. Serve para a gravacao que nenhum
   *  provedor consegue ler (arquivo danificado) e para quem simplesmente quer o arquivo. */
  async function baixarPendente(key: string, meta: PendingRecordingMeta) {
    const blob = await getPendingRecordingBlob(key)
    if (!blob || !blob.size) {
      setError('O áudio desta gravação não está mais neste navegador.')
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(meta.fallbackTitle || 'gravacao').replace(/[\\/:*?"<>|]/g, '-')}.webm`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  /** Repete a ultima tentativa com o MESMO audio (reaproveita a nota se ela ja foi criada). */
  async function retryFinalize() {
    const opts = lastFinalizeOptsRef.current
    if (opts) await finalize(opts)
  }

  /**
   * A nota que ja nasceu desta gravacao numa tentativa anterior (transcricao salva, IA falhou).
   * Com `noteId` gravado na pendencia e direto. Pendencias de antes dessa correcao nao tem o id:
   * procura uma nota do mesmo usuario criada logo apos o savedAt, com a mesma duracao -- e pega a
   * mais antiga, que e a primeira que nasceu desta gravacao.
   */
  async function findNoteForPending(meta: PendingRecordingMeta): Promise<Note | null> {
    if (!profile) return null
    try {
      if (meta.noteId) {
        const n = await db.getNote(meta.noteId)
        return n && !(n as { deleted_at?: string | null }).deleted_at ? n : null
      }
      const saved = Date.parse(meta.savedAt)
      if (!Number.isFinite(saved)) return null
      const notes = await db.listNotes(profile.id)
      const candidates = notes.filter((n) => {
        const created = Date.parse(n.created_at)
        const within = created >= saved - 60_000 && created <= saved + 20 * 60_000
        const sameDuration = !meta.duration || Math.abs((n.duration_seconds ?? 0) - meta.duration) <= 2
        return within && sameDuration && !!n.transcript?.trim()
      })
      candidates.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      return candidates[0] ?? null
    } catch (err) {
      logSilentError('client:Capture.findNoteForPending', err)
      return null
    }
  }

  /** Retoma uma gravacao que ficou sem processar numa tentativa anterior (sessao/aba antiga). */
  async function resumePending(key: string) {
    const entry = pendingRecordings.find((p) => p.key === key)
    if (!entry) return
    setResumingKey(key)
    const blob = await getPendingRecordingBlob(key)
    if (!blob) {
      // O navegador pode ter limpado o IndexedDB (modo privado, storage cheio etc.): so
      // sobra a entrada "fantasma", que nao tem mais o que recuperar. Avisa em vez de sumir
      // em silencio — o usuario merece saber que o audio se foi.
      await deletePendingRecording(key)
      setPendingRecordings((list) => list.filter((p) => p.key !== key))
      setResumingKey(null)
      setError(
        'O áudio desta gravação não está mais salvo neste aparelho (o navegador limpou o armazenamento local). Não há o que recuperar.',
      )
      return
    }
    const { meta } = entry
    setTitle(meta.title)
    setTemplate(meta.template)
    setContext(meta.context)
    setDiarize(meta.diarize)
    pendingKeyRef.current = key
    // Reaproveita a nota que ja nasceu desta gravacao, se houver. Antes isto era sempre null, e
    // retomar criava uma nota NOVA com a mesma transcricao (tres copias da Larissa em 16/09).
    createdNoteRef.current = await findNoteForPending(meta)
    setResumingKey(null)
    await finalize({
      type: meta.type as NoteSourceType,
      audioBlob: blob,
      duration: meta.duration,
      fallbackTitle: meta.fallbackTitle,
      skipAudioStore: meta.skipAudioStore,
      skipActionItems: meta.skipActionItems,
    })
    setPendingRecordings(listPendingRecordings())
  }

  /** Descarta uma gravacao pendente sem processar (o usuario decide que nao precisa mais dela). */
  async function discardPending(key: string) {
    await deletePendingRecording(key)
    setPendingRecordings((list) => list.filter((p) => p.key !== key))
  }

  async function onStopRecording() {
    const today = new Date().toLocaleDateString('pt-BR')

    if (useNative) {
      try {
        const res = await bgRecorder.stop()
        setNState('idle')
        await finalize({
          type: 'recording',
          audioBlob: res.blob,
          duration: res.durationSeconds,
          fallbackTitle: `Gravação ${today}`,
        })
      } catch {
        setNState('idle')
        setError('Não foi possível finalizar a gravação. Tente novamente.')
      }
      return
    }

    const res = await recorder.stop()
    await finalize({
      type: 'recording',
      audioBlob: res.blob,
      duration: res.durationSeconds,
      fallbackTitle: mode === 'meeting' ? `Reunião ${today}` : `Gravação ${today}`,
    })
  }

  async function startMeeting() {
    autoStoppedRef.current = false
    await recorder.start({ system: true })
  }

  /** Anexa o audio da reuniao com a gravacao ja em andamento (ou troca a aba compartilhada). */
  async function onAddSystemAudio() {
    await recorder.addSystemAudio()
  }

  /**
   * Usado pelos modos "Enviar audio" E "Enviar video": decide pelo ARQUIVO, nao pelo botao.
   * Motivo (2026-09-02): .m4a no Windows chega com File.type VAZIO (MIME nao registrado no
   * sistema) e a checagem antiga `type.startsWith('audio/')` barrava audio valido nos dois
   * modos. isAudioFile/isVideoFile caem para a extensao quando o MIME falta — e quem escolhe
   * um audio no modo video (ou um video no modo audio) e atendido em vez de ver erro.
   */
  async function processPickedMedia(file: File) {
    setError(null)
    if (isAudioFile(file)) {
      await finalize({
        type: 'upload',
        audioBlob: file,
        duration: 0,
        fallbackTitle: file.name.replace(/\.[^.]+$/, ''),
      })
      return
    }
    if (isVideoFile(file)) {
      if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
        setError(`Vídeo muito grande. Limite de ${MAX_VIDEO_MB} MB (a IA extrai apenas o áudio).`)
        return
      }
      // Envia o video: o provedor extrai o audio para transcrever. O video NAO e armazenado.
      await finalize({
        type: 'video',
        audioBlob: file,
        duration: 0,
        fallbackTitle: file.name.replace(/\.[^.]+$/, ''),
        skipAudioStore: true,
      })
      return
    }
    setError('Formato não reconhecido. Envie áudio (MP3, M4A, WAV, OGG, WEBM) ou vídeo (MP4, MOV, MKV).')
  }

  async function onUploadAudio(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await processPickedMedia(file)
  }

  async function onUploadVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await processPickedMedia(file)
  }

  // Apenas CARREGA o arquivo (nao processa). O processamento so ocorre ao clicar em "Processar".
  async function onFileText(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setFileName(file.name)
    setSelectedFile(file)
    const isText = /\.(txt|md|csv)$/i.test(file.name)
    setTextInput(isText ? await file.text() : '')
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (!isSupportedImage(file)) {
      setError('Formato não suportado. Envie PNG, JPG, WEBP ou GIF.')
      return
    }
    setFileName(file.name)
    setSelectedFile(file)
  }

  /** Le a imagem com a IA de visao (transcreve texto fotografado e resume). */
  async function onSubmitImage() {
    if (!selectedFile) {
      setError('Selecione uma imagem.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const prepared = await prepareImage(selectedFile)
      const summary = await summarizeImage(prepared, { maxWords: imageWords, context })
      setSubmitting(false)
      // A visao ja devolveu o texto e o resumo: nao ha por que pagar outra chamada.
      await finalize({
        type: 'image',
        transcript: summary,
        summary,
        skipActionItems: true,
        fallbackTitle: fileName?.replace(/\.[^.]+$/, '') || 'Resumo de imagem',
      })
    } catch (err) {
      setSubmitting(false)
      setError(aiError(err, err instanceof Error ? err.message : 'Não consegui ler esta imagem.'))
    }
  }

  async function onSubmitText() {
    setError(null)
    let content = textInput.trim()
    if (mode === 'link') {
      if (!/^https?:\/\//i.test(content)) {
        setError('Informe uma URL valida (comecando com http:// ou https://).')
        return
      }
    } else if (!content && !selectedFile) {
      setError('Selecione um arquivo ou cole um texto para continuar.')
      return
    }

    // Extracao real (link no servidor; PDF/DOCX no navegador).
    setSubmitting(true)
    try {
      if (mode === 'link') {
        content = await extractLink(content)
      } else if (!content && selectedFile) {
        content = await extractFile(selectedFile)
      }
    } catch (err) {
      setSubmitting(false)
      // FileError ja carrega um texto pronto para o usuario; o resto vira mensagem generica.
      setError(
        err instanceof FileError
          ? err.message
          : 'Não consegui extrair o conteúdo deste arquivo. Verifique o formato e tente de novo.',
      )
      return
    }
    setSubmitting(false)

    if (!content.trim()) {
      setError('Não consegui extrair texto deste conteúdo.')
      return
    }

    await finalize({
      type: mode === 'link' ? 'link' : 'file',
      transcript: content,
      fallbackTitle:
        mode === 'link'
          ? 'Resumo do link'
          : fileName?.replace(/\.[^.]+$/, '') || 'Nota de texto',
    })
  }

  if (processing) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-8 text-center safe-top">
        <div className="relative mb-8">
          <div className="absolute inset-0 rounded-full bg-accent/30 animate-pulse-ring" />
          <div className="grid place-items-center h-20 w-20 rounded-full bg-brand-solid text-white relative">
            <Spinner size={28} />
          </div>
        </div>
        <h2 className="font-display text-xl font-bold">{STEPS[step]}...</h2>
        <p className="text-content-secondary mt-2 max-w-xs">
          {stepNote ?? 'A IA está processando sua nota. Isso leva apenas alguns segundos.'}
        </p>
        <div className="flex gap-1.5 mt-6">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-8 rounded-full ${i <= step ? 'bg-brand-solid' : 'bg-surface-border'}`}
            />
          ))}
        </div>
        {showCancel && (
          <div className="mt-8">
            <p className="text-sm text-content-muted mb-3">Está demorando mais que o normal?</p>
            <button className="btn-outline h-9 px-4 text-sm" onClick={cancelProcessing}>
              Cancelar
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col px-5 safe-top safe-bottom-2">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-xl font-bold">
          {mode === 'record' && 'Gravar áudio'}
          {mode === 'meeting' && 'Gravar reunião no PC'}
          {mode === 'upload' && 'Enviar áudio'}
          {mode === 'video' && 'Enviar vídeo'}
          {mode === 'file' && 'PDF, arquivo ou texto'}
          {mode === 'image' && 'Resumir imagem'}
          {mode === 'link' && 'Link da web'}
        </h1>
      </header>

      {/* Gravacoes de uma tentativa ANTERIOR que falharam antes de virar nota (rede caiu,
          sessao expirou etc.). O audio ficou salvo neste navegador; nada foi perdido.
          Sem filtro por modo: um filtro `meta.mode === mode` escondia a gravacao de reuniao
          de quem abria a tela no modo microfone — parecia perdida sem estar. */}
      {!recActive &&
        pendingRecordings
          .map(({ key, meta }) => (
            <div key={key} className="card p-4 mb-4 border-accent/40">
              <p className="text-sm font-medium">Gravação não processada encontrada</p>
              <p className="text-xs text-content-muted mt-1">
                {meta.fallbackTitle} · {new Date(meta.savedAt).toLocaleString('pt-BR')}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  className="btn-primary h-9 px-3 text-sm"
                  onClick={() => resumePending(key)}
                  disabled={resumingKey === key}
                >
                  {resumingKey === key ? <Spinner size={14} /> : 'Retomar'}
                </button>
                <button
                  className="btn-outline h-9 px-3 text-sm"
                  onClick={() => baixarPendente(key, meta)}
                  disabled={resumingKey === key}
                >
                  Baixar áudio
                </button>
                <button
                  className="btn-outline h-9 px-3 text-sm"
                  onClick={() => discardPending(key)}
                  disabled={resumingKey === key}
                >
                  Descartar
                </button>
              </div>
            </div>
          ))}

      {mode !== 'link' && !meetingBlocked && !recActive && (
        <div className="mb-4">
          <label className="label">Título (opcional)</label>
          <input
            className="input"
            placeholder="Ex: Conversa com Cliente X"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      )}

      {(mode === 'record' || mode === 'meeting' || mode === 'upload') && !meetingBlocked && !recActive && (
        <div className="mb-4">
          <label className="label">{mode === 'upload' ? 'Tema do áudio (opcional)' : 'Tema (opcional)'}</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  template === t.id
                    ? 'bg-brand-solid border-brand-solid text-white'
                    : 'bg-surface-elevated border-surface-border text-content-secondary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-content-muted">
            {TEMPLATES.find((t) => t.id === template)?.hint}
          </p>
        </div>
      )}

      {!meetingBlocked && !recActive && (
        <div className="mb-3">
          <label className="label">Contexto (opcional)</label>
          <input
            className="input"
            placeholder="Ex: cliente X, renovação de contrato"
            value={context}
            onChange={(e) => setContext(e.target.value)}
          />
        </div>
      )}

      {!meetingBlocked && !recActive && (
        <p className="text-xs text-content-muted mb-6">
          Todos os campos acima são <span className="text-content-secondary font-medium">opcionais</span>. Sem
          eles, a IA gera a transcrição e o resumo normalmente.
        </p>
      )}

      {(mode === 'record' || mode === 'meeting' || mode === 'upload') && !meetingBlocked && !recActive && (
        <button
          type="button"
          onClick={() => setDiarize((v) => !v)}
          className="w-full flex items-center gap-3 card px-4 py-3 mb-6 text-left"
        >
          <span
            className={`h-6 w-11 rounded-full transition-colors relative shrink-0 ${diarize ? 'bg-brand-solid' : 'bg-surface-border'}`}
          >
            <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${diarize ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </span>
          <span className="min-w-0">
            <span className="block font-medium text-sm">Identificar quem falou</span>
            <span className="block text-xs text-content-muted">
              Separa as falas de cada pessoa (Falante A, Falante B...). Se alguém se apresentar ou for chamado pelo nome e responder, o nome entra no lugar. Leva um pouco mais de tempo.
            </span>
          </span>
        </button>
      )}

      {error && (
        <div className="alert-error mb-4">
          <p>{error}</p>
          {/* So aparece quando ha uma gravacao/arquivo salvo para reaproveitar: falhas antes
              disso (ex.: arquivo invalido) nao tem o que "tentar de novo". */}
          {lastFinalizeOptsRef.current && (
            <div className="flex gap-2 mt-3">
              {silentDetected && (
                <button
                  className="btn-primary h-9 px-3 text-sm"
                  onClick={() => {
                    const opts = lastFinalizeOptsRef.current
                    if (opts) void finalize({ ...opts, ignoreSilence: true })
                  }}
                >
                  Transcrever mesmo assim
                </button>
              )}
              <button
                className="btn-outline h-9 px-3 text-sm"
                onClick={retryFinalize}
                disabled={cooldownLeft > 0}
              >
                {cooldownLeft > 0 ? `Tentar novamente em ${formatWait(cooldownLeft)}` : 'Tentar novamente'}
              </button>
            </div>
          )}
          {cooldownLeft > 0 && activeCooldown()?.adminOnly && (
            <p className="text-xs text-content-muted mt-2">
              Não precisa insistir: sua gravação está salva e você pode concluir assim que o problema for resolvido.
            </p>
          )}
        </div>
      )}

      {isAudioMode && (
        <div className="flex-1 flex flex-col items-center justify-center pb-24">
          {mode === 'meeting' && recorder.state === 'idle' && !recorder.error ? (
            !canCaptureSystemAudio() ? (
              <div className="card p-6 text-center max-w-sm">
                <MonitorSmartphone size={36} className="text-accent mx-auto mb-3" />
                <h3 className="font-display font-semibold text-lg">Disponível apenas no computador</h3>
                <p className="text-content-secondary mt-2 text-sm">
                  Gravar o <span className="text-content-primary font-medium">Meet</span> (e Zoom/Teams) captura o
                  {' '}<span className="text-content-primary font-medium">áudio da reunião + seu microfone</span> juntos.
                  Nenhum celular permite isso: o sistema não deixa um aplicativo capturar o áudio de outro.
                  Use o <span className="text-content-primary font-medium">navegador do computador</span> (Chrome ou Edge).
                </p>
                <button className="btn-outline mt-5 mx-auto" onClick={() => navigate('/capturar?mode=record')}>
                  <Mic size={18} /> Gravar só pelo microfone
                </button>
              </div>
            ) : (
              <div className="card p-6 max-w-md">
                <Headphones size={32} className="text-accent mb-3" />
                <h3 className="font-display font-semibold text-lg">Gravar reunião ou chamada no computador</h3>
                <p className="text-content-secondary text-sm mt-2">
                  Funciona com <span className="text-content-primary font-medium">Meet, WhatsApp, Zoom, Teams</span> ou
                  qualquer app — mesmo de fone.
                </p>
                {isElectron() ? (
                  <ol className="text-content-secondary text-sm mt-3 space-y-2 list-decimal list-inside">
                    <li>Abra a reunião ou chamada no computador — o som dela precisa sair pelo PC (fone ou caixa de som).</li>
                    <li>
                      Clique em <span className="text-content-primary font-medium">Iniciar</span>: o ANA grava o som do
                      computador e o seu microfone juntos, sem precisar escolher tela.
                    </li>
                    <li>Quando a reunião terminar, encerre por aqui para gerar a transcrição e o resumo.</li>
                  </ol>
                ) : (
                <ol className="text-content-secondary text-sm mt-3 space-y-2 list-decimal list-inside">
                  <li>Abra a reunião ou chamada que você quer gravar.</li>
                  <li>Clique em "Iniciar" abaixo e escolha o que compartilhar:</li>
                  <li className="list-none -mt-1 ml-5 space-y-1">
                    <div>
                      • No <span className="text-content-primary font-medium">navegador</span> (Meet, WhatsApp Web…):
                      escolha a <span className="text-content-primary font-medium">aba</span> da reunião.
                    </div>
                    <div>
                      • App <span className="text-content-primary font-medium">instalado no PC</span> (WhatsApp, Zoom
                      ou Teams do Windows): escolha a <span className="text-content-primary font-medium">tela inteira</span>.
                    </div>
                  </li>
                  <li>
                    <span className="text-content-primary font-medium">Marque "Compartilhar áudio"</span> no diálogo
                    do navegador (na tela inteira, o "áudio do sistema").
                  </li>
                </ol>
                )}

                {/* Navegadores suportados: so Chromium entrega o audio da aba. */}
                {isElectron() ? null : supportsTabAudio() ? (
                  <p className="text-xs text-content-muted mt-3 flex items-start gap-1.5">
                    <Info size={13} className="shrink-0 mt-0.5" />
                    <span>
                      Funciona no <span className="text-content-secondary font-medium">Chrome, Edge, Opera e Brave</span>.
                      No <span className="text-content-secondary font-medium">Safari</span> e no{' '}
                      <span className="text-content-secondary font-medium">Firefox</span> o navegador não entrega o áudio
                      da aba — a gravação sairia só com o seu microfone.
                    </span>
                  </p>
                ) : (
                  <div className="alert-error text-xs mt-3">
                    Seu navegador não entrega o áudio da aba. Abra o ANA no{' '}
                    <span className="font-medium">Chrome</span> ou no <span className="font-medium">Edge</span> para
                    gravar a reunião — aqui a gravação sairia só com o seu microfone.
                  </div>
                )}

                <p className="text-xs text-content-muted mt-3">
                  Gravamos o áudio da reunião + seu microfone juntos. Nada de vídeo é enviado.
                </p>
                <button
                  className="btn-primary w-full mt-5"
                  onClick={() => withConsent(startMeeting)}
                  disabled={!supportsTabAudio()}
                >
                  <Headphones size={18} /> Iniciar gravação da reunião
                </button>
              </div>
            )
          ) : mode === 'record' && recState === 'idle' && !recorder.error ? (
            <div className="card p-6 text-center max-w-sm">
              <div className="grid place-items-center h-16 w-16 rounded-full bg-brand-solid text-white mx-auto mb-4">
                <Mic size={30} />
              </div>
              <h3 className="font-display font-semibold text-lg">Pronto para gravar</h3>
              <p className="text-content-secondary mt-2 text-sm">
                Preencha título, tema e contexto acima (opcionais) e inicie quando quiser.
              </p>
              {useNative && (
                <p className="text-xs text-accent mt-2">
                  A gravação continua mesmo com a tela apagada.
                </p>
              )}
              {/* Navegador/PWA no celular (iPhone em especial): o sistema tira o microfone de
                  quem esta em segundo plano. Nao e limitacao nossa e nao tem como contornar --
                  o que da pra fazer e avisar antes e segurar a tela acesa. */}
              {!useNative && isMobileBrowser() && (
                <p className="text-xs text-accent mt-2">
                  Mantenha o ANA aberto e a tela ligada até encerrar: o celular tira o microfone de apps em
                  segundo plano (tela bloqueada, câmera, outro app).
                  {canKeepScreenAwake() ? ' A tela fica acesa sozinha enquanto grava.' : ''}
                </p>
              )}
              <button className="btn-primary w-full mt-5" onClick={() => withConsent(startRecord)}>
                <Mic size={18} /> Iniciar gravação
              </button>
            </div>
          ) : recorder.error ? (
            <div className="text-center max-w-sm">
              <p className="text-accent mb-4">{recorder.error}</p>
              <button className="btn-primary mx-auto" onClick={() => withConsent(mode === 'meeting' ? startMeeting : startRecord)}>
                Tentar novamente
              </button>
            </div>
          ) : (
            <>
              {/* Pausar a esquerda do botao de gravacao, encerrar a direita. */}
              <div className="flex items-center justify-center gap-6 mb-8">
                <button
                  onClick={togglePause}
                  className="btn-ghost h-14 w-14 rounded-full p-0 shrink-0"
                  aria-label={recState === 'recording' ? 'Pausar' : 'Retomar'}
                >
                  {recState === 'recording' ? <Pause size={22} /> : <Play size={22} />}
                </button>

                <div className="relative shrink-0">
                  <div
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-accent/25 pointer-events-none"
                    style={{ transform: `scale(${1 + recLevel * 0.35})`, transition: 'transform 80ms' }}
                  />
                  <div className="grid place-items-center h-28 w-28 rounded-full bg-brand-solid text-white relative">
                    {mode === 'meeting' ? <Headphones size={40} /> : <Mic size={40} />}
                  </div>
                </div>

                <button
                  onClick={onStopRecording}
                  className="btn-primary h-14 w-14 rounded-full p-0 shrink-0"
                  aria-label="Encerrar e processar"
                >
                  <Square size={24} />
                </button>
              </div>
              <p className="font-display text-4xl font-bold tabular-nums mb-2">{fmtClock(recSeconds)}</p>
              <p className="text-content-muted mb-1">
                {recState === 'paused'
                  ? 'Pausado'
                  : mode === 'meeting'
                    ? recorder.systemAudioMissing
                      ? 'Gravando só o seu microfone...'
                      : isElectron()
                        ? 'Gravando reunião (som do PC + microfone)...'
                        : 'Gravando reunião (aba + microfone)...'
                    : 'Gravando...'}
              </p>
              {(() => {
                const remaining = config.recordingMaxSeconds - recSeconds
                const low = remaining <= 300
                return (
                  <p className={`mb-4 text-sm ${low ? 'text-accent font-medium' : 'text-content-muted'}`}>
                    Limite de 2 horas • restam {fmtDuration(Math.max(0, remaining))}
                  </p>
                )
              })()}

              {/* A gravacao NAO para por causa disto: ela continua com o microfone enquanto o
                  usuario decide. Anexar o audio da reuniao no meio do caminho e possivel. */}
              {recorder.noAudioData && (
                <div className="alert-error text-sm mt-3 max-w-sm text-left">
                  <p>
                    <span className="font-medium">Esta gravação não está capturando áudio.</span> Há mais de 20
                    segundos nenhum som chega ao gravador — o que já foi gravado fica guardado, mas daqui em diante
                    o arquivo sai sem som. Encerre e comece uma gravação nova; se persistir, reinicie o aplicativo.
                  </p>
                </div>
              )}

              {recorder.micLost && (
                <div className="alert-error text-sm mt-3 max-w-sm text-left">
                  {isMobileBrowser() ? (
                    <p>
                      <span className="font-medium">Perdemos seu microfone.</span> O celular tirou o microfone do
                      ANA (tela bloqueada, câmera ou outro app usando o som). Volte para o ANA e mantenha a tela
                      ligada — reconectamos sozinhos assim que o sistema devolver o microfone. Até lá, a sua voz
                      não está entrando.
                    </p>
                  ) : (
                    <p>
                      <span className="font-medium">Perdemos seu microfone.</span> Algum aplicativo ou o próprio
                      Windows mudou o dispositivo de entrada e não conseguimos reabrir outro. A gravação continua
                      {mode === 'meeting' ? ' captando o áudio da reunião' : ''}, mas a sua voz não está entrando.
                      Confira o microfone nas configurações de som.
                    </p>
                  )}
                </div>
              )}

              {mode === 'meeting' && recorder.systemAudioMissing && <SystemAudioHelp kind="missing" onRetry={onAddSystemAudio} />}
              {mode === 'meeting' && !recorder.systemAudioMissing && recorder.systemSilent && (
                <SystemAudioHelp kind="silent" onRetry={onAddSystemAudio} />
              )}

              <p className="text-xs text-content-muted mt-2 max-w-xs text-center">
                {mode === 'meeting'
                  ? isElectron()
                    ? 'Deixe o ANA aberto até o fim da reunião e encerre por aqui.'
                    : 'Mantenha a aba da reunião aberta. Encerrar aqui ou "Parar compartilhamento" finaliza a gravação.'
                  : isMobileBrowser()
                    ? 'Mantenha o ANA aberto e a tela ligada até encerrar. Em ligações, use o viva-voz para captar as duas vozes.'
                    : 'Dica: em reuniões por telefone, use o viva-voz para captar melhor as duas vozes.'}
              </p>
              <RecordingNotice />
            </>
          )}
        </div>
      )}

      {mode === 'upload' && (
        <div className="flex-1 flex flex-col items-center justify-center pb-24">
          <button
            onClick={() => fileRef.current?.click()}
            className="card w-full max-w-sm py-12 flex flex-col items-center gap-3 border-dashed hover:border-accent/50"
          >
            <Upload size={36} className="text-accent" />
            <p className="font-medium">Selecionar arquivo de áudio</p>
            <p className="text-sm text-content-muted">MP3, M4A, WAV, OGG, WEBM • até 60 MB e 2 h</p>
          </button>
          <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={onUploadAudio} />
        </div>
      )}

      {mode === 'video' && (
        <div className="flex-1 flex flex-col items-center justify-center pb-24">
          <button
            onClick={() => fileRef.current?.click()}
            className="card w-full max-w-sm py-12 flex flex-col items-center gap-3 border-dashed hover:border-accent/50"
          >
            <Video size={36} className="text-accent" />
            <p className="font-medium">Selecionar vídeo</p>
            <p className="text-sm text-content-muted">MP4, MOV, WEBM • até {MAX_VIDEO_MB} MB</p>
          </button>
          <input ref={fileRef} type="file" accept={VIDEO_ACCEPT} className="hidden" onChange={onUploadVideo} />
          <p className="text-xs text-content-muted mt-4 max-w-xs text-center">
            A IA usa só o som para transcrever. O vídeo não é armazenado.
          </p>
        </div>
      )}

      {mode === 'file' && (
        <div className="flex-1 flex flex-col gap-4 pb-24">
          <button
            onClick={() => fileRef.current?.click()}
            className="card w-full py-10 flex flex-col items-center gap-3 border-dashed hover:border-accent/50"
          >
            <FileText size={32} className="text-accent" />
            <p className="font-medium">{fileName ? 'Trocar arquivo' : 'Selecionar PDF, TXT, DOCX...'}</p>
            {fileName && <p className="text-sm text-content-secondary">{fileName}</p>}
          </button>
          <input ref={fileRef} type="file" accept={TEXT_FILE_ACCEPT} className="hidden" onChange={onFileText} />
          {fileName && (
            <p className="text-xs text-content-muted -mt-1">
              Arquivo selecionado. O texto do PDF/DOCX é extraído ao clicar em "Processar".
            </p>
          )}
          <div className="text-center text-content-muted text-sm">ou cole o texto abaixo</div>
          <AutoTextarea
            minRows={6}
            maxRows={16}
            className="leading-relaxed"
            placeholder="Cole aqui o texto a ser resumido..."
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
          />
          <button className="btn-primary" onClick={onSubmitText} disabled={submitting}>
            {submitting ? <Spinner size={18} /> : null}
            {submitting ? 'Extraindo...' : 'Processar'}
          </button>
        </div>
      )}

      {mode === 'image' && (
        <div className="flex-1 flex flex-col gap-4 pb-24">
          <button
            onClick={() => fileRef.current?.click()}
            className="card w-full py-10 flex flex-col items-center gap-3 border-dashed hover:border-accent/50"
          >
            <ImageIcon size={32} className="text-accent" />
            <p className="font-medium">{fileName ? 'Trocar imagem' : 'Selecionar imagem'}</p>
            <p className="text-sm text-content-muted">PNG, JPG, WEBP, GIF • até {MAX_IMAGE_MB} MB</p>
            {fileName && <p className="text-sm text-content-secondary truncate max-w-full px-4">{fileName}</p>}
          </button>
          <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={onPickImage} />

          <div>
            <label className="label">Tamanho do resumo</label>
            <div className="flex flex-wrap gap-2">
              {[
                { w: 80, label: 'Curto' },
                { w: 150, label: 'Médio' },
                { w: 300, label: 'Longo' },
              ].map((o) => (
                <button
                  key={o.w}
                  type="button"
                  onClick={() => setImageWords(o.w)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    imageWords === o.w
                      ? 'bg-brand-solid border-brand-solid text-white'
                      : 'bg-surface-elevated border-surface-border text-content-secondary'
                  }`}
                >
                  {o.label} • {o.w} palavras
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-content-muted flex items-start gap-1.5">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>
              Se a imagem tiver texto (documento, print, foto de página), a IA transcreve o texto e depois
              resume. A imagem não é armazenada.
            </span>
          </p>

          <button className="btn-primary" onClick={onSubmitImage} disabled={submitting || !selectedFile}>
            {submitting ? <Spinner size={18} /> : null}
            {submitting ? 'Lendo imagem...' : 'Resumir imagem'}
          </button>
        </div>
      )}

      {mode === 'link' && (
        <div className="flex-1 flex flex-col gap-4 pb-24">
          <div className="relative">
            <Link2 size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              className="input pl-11"
              placeholder="https://..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={onSubmitText} disabled={submitting}>
            {submitting ? <Spinner size={18} /> : null}
            {submitting ? 'Extraindo...' : 'Resumir link'}
          </button>
          <p className="text-xs text-content-muted">
            A IA abre a página, extrai o conteúdo principal e gera o resumo.
          </p>
        </div>
      )}

      <ConsentSheet
        open={consentOpen}
        onAccept={acceptConsent}
        onClose={() => {
          pendingStartRef.current = null
          setConsentOpen(false)
        }}
      />
    </div>
  )
}
