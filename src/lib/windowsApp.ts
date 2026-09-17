// Download do app Windows (Electron) -- asset de release no GitHub (o instalador tem ~90 MB, acima
// do limite de upload do Supabase Storage no plano atual).
//
// Link FIXO para o instalador de nome fixo da release mais recente (ANA-Tailor-Setup-Windows.exe,
// publicado em toda release). Ate 17/09/2026 o link levava a versao do instalador no nome do
// arquivo, e esse segundo numero aparecia na tela ao lado da versao do site -- confundia. Agora a
// unica versao visivel e APP_VERSION (ver version.ts).
const REPO = 'https://github.com/tailorexec/tailor-executive-ai-notes'

export const WINDOWS_APP_DOWNLOAD_URL = `${REPO}/releases/latest/download/ANA-Tailor-Setup-Windows.exe`
