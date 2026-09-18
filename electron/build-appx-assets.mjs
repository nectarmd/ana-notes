// Gera os logotipos que o pacote da Microsoft Store exige (build/appx/), a partir do mesmo
// icone-fonte do resto do app (assets/icon.png, 1024x1024).
//
// Sem esta pasta o electron-builder empacota os icones de EXEMPLO dele -- o app apareceria na
// Loja e no menu Iniciar com a logo generica do electron-builder.
//
// Roda sozinho dentro do `npm run dist:store`, porque build/ nao e versionado neste projeto
// (mesma regra do build/icon.ico). Da pra rodar solto com `npm run store:assets`.

import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const src = fileURLToPath(new URL('../assets/icon.png', import.meta.url))
const outDir = fileURLToPath(new URL('../build/appx/', import.meta.url))

// Cor do proprio canto do icone: o que sobra em volta da logo (ladrilho largo do menu Iniciar)
// some no fundo em vez de virar uma moldura clara.
const BG = { r: 9, g: 9, b: 12, alpha: 1 }

/** Ladrilho quadrado: a logo ocupa o quadro inteiro (o icone ja e um quadrado cheio). */
const square = (size) => sharp(src).resize(size, size, { fit: 'cover' }).png()

/** Ladrilho largo: a logo centralizada, com o resto preenchido pela cor de fundo. */
async function wide(w, h) {
  const logo = await sharp(src)
    .resize(Math.round(h * 0.72), Math.round(h * 0.72), { fit: 'cover' })
    .png()
    .toBuffer()
  return sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
}

await mkdir(outDir, { recursive: true })

// Os quatro nomes que o electron-builder procura, mais os dois ladrilhos opcionais que ele
// inclui no manifesto quando existem.
const jobs = [
  ['StoreLogo.png', () => square(50)],
  ['Square44x44Logo.png', () => square(44)],
  ['Square150x150Logo.png', () => square(150)],
  ['SmallTile.png', () => square(71)],
  ['LargeTile.png', () => square(310)],
  ['Wide310x150Logo.png', () => wide(310, 150)],
]

for (const [name, make] of jobs) {
  await (await make()).toFile(outDir + name)
  console.log('  build/appx/' + name)
}
console.log(`${jobs.length} logotipos gerados a partir de assets/icon.png`)
