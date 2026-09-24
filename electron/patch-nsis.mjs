// Deixa o instalador NSIS (electron-builder) mais PACIENTE ao copiar os arquivos do app.
//
// PROBLEMA: numa instalacao limpa, o Windows Defender escaneia o .exe recem-extraido (~125MB, e
// o app NAO e assinado) e o segura por alguns segundos. O template do electron-builder tenta
// copiar 5 vezes (5s) e, se ainda travado, mostra o dialogo "Repetir" ("$(appCannotBeClosed)").
// Como o Defender esta em todo Windows, isso acontece com praticamente todo mundo no meio da
// instalacao manual. (No auto-update e silencioso -- o /SD IDRETRY clica "Repetir" sozinho -- por
// isso la nao aparece.)
//
// SOLUCAO (paliativa, ate assinarmos o instalador): sobe o numero de tentativas de 5 -> 30 (~30s),
// dando tempo do Defender liberar o arquivo ANTES de incomodar o usuario. A extracao ja tem um
// overwrite de ultimo recurso depois disso, entao nunca trava de vez. Roda no predist:win /
// prerelease:win (o CI faz `npm ci` e depois `npm run dist:win`, entao o patch e reaplicado sempre
// sobre o node_modules fresco). Idempotente.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const FILES = [
  'node_modules/app-builder-lib/templates/nsis/include/extractAppPackage.nsh',
  'node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh',
]
const RETRIES = 30

// Segunda correcao (24/09/2026): DESISTIR da copia antiga em vez de prender o usuario.
//
// Esgotadas as tentativas de rodar o desinstalador da versao antiga, o template mostra
// "Repetir/Cancelar" -- e as duas saidas sao becos sem saida:
//   Repetir  -> faz UMA tentativa e mostra o mesmo erro de novo, para sempre;
//   Cancelar -> handleUninstallResult mostra "Falha ao desinstalar..." e da Quit: nada e instalado.
// Quando o desinstalador antigo falha por um motivo PERMANENTE (arquivo travado, copia em
// Arquivos de Programas sem elevacao, registro quebrado), nenhum dos dois caminhos termina a
// atualizacao. Foi o que prendeu uma usuaria na 0.18.15: so saiu desinstalando o ANA na mao.
//
// Agora, apos ~30s tentando, o instalador desiste EM SILENCIO da copia antiga e SEGUE instalando.
// Uma copia velha sobrando no disco e um incomodo (e a faxina do build/installer.nsh ainda tenta
// remove-la); uma atualizacao que nao termina deixa a pessoa presa na parede de atualizacao.
const DESISTIR_DA_COPIA_ANTIGA = [
  'MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt',
  '; ANA: desiste da copia antiga e segue instalando (ver patch-nsis.mjs)\n      ClearErrors\n      StrCpy $R0 0',
]

// O rotulo so era usado pelo "Repetir" do dialogo acima. Deixando-o para tras, o NSIS avisa
// "label not used" -- e o electron-builder trata AVISO COMO ERRO, entao a build inteira falha.
// Virar comentario mantem o fluxo (o codigo abaixo dele continua rodando em sequencia).
const ROTULO_ORFAO = ['  OneMoreAttempt:\n', '  ; OneMoreAttempt: rotulo removido junto com o dialogo (ver acima)\n']

let changed = 0
for (const f of FILES) {
  if (!existsSync(f)) {
    console.warn(`patch-nsis: ${f} nao encontrado (template mudou?) -- pulando`)
    continue
  }
  const before = readFileSync(f, 'utf8')
  // Duas etapas do template travam pelo MESMO motivo (Defender segurando o .exe), mas cada uma
  // tem seu proprio laco -- e so a primeira estava sendo corrigida:
  //
  //  1. EXTRACAO (`$R1 < 5`): o MessageBox e /SD IDRETRY, ou seja, no silencioso ele insiste
  //     sozinho. La o limite baixo so incomodava na instalacao MANUAL.
  //  2. DESINSTALAR O ANTIGO (`$R5 > 5`, em installUtil.nsh): o MessageBox e /SD IDCANCEL -- no
  //     silencioso ele DESISTE sozinho. Estouradas as 5 tentativas (~5s), o auto-update morre com
  //     "Falha ao desinstalar os arquivos do aplicativo antigo: 2" e o app nem reabre. Pegou
  //     todos os usuarios na atualizacao 0.18.33 -> 0.18.34 (27/08/2026).
  //
  // NAO troque esse /SD IDCANCEL por IDRETRY: apos o MessageBox o fluxo volta ao laco com $R5 ja
  // estourado, e o modo silencioso ficaria preso em loop infinito. Subir o contador e o correto:
  // 30 tentativas com Sleep 1000 dao ~30s, folga suficiente pro Defender liberar o binario.
  const after = before
    .replace(/\$\{if\} \$R1 < 5\b/g, `\${if} $R1 < ${RETRIES}`)
    .replace(/\$\{if\} \$R5 > 5\b/g, `\${if} $R5 > ${RETRIES}`)
    .replace(DESISTIR_DA_COPIA_ANTIGA[0], DESISTIR_DA_COPIA_ANTIGA[1])
    .replace(ROTULO_ORFAO[0], ROTULO_ORFAO[1])
  if (after !== before) {
    writeFileSync(f, after)
    changed++
    console.log(`patch-nsis: ${f} -> tentativas (copia e desinstalacao) 5 => ${RETRIES}`)
  }
}
if (!changed) console.log('patch-nsis: nada a alterar (ja aplicado ou template diferente)')
