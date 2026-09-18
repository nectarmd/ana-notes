// Empacota o ANA para a Microsoft Store (.appx) -- NAO para o site.
//
// Por que um script em vez de deixar tudo no package.json: os tres valores de identidade sao
// atribuidos pelo Partner Center e precisam bater LETRA POR LETRA com o que esta la (a Microsoft
// recusa o envio se diferir em um espaco). Deixa-los no repositorio como texto convida a errar
// silenciosamente -- aqui eles vem do ambiente, como a keystore do Android, e a build para com
// uma mensagem clara quando falta algum.
//
// Onde achar cada um: Partner Center > seu app > Gerenciamento de produto > Identidade do app.
//
// Uso (PowerShell):
//   $env:STORE_IDENTITY_NAME = "..."; $env:STORE_PUBLISHER = "CN=..."
//   $env:STORE_PUBLISHER_DISPLAY_NAME = "..."; npm run dist:store
//
// O pacote sai SEM assinatura, e e assim que tem que ser: a Loja re-assina com o certificado
// da Microsoft depois da certificacao. Nao compre certificado para este caminho.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const CAMPOS = [
  ['STORE_IDENTITY_NAME', 'appx.identityName', 'Nome do pacote (ex.: 12345TailorExec.ANAbyTailor)'],
  ['STORE_PUBLISHER', 'appx.publisher', 'Publicador, comecando com CN= (ex.: CN=A1B2C3D4-...)'],
  ['STORE_PUBLISHER_DISPLAY_NAME', 'appx.publisherDisplayName', 'Nome de exibicao do publicador'],
]

const faltando = CAMPOS.filter(([env]) => !process.env[env]?.trim())
if (faltando.length) {
  console.error('\nFalta a identidade do Partner Center para empacotar para a Loja.\n')
  console.error('Pegue em: Partner Center > seu app > Gerenciamento de produto > Identidade do app')
  console.error('e defina no terminal antes de rodar de novo:\n')
  for (const [env, , oque] of faltando) console.error(`  ${env}  -> ${oque}`)
  console.error('')
  process.exit(1)
}

// Os logotipos sao versionados; so regera se o icone mudou (npm run store:assets).
const args = [
  require.resolve('electron-builder/cli.js'),
  '--win',
  'appx',
  ...CAMPOS.map(([env, chave]) => `--config.${chave}=${process.env[env].trim()}`),
]

console.log('Empacotando para a Microsoft Store (.appx, sem assinatura -- a Loja assina)...\n')
const r = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  cwd: fileURLToPath(new URL('..', import.meta.url)),
})
process.exit(r.status ?? 1)
