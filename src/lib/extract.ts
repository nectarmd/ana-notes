// Extracao de conteudo para o modo "arquivo" (PDF/DOCX/TXT) e "link".
// PDF/DOCX sao extraidos no NAVEGADOR (pdfjs/mammoth, carregados sob demanda).
// Link e extraido no SERVIDOR (edge function extract-link) para evitar CORS.

import { config } from './config'
import { supabase } from './supabase'
import { describeUnknownError } from './errorMessage'
import { isAudioFile, isVideoFile } from './mediaKind'

export const TEXT_FILE_ACCEPT = '.pdf,.txt,.md,.csv,.docx'
const TEXT_EXTS = ['pdf', 'docx', 'txt', 'md', 'csv']

const extOf = (name: string) => name.toLowerCase().split('.').pop() ?? ''

/** Erro de arquivo que a UI mostra tal e qual (ja escrito para o usuario). */
export class FileError extends Error {}

/** Extrai o texto de um PDF no navegador. */
export async function extractPdf(file: File): Promise<string> {
  let out = ''
  try {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const data = new Uint8Array(await file.arrayBuffer())
    const doc = await pdfjs.getDocument({ data }).promise
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const items = Array.isArray(content?.items) ? content.items : []
      out += items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
    }
  } catch (err) {
    // A mensagem crua do pdfjs ("undefined is not a function...") nao ajuda ninguem.
    const msg = describeUnknownError(err)
    if (/password/i.test(msg)) throw new FileError('Este PDF esta protegido por senha.')
    if (/invalid|corrupt|structure/i.test(msg)) throw new FileError('Este PDF parece estar corrompido.')
    throw new FileError('Não consegui ler este PDF. Se ele for digitalizado, use "Resumir imagem".')
  }

  const text = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length < 20) {
    // PDF de texto-em-imagem (escaneado/fotografado): nao ha camada de texto para extrair.
    throw new FileError(
      'Este PDF não tem texto selecionável — parece ser digitalizado (imagem). ' +
        'Envie a página como imagem em "Resumir imagem" para a IA ler o conteúdo.',
    )
  }
  return text
}

/** Extrai o texto de um DOCX no navegador. */
export async function extractDocx(file: File): Promise<string> {
  try {
    const mammoth = await import('mammoth')
    const arrayBuffer = await file.arrayBuffer()
    const res = await mammoth.extractRawText({ arrayBuffer })
    const text = (res.value || '').trim()
    if (!text) throw new FileError('Este DOCX não tem texto para extrair.')
    return text
  } catch (err) {
    if (err instanceof FileError) throw err
    throw new FileError('Não consegui ler este DOCX. Salve novamente como .docx ou PDF.')
  }
}

/**
 * Valida e extrai o texto de um arquivo. Rejeita tipos errados com mensagem util
 * em vez de tentar ler bytes binarios como texto.
 */
export async function extractFile(file: File): Promise<string> {
  const ext = extOf(file.name)

  if (file.type.startsWith('image/')) {
    throw new FileError('Isto é uma imagem. Use a opção "Resumir imagem" para a IA ler o conteúdo.')
  }
  // isAudioFile/isVideoFile: .m4a (e afins) chega sem MIME no Windows -- so File.type
  // deixava o audio cair no erro generico de "formato nao suportado".
  if (isAudioFile(file)) {
    throw new FileError('Isto é um áudio. Use "Enviar áudio" para transcrever.')
  }
  if (isVideoFile(file)) {
    throw new FileError('Isto é um vídeo. Use "Enviar vídeo" para transcrever.')
  }
  if (ext === 'doc') {
    throw new FileError('Formato .doc antigo não suportado — salve como .docx ou PDF.')
  }
  if (!TEXT_EXTS.includes(ext)) {
    throw new FileError(`Formato .${ext || '?'} não suportado. Envie PDF, DOCX, TXT, MD ou CSV.`)
  }

  if (ext === 'pdf') return extractPdf(file)
  if (ext === 'docx') return extractDocx(file)

  const text = (await file.text()).trim()
  if (!text) throw new FileError('O arquivo esta vazio.')
  return text
}

/** Extrai o texto principal de uma pagina web (via edge function, sem CORS). */
export async function extractLink(url: string): Promise<string> {
  if (config.mockMode || !supabase) {
    return `Conteúdo do link: ${url}\n\n(A extração real do conteúdo requer o backend configurado.)`
  }
  const { data, error } = await supabase.functions.invoke('extract-link', { body: { url } })
  if (error) throw new FileError(error.message || 'Falha ao extrair o link.')
  const d = data as { text?: string; error?: string }
  if (d.error) throw new FileError(d.error)
  const text = (d.text || '').trim()
  if (!text) throw new FileError('Não consegui extrair texto desta página.')
  return text
}
