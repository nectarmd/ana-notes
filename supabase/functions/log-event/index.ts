// Edge Function: recebe erros reportados pelo CLIENTE (navegador) para o log de auditoria.
// Deploy: `supabase functions deploy log-event`   <-- COM verificacao de JWT (exige sessao real).
//
// Esta function e o UNICO jeito do navegador gravar em audit_log (a tabela nao tem policy de
// insert; so a service role escreve). Como o corpo da requisicao vem de um cliente que pode ser
// hostil, nada do que ele manda e confiado cegamente:
//   - user_id vem SEMPRE de callerId(req), nunca do corpo (senao daria pra incriminar outro
//     usuario por um erro que nao e dele);
//   - source do cliente e sempre prefixado a forca com "client:" (nunca aceita "edge:", que
//     faria um erro comum parecer uma falha de servidor);
//   - severity fica restrita a info/warning/error (nunca "critical" -- reservado a logs
//     gravados pelas proprias edge functions, senao qualquer ruido vira alarme falso);
//   - category fica restrita a system/user/silent ("security" so e gravada internamente);
//   - um limite simples (50/hora por usuario) descarta o excedente em silencio, sem exigir
//     nenhuma infra de rate-limit nova.

// @ts-nocheck  (ambiente Deno)
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient, callerId, cors, logAuditServer } from '../_shared/guard.ts'

const MAX_PER_HOUR = 50

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const userId = await callerId(req)
    if (!userId) return json({ error: 'Sessao invalida. Entre novamente.' }, 401)

    const body = await req.json()

    const admin = adminClient()
    if (admin) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { count } = await admin
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', oneHourAgo)
      if ((count ?? 0) >= MAX_PER_HOUR) return json({ ok: true }) // descarta em silencio, sem erro visivel
    }

    const severity = ['info', 'warning', 'error'].includes(body.severity) ? body.severity : 'error'
    const category = ['system', 'user', 'silent'].includes(body.category) ? body.category : 'system'
    const source = 'client:' + String(body.source ?? 'unknown').replace(/^(edge|client):/, '').slice(0, 60)
    const message = String(body.message ?? 'erro sem mensagem').slice(0, 500)

    // Codigo do erro vindo do cliente (ex.: NETWORK, CLIENT_UNEXPECTED). So letras/digitos/_ e
    // prefixo forcado "CLIENT_" quando nao for um codigo do app (CLIENT_*, RECORDER_*, NETWORK) -- um cliente hostil nao
    // consegue fazer um erro comum parecer um codigo de servidor.
    const rawCode = typeof body.code === 'string' ? body.code.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 60) : ''
    const code = rawCode ? (rawCode.startsWith('CLIENT_') || rawCode.startsWith('RECORDER_') || rawCode === 'NETWORK' ? rawCode : `CLIENT_${rawCode}`) : null

    await logAuditServer({
      severity,
      category,
      source,
      code,
      message,
      detail: typeof body.detail === 'object' && body.detail ? body.detail : null,
      user_id: userId,
      note_id: typeof body.note_id === 'string' ? body.note_id : null,
      route: typeof body.route === 'string' ? body.route.slice(0, 300) : null,
      user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    })

    return json({ ok: true })
  } catch {
    // O proprio log de erro nunca pode virar mais um erro visivel: sempre 200, sem detalhe interno.
    return json({ ok: false })
  }
})
