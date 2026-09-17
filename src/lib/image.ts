// Preparo de imagens para a IA de visao.

/** Formatos que o modelo aceita. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif'

/** Limite do arquivo escolhido (antes do redimensionamento). */
export const MAX_IMAGE_MB = 10

/**
 * A Anthropic recomenda o lado maior <= 1568px: acima disso a imagem e reduzida do lado
 * deles sem ganho de qualidade, e a gente pagaria tokens a mais por nada.
 */
const MAX_EDGE = 1568

export const isSupportedImage = (file: File) =>
  (IMAGE_TYPES as readonly string[]).includes(file.type)

export interface PreparedImage {
  media_type: string
  data: string // base64 sem o prefixo data:
  width: number
  height: number
}

function readAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não consegui abrir a imagem.'))
    }
    img.src = url
  })
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('Não consegui ler a imagem.'))
    r.readAsDataURL(blob)
  })

/** Redimensiona (se preciso) e devolve base64 pronto para a edge function. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!isSupportedImage(file)) {
    throw new Error('Formato não suportado. Use PNG, JPG, WEBP ou GIF.')
  }
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
    throw new Error(`Imagem muito grande. Limite de ${MAX_IMAGE_MB} MB.`)
  }

  const img = await readAsImage(file)
  const longest = Math.max(img.naturalWidth, img.naturalHeight)

  // GIF animado perde a animacao no canvas; como so precisamos do 1o quadro, tudo bem.
  if (longest <= MAX_EDGE && file.type !== 'image/gif') {
    return {
      media_type: file.type,
      data: await toBase64(file),
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
  }

  const scale = Math.min(1, MAX_EDGE / longest)
  const width = Math.round(img.naturalWidth * scale)
  const height = Math.round(img.naturalHeight * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não consegui processar a imagem.')
  ctx.drawImage(img, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
  if (!blob) throw new Error('Não consegui processar a imagem.')

  return { media_type: 'image/jpeg', data: await toBase64(blob), width, height }
}
