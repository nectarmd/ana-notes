// Empacota o ANA para a Microsoft Store (.appx) -- NAO para o site.
//
// A identidade do pacote (identityName, publisher, publisherDisplayName) e atribuida pelo Partner
// Center e precisa bater LETRA POR LETRA com o que esta la: a Microsoft recusa o envio se diferir
// em um espaco. Ela fica em package.json > build.appx (preenchida em 22/09/2026 com os valores de
// Partner Center > ANA Notes > Product management > Product identity). Nao e segredo: vai dentro
// de todo pacote publicado. As variaveis STORE_IDENTITY_NAME, STORE_PUBLISHER e
// STORE_PUBLISHER_DISPLAY_NAME, se definidas, passam por cima -- util para testar sem mexer no
// arquivo.
//
// Tambem confere a versao: a Loja recusa pacote cujo PRIMEIRO numero seja 0 (por isso o ANA foi
// para 1.0.0 ao estrear na Loja).
//
// O pacote sai SEM assinatura, e e assim que tem que ser: a Loja re-assina com o certificado da
// Microsoft depois da certificacao. Nao compre certificado para este caminho.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const appx = pkg.build?.appx ?? {}

const CAMPOS = [
  ['STORE_IDENTITY_NAME', 'identityName', 'Package/Identity/Name'],
  ['STORE_PUBLISHER', 'publisher', 'Package/Identity/Publisher (comeca com CN=)'],
  ['STORE_PUBLISHER_DISPLAY_NAME', 'publisherDisplayName', 'Package/Properties/PublisherDisplayName'],
]

const valores = CAMPOS.map(([env, chave, onde]) => ({
  chave,
  onde,
  valor: (process.env[env] ?? appx[chave] ?? '').trim(),
}))

const faltando = valores.filter((v) => !v.valor)
if (faltando.length) {
  console.error('\nFalta a identidade do Partner Center para empacotar para a Loja.\n')
  console.error('Pegue em: Partner Center > seu app > Product management > Product identity')
  console.error('e preencha em package.json > build.appx:\n')
  for (const v of faltando) console.error(`  ${v.chave}  <-  ${v.onde}`)
  console.error('')
  process.exit(1)
}

if (String(pkg.version).split('.')[0] === '0') {
  console.error(`\nA Loja nao aceita versao comecando com 0 (package.json esta em ${pkg.version}).\n`)
  process.exit(1)
}

// Passa os valores explicitamente: se vieram do ambiente, e isso que vale no pacote.
const args = [
  require.resolve('electron-builder/cli.js'),
  '--win',
  'appx',
  ...valores.map((v) => `--config.appx.${v.chave}=${v.valor}`),
]

console.log(`Empacotando ${appx.displayName ?? pkg.name} ${pkg.version} para a Microsoft Store`)
console.log('(.appx sem assinatura -- a Loja assina)\n')
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: root })
process.exit(r.status ?? 1)
