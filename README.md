# Tailor Executive AI Notes

IA de anotacoes, transcricoes e analise de reunioes — empresarial e minimalista, com a
identidade Tailor. PWA instalavel (mobile + desktop), pronta para virar app iOS/Android depois.

## Rodar agora (modo demonstracao, sem backend)

```bash
npm install
npm run dev
```

Abra http://localhost:5173. Sem chaves configuradas, o app roda em **modo mock**
(dados no localStorage do navegador), ja navegavel de ponta a ponta.

Contas de teste:
- **Admin:** flavio.junior@tailorexec.com.br / `Tailor@007`
- **Membro:** fernanda.nogueira@tailorexec.com.br / `Tailor@123`

## Funcionalidades

- Login e cadastro **restritos ao dominio @tailorexec.com.br** (nome, sobrenome, e-mail,
  telefone com DDI/DDD, senha + confirmacao).
- Home "Minhas notas": busca, filtro por pasta, criar nota (gravar / enviar audio / arquivo / link).
- Gravacao pelo microfone com timer e nivel de audio; transcricao e resumo automaticos.
- Detalhe da nota: Resumo (Haiku), **Resumo detalhado mais inteligente** (Sonnet),
  **Analise de reuniao** (tom, perguntas feitas/sugeridas, ritmo, pontos fortes, melhorias,
  riscos), Transcricao, Action Items e **chat "Conversar com a nota"**.
- **Narracao (TTS) gratuita** on-device (Web Speech API) do resumo ou da transcricao.
- **Compartilhar**: WhatsApp, e-mail, PDF, Word, copiar — e com **parceiros cadastrados** (a nota
  aparece direto no app deles).
- **Painel de Administrador** (somente admin): usuarios, notas, gravacoes, transcricoes,
  sugestoes de IA e narracoes por pessoa, com totais e ultima atividade.
- Tema **claro/escuro** com botao no topo. PWA instalavel.

## Ativar o backend real (Supabase)

1. Crie um projeto em https://supabase.com.
2. Copie `.env.example` para `.env.local` e preencha:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
3. Rode o schema `supabase/migrations/0001_init.sql` (SQL Editor ou `supabase db push`).
   Ele cria tabelas, RLS, storage de audio, a **restricao de dominio** e promove o
   flavio.junior@ a admin automaticamente.
4. Deploy das edge functions (guardam as chaves no servidor):
   ```bash
   supabase functions deploy ai
   supabase functions deploy transcribe
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase secrets set TRANSCRIPTION_PROVIDER=groq GROQ_API_KEY=gsk_...
   ```
5. `npm run dev` — o app detecta as variaveis e passa a usar o backend real.

### Vercel
- No painel do Vercel, abra o projeto e vá em Settings → Environment Variables.
- Adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores do projeto do Supabase.
- Refaça o deploy depois de salvar as variaveis para que o app pare de entrar em modo demonstração.

## Modelos de IA (custo x qualidade)

| Tarefa                | Modelo               | Motivo                          |
|-----------------------|----------------------|---------------------------------|
| Transcricao           | Whisper large-v3 (Groq) | Barato, rapido, otimo em PT  |
| Resumo automatico     | Claude Haiku 4.5     | Rapido e barato                 |
| Resumo detalhado      | Claude Sonnet 5      | Qualidade alta sob demanda      |
| Analise de reuniao    | Claude Sonnet 5      | Raciocinio mais profundo        |
| Chat / action items   | Claude Haiku 4.5     | Barato                          |

Resumos automaticos usam Haiku; o botao "Gerar detalhado" usa Sonnet apenas quando o usuario
pede — evitando gasto desnecessario e resolvendo o problema de "resumos ruins".

## Build e deploy web

```bash
npm run build      # gera dist/ (PWA)
npm run preview
```
Publique `dist/` em Vercel, Netlify ou Cloudflare Pages.

> Icones PWA: adicione `public/pwa-192.png`, `public/pwa-512.png` e `public/apple-touch-icon.png`
> (o `favicon.svg` ja acompanha a marca) para instalacao perfeita em iOS/Android.

## Proximo passo: apps iOS e Android

O codigo esta pronto para empacotar com **Capacitor** reaproveitando esta base:
```bash
npm i @capacitor/core @capacitor/cli
npx cap init "Tailor Notes" br.com.tailorexec.notes
npx cap add ios && npx cap add android
```
(gravacao nativa e permissoes de microfone/telefone entram nessa fase.)

## Stack

React + TypeScript + Vite, Tailwind (design tokens da marca), React Router, Supabase
(auth + Postgres + storage + edge functions), vite-plugin-pwa.
