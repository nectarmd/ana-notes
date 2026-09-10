# Gerar o app Windows (Electron)

O app Windows (Electron) **carrega o site publicado** (https://ana.nectarmd.com.br), o mesmo
padrao do APK Android. Assim, cada deploy web atualiza o app automaticamente -- voce so precisa
gerar o instalador de novo se mudar algo NATIVO: o atalho global, a captura de audio do sistema,
o icone ou o nome do app (arquivos em `electron/`).

> **Cuidado com a versao que aparece na tela.** O numero grande em Configuracoes e o do SITE
> (`src/lib/version.ts`), igual em TODAS as copias instaladas. A versao do aplicativo nativo e
> outra coisa (`package.json`'s `version`) e aparece ao lado, como `· app 0.19.5`. Confundir as
> duas foi o que fez uma usuaria passar semanas usando um aplicativo de meses atras achando que
> estava atualizada -- ver "Onde o app e instalado" abaixo.

## 1. Gerar o instalador localmente

```
npm install
npm run dist:win
```

O instalador sai em `release/ANA-by-Tailor-Setup-<versao>.exe` (a versao vem do campo `version`
do `package.json` -- mantenha igual a `src/lib/version.ts`). Sem espaco no nome de proposito
(`nsis.artifactName` em package.json) -- com espaco, o GitHub troca por ponto ao subir o asset,
e isso NAO bate com o nome que `latest.yml` espera (gerado sem espaco), quebrando o auto-update
em silencio (aconteceu uma vez, ver historico do commit `feat(windows): busca e instala...`).

## 2. Testar sem empacotar (mais rapido, ao editar `electron/`)

```
npm run electron:dev
```

Abre a janela do Electron carregando o site ao vivo, sem gerar o instalador.

## 3. Gerar pelo GitHub Actions (sem precisar do Windows local)

Aba **Actions → Build Windows App → Run workflow** no GitHub. O instalador fica disponivel como
artefato do workflow (`ana-windows-setup`).

## O que o app nativo faz alem do site

- **Atalho global `Ctrl+Shift+G`**: traz a janela pra frente e JA INICIA a gravacao de reuniao do
  PC (`electron/main.cjs` chama `window.__anaStartMeeting` via `executeJavaScript(code, true)` --
  o `userGesture=true` simula o gesto que o `getDisplayMedia` exige; `App.tsx` navega pra
  `?autostart=1` e o `Capture.tsx` dispara o start). Nao precisa mais clicar em "Iniciar".
- **Captura de audio do sistema sem dialogo**: dentro do app nativo, "Gravar Meet" nao pede pra
  escolher a aba nem lembrar de marcar "compartilhar audio" -- `setDisplayMediaRequestHandler` no
  processo principal autoriza tela inteira + audio do sistema direto. Isso so funciona AQUI, nao
  no navegador comum (por seguranca, o navegador sempre mostra esse dialogo).
- **Bandeja do sistema**: fechar a janela minimiza para a bandeja em vez de encerrar o app (o
  atalho global continua funcionando com a janela "fechada"). "Sair" no menu da bandeja encerra
  de verdade.
- **Atualizacao AUTOMATICA e SILENCIOSA** (`electron-updater` + instalador `oneClick`): checa 5s
  apos abrir e a cada ~3h (a bandeja mantem o app vivo por dias). `autoDownload = true` baixa
  sozinho em segundo plano; `autoInstallOnAppQuit = true` instala ao fechar o app de verdade
  (bandeja -> Sair, logoff, desligar). Nenhum dialogo nativo trava o fluxo. Quem quiser atualizar
  na hora usa o aviso discreto do site (`UpdateBanner.tsx` -> IPC `ana:quit-and-install`). O
  instalador `oneClick` (per-user, sem UAC) fecha o app e instala em silencio -- e o que ACABA com
  o antigo dialogo bloqueante "nao e possivel fechar o ANA". Le `package.json`'s `build.publish`
  (provider github, mesmo repositorio das releases).

## Onde o app e instalado (e por que NAO fica em Arquivos de Programas)

O instalador e **per-user** (`nsis.perMachine: false` + `oneClick: true`), entao o app vai pra
`%LOCALAPPDATA%\Programs\...` e nunca pra `C:\Program Files`. Isso e deliberado, nao um bug: e a
mesma escolha do Chrome, Teams, Slack e VS Code. Instalar em Arquivos de Programas exigiria
elevacao (UAC) **na instalacao e em toda atualizacao automatica**, e como o instalador nao e
assinado ("Editor desconhecido"), quem clicasse "Nao" ficaria travado numa versao antiga --
exatamente o problema que o resto deste documento tenta eliminar.

O nome da pasta pode ser `tailor-executive-ai-notes` em vez de "ANA by Tailor": versoes antigas
do electron-builder usavam o `name` do `package.json` (e nao o `productName`) pra nomear a pasta
por-usuario, e o caminho fica **gravado no registro** (`HKCU\Software\<GUID do appId>`,
`InstallLocation`), entao instalacoes seguintes continuam nele. Nao force a mudanca: mover a
pasta nao traz beneficio real e arrisca a atualizacao. O caminho verdadeiro aparece dentro do
app, em **Configuracoes → App do Windows**, junto com o da pasta das gravacoes.

### Faxina de copias antigas (`build/installer.nsh`)

Ate a v0.18.25 o instalador era "assisted", deixando o usuario escolher a pasta E o modo ("so pra
mim" x "todos os usuarios"). Cada escolha diferente virava uma instalacao **paralela** que a
seguinte nao enxergava -- houve caso real (09/2026) de 3-4 copias no mesmo PC, com a usuaria
abrindo uma velha por um atalho fixado na barra de tarefas. Como cada copia tem seu proprio
armazenamento local, apareciam gravacoes pendentes diferentes na mesma conta.

O template do electron-builder so desinstala UMA copia (a registrada em `SHELL_CONTEXT`). A
partir da v0.19.5 o `customInit` do `build/installer.nsh` cobre o resto:

- varre `HKCU` **e** `HKLM` atras de qualquer entrada "ANA by Tailor" que nao seja a instalacao
  atual e roda o desinstalador dela (limpando tambem a entrada em "Aplicativos instalados");
- apaga pastas ORFAS conhecidas (instalacao interrompida no meio, que deixa poucos MB pra tras);
- em `customInstall`, **reaponta** todo atalho `.lnk` do ANA (area de trabalho, menu iniciar e
  barra de tarefas) pro `.exe` da instalacao atual -- reapontar, e nao apagar, preserva a fixacao
  na barra de tarefas;
- recria os atalhos principais se o desinstalador de uma copia antiga os tiver levado junto (ele
  apaga por NOME, e os nomes sao iguais).

**Regra que nao pode ser quebrada:** todo desinstalador antigo e chamado com `/KEEP_APP_DATA` e
`--updated`. Sem esses dois, o `uninstaller.nsh` do electron-builder faz `RMDir /r` na pasta de
dados do app -- que e onde moram o login e as gravacoes ainda nao transcritas.

A limpeza do `HKLM` (Arquivos de Programas) so roda em instalacao **manual**: numa atualizacao
silenciosa, um pedido de UAC surgindo do nada quebraria a atualizacao automatica.

> Ao editar `build/installer.nsh`, lembre que ele e incluido ANTES do template do
> electron-builder: fora de corpo de macro nao existe LogicLib (`${if}`) nem os `!define` dele
> (`${APP_EXECUTABLE_FILENAME}`, `${SHORTCUT_NAME}`...). Por isso tudo la vive dentro de `!macro`
> e usa NSIS puro.

## Publicar uma release (checklist -- os 3 primeiros SAO OBRIGATORIOS pro auto-update funcionar)

Depois de `npm run dist:win`, a pasta `release/` tem os arquivos que precisam ir TODOS pra
mesma release do GitHub:

1. `ANA-by-Tailor-Setup-<versao>.exe` (o instalador em si, nome com versao)
2. `ANA-by-Tailor-Setup-<versao>.exe.blockmap` (permite update diferencial, so baixa o que mudou)
3. `latest.yml` (o que `electron-updater` le pra saber que ha versao nova e onde baixar)
4. Uma copia do `.exe` renomeada pra `ANA-Tailor-Setup-Windows.exe` (nome FIXO, sem versao --
   e o link usado no site/app, `src/lib/windowsApp.ts`, via `releases/latest/download/...`)
5. O `.apk` do Android (se tambem foi gerado nesta rodada), renomeado pra `ANA-Tailor-Android.apk`

Faltar os itens 1-3 nao quebra o download manual (item 4 continua funcionando), mas quebra o
auto-update em silencio: o app vai detectar que ha uma versao nova, tentar baixar, e falhar
(404) sem avisar nada de util no dialogo de erro alem de "nao foi possivel verificar".

**Automatizando (recomendado):** `npm run release:win` roda o electron-builder com
`--publish always`, que sobe `.exe` + `.blockmap` + `latest.yml` juntos pra release do GitHub
automaticamente (evita esquecer um e quebrar o auto-update). Precisa de um `GH_TOKEN` com permissao
de repo no ambiente. Ainda assim, suba a copia de nome fixo (item 4) manualmente pro fallback do
site, ou com `gh release upload <tag> release/ANA-Tailor-Setup-Windows.exe`.

## Assinatura de codigo (NAO configurada)

O instalador gerado **nao e assinado digitalmente** -- o Windows SmartScreen vai avisar "Editor
desconhecido" no primeiro uso (o usuario clica em "Mais informacoes" → "Executar assim mesmo").
Isso e equivalente ao APK sem keystore configurado: funciona, so pede essa confirmacao extra.
Para remover esse aviso e preciso comprar um certificado de assinatura de codigo (Authenticode,
~200-400 USD/ano) e configurar as variaveis `CSC_LINK`/`CSC_KEY_PASSWORD` do electron-builder --
nao fiz isso aqui por ser um custo recorrente que so voce pode decidir assumir.

## Icone

Gerado a partir de `assets/icon.png` (mesmo usado no Android/PWA) via `npm run electron:icon`,
que produz `build/icon.ico` (nao versionado -- roda sozinho antes de `dist:win`/`electron:dev`).
Para trocar o icone do app, so trocar `assets/icon.png` e gerar de novo.

## Observacoes

- Instalador pesa ~120 MB: e o preco do Electron (embute Chromium + Node), bem maior que o APK
  Android (que reaproveita a WebView do sistema). Nao ha como reduzir isso sem trocar de
  tecnologia (ex.: Tauri, que usa o WebView2 do Windows em vez de empacotar o Chromium).
- Como o app so carrega o site, ele nao funciona sem internet. Desde a v0.19.5, quando o site nao
  carrega o app mostra um aviso proprio e RETENTA sozinho a cada 6s, em vez da tela de erro crua
  do Chromium (que nao dava nem como tentar de novo sem fechar o app).
- Uma unica instancia por vez (`app.requestSingleInstanceLock()`, desde a v0.16.7): clicar no
  atalho de novo so traz a janela existente pra frente. Copias anteriores a essa versao nao tem
  a trava -- e por isso que o PC com varias copias abria varios ANAs ao mesmo tempo, cada um
  brigando pelo mesmo armazenamento local. A faxina do instalador e o que resolve isso de fato.
- `package.json`'s `"main"` aponta para `electron/main.cjs`; isso nao afeta `npm run dev`/`build`
  (Vite ignora esse campo).
