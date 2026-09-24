; Script NSIS customizado (build/installer.nsh e o caminho PADRAO que o electron-builder inclui
; sozinho -- confirmado no fonte: getResource(undefined,"installer.nsh") -> buildResources/).
;
; ATENCAO ao escrever aqui: este arquivo e incluido ANTES do template do electron-builder, entao
; nada de LogicLib (${if}/${FileExists}) nem dos !define dele (${APP_EXECUTABLE_FILENAME},
; ${SHORTCUT_NAME}...) fora de corpo de macro -- macro so e interpretada quando INSERIDA, la na
; frente, quando tudo isso ja existe. Por isso tudo aqui vive dentro de !macro e usa NSIS puro
; (IfFileExists/StrCmp/Goto) em vez de LogicLib. O parametro UID mantem os labels unicos quando
; a mesma macro e inserida em mais de um ponto.

; Lidas ANTES da faxina, usadas DEPOIS da instalacao (ver customInit / customInstall).
; O !ifndef NAO e decorativo: este mesmo arquivo tambem e compilado na build do DESINSTALADOR,
; onde customInit/customInstall nunca sao inseridas. Sem o guarda, as duas variaveis ficam
; declaradas e nunca usadas, o NSIS emite "warning 6001: ... wasting memory!" e o electron-builder
; trata warning como ERRO -- a build inteira falha.
!ifndef BUILD_UNINSTALLER
  Var AnaHadDesktopLink
  Var AnaHadMenuLink
  ; "1" quando a faxina removeu alguma copia antiga: so entao vale varrer atalhos (ver customInstall).
  Var AnaRemovedCopy
!endif

; =============================================================================================
; 1) Fechar o app de verdade antes de extrair
; =============================================================================================
; PROBLEMA: o ANA fica na BANDEJA e o Electron cria varios processos com o mesmo nome
; ("ANA by Tailor.exe": principal + helpers). No auto-update o app chama quitAndInstall, mas os
; processos ainda estao MORRENDO no instante em que o instalador comeca a extrair -> a extracao
; pega um arquivo ainda travado e o Windows mostra o erro "arquivo em uso / Repetir" (clicar em
; Repetir funciona porque ai ja morreu, mas queremos que nem apareca).
;
; SOLUCAO: nao basta "matar e seguir" -- tem que MATAR e CONFERIR que sumiu de verdade antes de
; extrair. Duas armadilhas ja pagas aqui:
;
;  1. NAO da para confiar no codigo de saida do taskkill: ele devolve != 0 tanto para "nao havia
;     nada para matar" quanto para "nao consegui matar" (processo elevado -> acesso negado). O
;     laco saia daqui achando que estava tudo limpo e a instalacao ia falhar mais adiante.
;  2. Cada taskkill/tasklist e um processo de CONSOLE: o Windows abre um terminal por chamada e
;     a tela fica PISCANDO durante a instalacao inteira (relato de 24/09/2026). Numa maquina com
;     copia antiga travada sao dezenas de voltas -- parece que o instalador esta quebrado.
;
; Por isso quem pergunta "ainda esta rodando?" e quem mata e o plugin nsProcess (vem com o NSIS
; do electron-builder): ele usa a API do Windows no proprio processo do instalador -- sem console,
; sem piscar, e com resposta confiavel (0 = achou, 603 = nao ha mais nenhum).
; O taskkill continua como ultimo recurso, so quando o nsProcess nao deu conta: uma janela
; piscando no caso raro e melhor que um app vivo segurando os arquivos.
!macro _AnaKillWait UID
  StrCpy $R0 0
  ana_loop_${UID}:
    nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    Pop $0
    ; $0 != "0" -> nao ha mais nenhum processo do ANA -> pode extrair.
    StrCmp $0 "0" 0 ana_gone_${UID}
    nsProcess::_KillProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    Pop $0
    Sleep 400
    IntOp $R0 $R0 + 1
    ; trava de seguranca: no maximo ~10s (25 voltas) pra nunca pendurar o instalador.
    IntCmp $R0 25 ana_teimoso_${UID} ana_loop_${UID} ana_teimoso_${UID}
  ana_teimoso_${UID}:
    ; esgotou o tempo com processo ainda vivo: ultima cartada, agora com o taskkill (que leva
    ; junto os filhos com /T). Pisca uma vez, e so aqui.
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
    Pop $0
    Sleep 400
  ana_gone_${UID}:
  nsProcess::_Unload
  ; respiro final pros handles do arquivo serem liberados antes de sobrescrever.
  Sleep 800
!macroend

; =============================================================================================
; 2) Faxina: nao pode sobrar NENHUMA copia antiga do ANA no PC
; =============================================================================================
; POR QUE ISTO EXISTE (caso real, 09/2026): uma usuaria tinha 3-4 copias do ANA instaladas no
; mesmo PC. Ate a v0.18.25 o instalador era "assisted" (nsis.oneClick:false +
; allowToChangeInstallationDirectory), o que deixava escolher a PASTA e o MODO ("so pra mim" x
; "todos os usuarios") -- cada escolha diferente virava uma instalacao paralela que a seguinte
; nao enxergava. Pior: como o app e um wrapper que carrega o site ao vivo, TODAS mostravam a
; mesma versao na tela (a do site), entao nada denunciava que ela usava uma velha. E cada copia
; guarda login e gravacoes pendentes num lugar separado -- dai "gravacoes retomadas diferentes
; na mesma conta".
;
; O template do electron-builder so desinstala UMA copia: a registrada em SHELL_CONTEXT (HKCU,
; no nosso caso per-user). Ele nunca olha o HKLM nem pastas orfas (instalacao que falhou no meio
; e deixou uns poucos MB pra tras). Estas macros cobrem esses dois buracos.
;
; SEGURANCA DOS DADOS: todo desinstalador antigo e chamado com /KEEP_APP_DATA e --updated. Sem
; esses dois, o uninstaller.nsh do electron-builder faz RMDir /r na pasta de dados do app -- e e
; exatamente la que moram o login e as gravacoes ainda nao transcritas. Nunca remover isso.

; Remove UMA copia do ANA.
;   Entrada: $R8 = pasta da copia.
;   RUNUNINST = 1 -> roda o desinstalador dela (limpa tambem a entrada em "Aplicativos
;               instalados"); usar quando a copia veio de uma entrada de REGISTRO.
;   RUNUNINST = 0 -> so apaga os arquivos; usar em pasta ORFA, porque o desinstalador de uma
;               copia orfa apagaria por tabela as chaves de registro da instalacao atual.
!macro _AnaRemoveCopy UID RUNUNINST
  ; nunca mexer na instalacao que estamos fazendo agora
  StrCmp "$R8" "" ana_rm_end_${UID} 0
  StrCmp "$R8" "$INSTDIR" ana_rm_end_${UID} 0

  ; Trava de seguranca: so age em pasta que REALMENTE parece uma instalacao do ANA. Assim um
  ; registro corrompido nunca vira "apagar uma pasta qualquer do PC do usuario".
  IfFileExists "$R8\${APP_EXECUTABLE_FILENAME}" ana_rm_go_${UID} 0
  IfFileExists "$R8\${UNINSTALL_FILENAME}" ana_rm_go_${UID} ana_rm_end_${UID}

  ana_rm_go_${UID}:
  DetailPrint "Removendo copia antiga do ANA em $R8"
  StrCpy $AnaRemovedCopy "1"
  StrCmp "${RUNUNINST}" "1" 0 ana_rm_files_${UID}
  IfFileExists "$R8\${UNINSTALL_FILENAME}" 0 ana_rm_files_${UID}
    ; O desinstalador mora DENTRO da pasta que ele vai apagar -> roda a partir de uma copia
    ; temporaria (mesmo cuidado do uninstallOldVersion do proprio electron-builder).
    Delete "$PLUGINSDIR\ana-old-uninstaller.exe"
    CopyFiles /SILENT "$R8\${UNINSTALL_FILENAME}" "$PLUGINSDIR\ana-old-uninstaller.exe"
    IfFileExists "$PLUGINSDIR\ana-old-uninstaller.exe" 0 ana_rm_files_${UID}
    ExecWait '"$PLUGINSDIR\ana-old-uninstaller.exe" /S /KEEP_APP_DATA --updated _?=$R8' $R9
    Delete "$PLUGINSDIR\ana-old-uninstaller.exe"

  ana_rm_files_${UID}:
  ; Mesmo que o desinstalador falhe (arquivo em uso, registro quebrado) ou nem exista, a pasta
  ; NAO pode ficar: um .exe sobrando ali e exatamente o que o usuario continua clicando por
  ; engano. RMDir /r pula o que estiver travado, nunca pendura o instalador.
  RMDir /r "$R8"
  ; O desinstalador antigo em especial TEM que sair. Enquanto o arquivo existir, o template do
  ; electron-builder continua tentando executa-lo (ver _AnaPurgeHive) -- e um desinstalador que
  ; falha sempre prende a instalacao inteira.
  Delete "$R8\${UNINSTALL_FILENAME}"

  ana_rm_end_${UID}:
!macroend

; Varre um ramo do registro atras de QUALQUER entrada de desinstalacao do ANA e remove todas as
; que nao sao a instalacao atual. Pega inclusive entradas gravadas por versoes antigas do
; electron-builder, que o template de hoje nem procuraria (ele so conhece a chave GUID atual).
!macro _AnaPurgeHive HIVE UID
  StrCpy $R2 0    ; indice da enumeracao
  StrCpy $R3 0    ; trava de seguranca: nunca prender o instalador num laco
  ana_hive_loop_${UID}:
    IntOp $R3 $R3 + 1
    IntCmp $R3 400 ana_hive_end_${UID} 0 ana_hive_end_${UID}
    EnumRegKey $R4 ${HIVE} "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R2
    StrCmp "$R4" "" ana_hive_end_${UID} 0
    IntOp $R2 $R2 + 1
    ReadRegStr $R5 ${HIVE} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "DisplayName"
    ; "ANA by Tailor" = 13 caracteres; o nome gravado traz a versao depois ("ANA by Tailor 0.18.36")
    StrCpy $R6 "$R5" 13
    StrCmp "$R6" "ANA by Tailor" 0 ana_hive_loop_${UID}
    ReadRegStr $R6 ${HIVE} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "UninstallString"
    StrCmp "$R6" "" ana_hive_loop_${UID} 0
    ; UninstallString e do tipo: "C:\...\Uninstall ANA by Tailor.exe" /currentuser
    ; GetInQuotes/GetFileParent sao funcoes do proprio electron-builder (installUtil.nsh);
    ; chamada de funcao e resolvida na linkagem, entao pode chamar mesmo estando definidas
    ; mais abaixo no script final.
    Push "$R6"
    Call GetInQuotes
    Pop $R7
    StrCmp "$R7" "" 0 +2
      StrCpy $R7 "$R6"
    Push "$R7"
    Call GetFileParent
    Pop $R8
    StrCmp "$R8" "$INSTDIR" ana_hive_loop_${UID} 0
    !insertmacro _AnaRemoveCopy ${UID} 1
    ; Se o DESINSTALADOR daquela copia sumiu, a entrada em "Aplicativos instalados" nao pode
    ; continuar la. Alem de fazer o usuario ver 3-4 "ANA by Tailor" na lista de programas, e
    ; justamente essa entrada que o template do electron-builder le antes de extrair: ele roda o
    ; desinstalador dela e, enquanto ele devolver erro, para a instalacao com "Repetir/Cancelar".
    ; Antes exigiamos a pasta INTEIRA vazia -- um unico arquivo travado bastava para a entrada
    ; quebrada ficar para tras (24/09/2026).
    IfFileExists "$R7" ana_hive_loop_${UID} 0
      DeleteRegKey ${HIVE} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4"
      ; a chave saiu do meio da enumeracao: volta um indice pra nao pular a proxima
      IntOp $R2 $R2 - 1
    Goto ana_hive_loop_${UID}
  ana_hive_end_${UID}:
!macroend

; Pastas onde uma copia do ANA ja foi parar e que podem ter ficado ORFAS (sem entrada de
; registro): instalacao interrompida no meio, desinstalacao que falhou, ou a pasta antiga
; "tailor-executive-ai-notes" -- versoes antigas do electron-builder nomeavam a pasta
; por-usuario com o `name` do package.json em vez do productName, e e por isso que o app nao
; aparece em Arquivos de Programas E fica com um nome que ninguem reconhece.
!macro _AnaPurgeOrphanDirsPerUser UID
  StrCpy $R8 "$LOCALAPPDATA\Programs\tailor-executive-ai-notes"
  !insertmacro _AnaRemoveCopy ${UID}A 0
  StrCpy $R8 "$LOCALAPPDATA\Programs\ANA by Tailor"
  !insertmacro _AnaRemoveCopy ${UID}B 0
  StrCpy $R8 "$LOCALAPPDATA\Programs\ana-by-tailor"
  !insertmacro _AnaRemoveCopy ${UID}C 0
!macroend

!macro _AnaPurgeOrphanDirsPerMachine UID
  StrCpy $R8 "$PROGRAMFILES64\ANA by Tailor"
  !insertmacro _AnaRemoveCopy ${UID}D 0
  StrCpy $R8 "$PROGRAMFILES32\ANA by Tailor"
  !insertmacro _AnaRemoveCopy ${UID}E 0
!macroend

; =============================================================================================
; 3) Ganchos do electron-builder
; =============================================================================================

; Substitui TODA a checagem padrao (incluindo o dialogo): mata e ESPERA sumir antes de extrair.
!macro customCheckAppRunning
  !insertmacro _AnaKillWait CHECK
!macroend

!macro customInit
  ; 1. mata o app antes de qualquer copia de arquivo
  !insertmacro _AnaKillWait INIT

  ; 2. anota se os atalhos existiam ANTES da faxina. O desinstalador de uma copia antiga apaga
  ;    atalhos pelo NOME -- ou seja, leva junto os da instalacao atual, que se chamam igual.
  ;    Como numa atualizacao o template NAO recria atalhos (keepShortcuts), sem esta anotacao o
  ;    usuario ficaria sem icone na area de trabalho depois de atualizar. Recriamos em
  ;    customInstall, e so os que existiam -- quem apagou o atalho de proposito nao ganha de volta.
  StrCpy $AnaRemovedCopy "0"
  StrCpy $AnaHadDesktopLink "0"
  IfFileExists "$DESKTOP\${SHORTCUT_NAME}.lnk" 0 +2
    StrCpy $AnaHadDesktopLink "1"
  StrCpy $AnaHadMenuLink "0"
  IfFileExists "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" 0 +2
    StrCpy $AnaHadMenuLink "1"

  ; 3. faxina. Antes da extracao de proposito: se alguma dessas remocoes apagar por tabela as
  ;    chaves de registro da instalacao atual, o registryAddInstallInfo (que roda depois, na
  ;    secao de install) as reescreve.
  InitPluginsDir
  !insertmacro _AnaPurgeHive HKCU HKCU
  !insertmacro _AnaPurgeOrphanDirsPerUser ORPHU

  ; Copias "para todos os usuarios" (Arquivos de Programas) exigem elevacao pra sair, e este
  ; instalador roda como usuario comum. Tentamos SO na instalacao manual: numa atualizacao
  ; automatica (silenciosa) um pedido de UAC apareceria do nada e, se o usuario recusasse, a
  ; atualizacao morria -- exatamente o problema que estamos tentando eliminar.
  IfSilent ana_init_done 0
    !insertmacro _AnaPurgeHive HKLM HKLM
    !insertmacro _AnaPurgeOrphanDirsPerMachine ORPHM
  ana_init_done:
!macroend

!macro customInstall
  ; 1. recria os atalhos que a faxina possa ter levado junto (ver customInit).
  StrCmp "$AnaHadDesktopLink" "1" 0 ana_ci_menu
  IfFileExists "$newDesktopLink" ana_ci_menu 0
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ana_ci_menu:
  StrCmp "$AnaHadMenuLink" "1" 0 ana_ci_repoint
  IfFileExists "$newStartMenuLink" ana_ci_repoint 0
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ana_ci_repoint:

  ; 2. REAPONTA todo atalho do ANA que ainda aponte pra uma copia removida -- area de trabalho,
  ;    menu iniciar e, principalmente, a BARRA DE TAREFAS. Foi por um atalho fixado na barra que
  ;    a usuaria abria a versao velha todo dia. Reapontar (em vez de apagar) preserva a fixacao.
  ;    Se o PowerShell estiver bloqueado por politica, simplesmente nao acontece nada -- os dois
  ;    atalhos principais ja foram garantidos no passo 1, em NSIS puro.
  ;    So roda quando a faxina removeu alguma copia (17/09/2026): numa atualizacao comum, na mesma
  ;    pasta, nenhum atalho aponta para lugar errado e a varredura so alongava a instalacao.
  StrCmp "$AnaRemovedCopy" "1" 0 ana_ci_end
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$e='$INSTDIR\${APP_EXECUTABLE_FILENAME}'; $$w=New-Object -ComObject WScript.Shell; $$d=@($$env:USERPROFILE+'\Desktop',$$env:PUBLIC+'\Desktop',$$env:APPDATA+'\Microsoft\Windows\Start Menu\Programs',$$env:APPDATA+'\Microsoft\Internet Explorer\Quick Launch',$$env:ProgramData+'\Microsoft\Windows\Start Menu\Programs'); foreach($$p in $$d){ if(Test-Path -LiteralPath $$p){ Get-ChildItem -LiteralPath $$p -Filter *.lnk -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { try { $$s=$$w.CreateShortcut($$_.FullName); if($$s.TargetPath -and ([System.IO.Path]::GetFileName($$s.TargetPath) -eq '${APP_EXECUTABLE_FILENAME}') -and ($$s.TargetPath -ne $$e)){ $$s.TargetPath=$$e; $$s.WorkingDirectory=(Split-Path -Parent $$e); $$s.IconLocation=$$e+',0'; $$s.Save() } } catch {} } } }"`
  Pop $0
  ana_ci_end:
!macroend
