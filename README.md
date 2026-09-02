# IPTV Manager

Ferramenta **administrativa** de gerenciamento de acessos IPTV (Xtream Codes).
Produto independente — não contém player, EPG, lista de canais nem qualquer
tela destinada ao usuário final.

## O que faz

- Trava de acesso por **PIN administrativo** (SHA-256 em `localStorage`, sessão
  destravada só enquanto o app está aberto).
- CRUD de acessos IPTV (host / usuário / senha), armazenados em JSON-lines
  (`data/usuarios.txt`).
- Verificação de status ao vivo contra `player_api.php` (ATIVO / VENCE EM BREVE
  / EXPIRADO / OFFLINE) — individual e em lote, com auto-refresh a cada 5 min.
- Importação em massa a partir de uma fonte de canais (`/import/preview` +
  `/import`).
- **Portal de dispositivos (ativação por MAC)**: cada aparelho do IPTV Player se
  anuncia por MAC (`POST /api/devices/heartbeat`), o admin vincula um dos
  servidores e libera — o Player baixa a lista sozinho. Registro em JSON-lines
  (`data/devices.txt`). Ao digitar um MAC já conhecido em "Adicionar
  dispositivo", o nome reportado pelo aparelho aparece automaticamente.
- Busca, filtro por status e ordenação por expiração.
- Tema claro/escuro.

## Stack

| Camada   | Tecnologia |
|----------|------------|
| Frontend | React 19 + TypeScript + Vite 8, Tailwind v4, componentes shadcn-style feitos à mão (Radix) |
| Backend  | Express + TypeScript, sem banco (JSON-lines em `data/usuarios.txt`) |
| Mobile   | Capacitor 8 (Android). Backend Express roda embarcado no app via `@capawesome/capacitor-nodejs` (nodejs-mobile), em `127.0.0.1:8891` |

Nenhuma dependência de código, pacote ou pasta compartilhada com o IPTV Player.

## Rodando em desenvolvimento

> Atalho: na raiz do repositório existe `iptv-suite.bat`, que sobe/derruba os
> **dois** produtos de uma vez (`iptv-suite.bat start | stop | restart | pause |
> resume | status | reset`). O Manager fica em `:5173`/`:3001`. As instruções
> abaixo são pra rodar só este projeto, à mão.

```bash
# terminal 1 — backend (http://localhost:3001)
cd backend
npm install
npm run dev

# terminal 2 — frontend (http://localhost:5173, faz proxy de /api p/ :3001)
cd frontend
npm install
npm run dev
```

Na primeira abertura o app pede para **definir um PIN**; nas seguintes, pede o PIN.

## Build

```bash
# web
cd frontend && npm run build          # -> frontend/dist

# backend para o app Android (bundle nodejs-mobile)
cd backend && npm run build:mobile    # -> frontend/public/nodejs/main.js

# APK Android (assinado com frontend/android/keystore/release.keystore)
cd frontend
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
# -> frontend/android/app/build/outputs/apk/release/app-release.apk
```

`app-release.apk` é assinado pela keystore de desenvolvimento incluída
(`frontend/android/keystore.properties` + `keystore/release.keystore`).
**Antes de publicar numa loja, gere sua própria keystore** e atualize
`keystore.properties`. Sem `keystore.properties` o Gradle ainda compila, mas
produz `app-release-unsigned.apk`.

Requisitos Android: JDK 17 (`JAVA_HOME`), Android SDK
(`frontend/android/local.properties` → `sdk.dir`).

## Identificadores

- `appId`: `com.hciptv.manager`
- `appName`: `IPTV Manager`

## API do backend

| Método | Rota | Descrição |
|--------|------|-----------|
| GET    | `/api/users` | lista acessos |
| POST   | `/api/users` | cria (valida + verifica status) |
| PUT    | `/api/users/:id` | edita |
| DELETE | `/api/users/:id` | remove |
| GET    | `/api/users/:id/check` | verifica um |
| POST   | `/api/check-all` | verifica todos |
| POST   | `/api/import/preview` | pré-visualiza candidatos de uma fonte |
| POST   | `/api/import` | importa em lote |
| POST   | `/api/devices/heartbeat` | **(chamado pelo Player — público, sem token)** anuncia/atualiza um dispositivo por MAC; devolve `{host,username,password}` quando `status:"active"` |
| GET    | `/api/devices` | lista de dispositivos |
| GET    | `/api/devices/:mac` | um dispositivo (auto-preencher nome) |
| PUT    | `/api/devices/:mac` | vincular servidor / renomear / ativar-desativar / definir validade (`expiresAt`, `extendDays`, `validityDays`) |
| DELETE | `/api/devices/:mac` | desparear |
| GET    | `/api/devices/:mac/payments` | histórico de cobranças do dispositivo |
| GET    | `/api/renewal/info` | **(público)** preço em vigor + `providerConfigured` (pro botão "Renovar") |
| POST   | `/api/devices/:mac/renewal` | **(público)** gera/reaproveita uma cobrança PIX (Mercado Pago) pro dispositivo |
| GET    | `/api/payments/:id` | **(público)** status da cobrança (o Player faz polling; auto-cura consultando o MP) |
| POST   | `/api/webhooks/mercadopago` | **(público, assinatura validada)** o MP avisa o pagamento → portal estende +30d |
| GET/PUT| `/api/settings/renewal` | lê/edita preço, meses, TTL do QR e valor promocional |
| GET    | `/healthz` | health check público (`{ok,storage,tokenRequired}`) |

Todas as rotas `/api/*` **exceto** `POST /api/devices/heartbeat` exigem o header
`x-portal-token` igual à env var `PORTAL_ADMIN_TOKEN` — quando ela está
definida. Sem `PORTAL_ADMIN_TOKEN` (caso do backend embarcado no APK, que só
escuta em `127.0.0.1`), a API fica aberta.

### Variáveis de ambiente (`backend/.env.example`)

| Var | Efeito |
|-----|--------|
| `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | as duas juntas → persiste no Postgres do Supabase; em branco → arquivos `data/*.txt` |
| `PORTAL_ADMIN_TOKEN` | token exigido em `x-portal-token` (todas as rotas menos as públicas). Em branco = API aberta |
| `MP_ACCESS_TOKEN` | Access Token do Mercado Pago (`APP_USR-...` em produção, `TEST-...` em sandbox). Sem ele, renovação por PIX fica off e o Player esconde o botão |
| `MP_WEBHOOK_SECRET` | assinatura secreta do webhook do MP (painel → app → Webhooks). Sem ela o webhook roda sem validar assinatura (o polling confirma igual) |
| `PORTAL_PUBLIC_URL` | URL pública do portal — usada pra montar o `notification_url` do webhook do MP |
| `PORT` / `HOST` | padrão `3001` / `0.0.0.0` (a maioria dos hosts injeta `PORT`) |
| `DATA_DIR` | só no modo arquivo: onde gravar `usuarios.txt` / `devices.txt` |

> Preço, meses e valor promocional **não** são env var — ficam na tabela `portal_settings`
> do Supabase, editáveis no Manager (ícone 💳 no header).

## Portal hospedado (Supabase + Fly/Render)

O modelo player ↔ portal só funciona se o backend estiver num endereço
alcançável por todos os aparelhos. No APK ele roda embarcado em
`127.0.0.1:8891` (só o próprio aparelho vê). Para produção, hospede-o:

**1. Banco (uma vez).** Crie um projeto no [Supabase](https://supabase.com) e
rode `backend/schema.sql` no SQL Editor (cria `iptv_users` + `devices`, liga
RLS sem policy — só a *secret key* acessa). Pegue em *Settings → API Keys*:
`SUPABASE_URL` e a **Secret key** (`sb_secret_...`).

**2. Gere um token de admin.**

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

**3a. Fly.io** (não dorme; recomendado):

```bash
cd backend
fly launch --no-deploy --copy-config --name <seu-nome-unico>
fly secrets set SUPABASE_URL="https://<ref>.supabase.co" \
                SUPABASE_SECRET_KEY="sb_secret_..." \
                PORTAL_ADMIN_TOKEN="<token do passo 2>"
fly deploy
```

**3b. Render** (free dorme após ~15 min ocioso): *New → Blueprint* apontando
pro repo (`render.yaml` na raiz do IPTV_Manager); defina os 3 secrets quando
pedir.

**4. Configure os apps** para apontar ao portal:

- **IPTV Player** → tela de pareamento → "Endereço do portal" = a URL pública
  (ex.: `https://<seu-nome>.fly.dev`). Não precisa de token.
- **IPTV Manager** (app ou web) → ⚙ Endereço do servidor → mesma URL + o campo
  **"Token do portal"** = o `PORTAL_ADMIN_TOKEN`.

O container não usa disco persistente — todo o estado fica no Supabase.

### Desenvolvimento local do portal

Sem hospedar: `cd backend && npm run dev` escuta em `0.0.0.0:3001`; informe
`http://<ip-da-maquina>:3001` no Player. Para Supabase local, crie um
`backend/.env` a partir do `.env.example`.

## Renovação por PIX (Mercado Pago)

O usuário paga por PIX e o portal estende a validade do dispositivo em +30 dias
automaticamente. Fluxo: device expira → Player mostra **"Renovar acesso — R$ X"** →
gera cobrança PIX (`/v1/payments`) → mostra o QR/copia-e-cola → o Player faz *polling*
e o MP dispara um **webhook assinado** → o portal confere o valor, marca `paid` (idempotente)
e chama `updateDevice(mac, { extendDays: 30 * meses })`.

**Setup (uma vez):**

1. **App no Mercado Pago** — [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers)
   → Suas integrações → criar aplicação (Pagamentos online / Checkout API).
2. **Ativar credenciais de produção** — no app, seção *Credenciais de produção*: preencher
   **Indústria** + **Website**, aceitar os termos, resolver o reCAPTCHA → **Ativar**. O
   `APP_USR-...` (Access Token) aparece aí. (As credenciais de teste `TEST-...` já vêm
   ativas pra sandbox.)
3. **Chave Pix** — cadastrar uma chave Pix na conta do MP (Configurações → Suas chaves Pix).
   **Sem chave Pix, o PIX de produção não gera cobrança.**
4. **Webhook** — no app do MP, Webhooks: URL `https://<seu-portal>/api/webhooks/mercadopago`,
   tópico **payment**. Copiar a **assinatura secreta**.
5. **Env vars no host** — `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`,
   `PORTAL_PUBLIC_URL=https://<seu-portal>`.
6. **Preço** — no Manager, ícone 💳 no header: preço (R$), meses, validade do QR (min) e
   **valor promocional** (preço + data "até"). Default: R$ 19,90 / 1 mês / QR 30 min.

Homologação do Mercado Pago (selo de qualidade da integração) é **opcional** — não trava
o recebimento de pagamentos.

## Segurança — rotação de segredos

`PORTAL_ADMIN_TOKEN`, `SUPABASE_SECRET_KEY` e os tokens do Mercado Pago passaram pelo chat
do assistente durante a implementação. Para rotacionar depois:

- **`MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET`** — painel do MP → app → *Renovar credenciais* /
  regerar a assinatura → atualizar as env vars no host.
- **`SUPABASE_SECRET_KEY`** — Supabase → API Keys → criar nova Secret key, revogar a antiga
  → atualizar a env var no host.
- **`PORTAL_ADMIN_TOKEN`** — gerar novo valor → env var no host → **regerar o
  `frontend/src/lib/baked-config.ts`** (blob XOR+base64 com o novo token) → rebuild +
  reinstalar o APK do Manager (o token vai embutido/ofuscado no app).
