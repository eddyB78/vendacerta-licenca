# VendaCerta — Servidor de Licenças

Servidor Node.js para gerenciamento de licenças, integração com Mercado Pago e painel administrativo.

## Stack

- **Runtime:** Node.js 22 + TypeScript
- **Framework:** Express.js
- **Banco:** SQLite via `better-sqlite3`
- **JWT:** `jose` (HMAC-SHA256)
- **Pagamentos:** Mercado Pago SDK
- **Email:** Nodemailer (SMTP)

## Configuração local

```bash
cd servidor-licenca
npm install
cp .env.example .env
# edite o .env com seus valores reais
npm run dev
```

## Variáveis de ambiente obrigatórias

| Variável | Descrição |
|---|---|
| `JWT_SECRET` | String aleatória com ≥32 chars para assinar os tokens |
| `ADMIN_TOKEN` | Token secreto de acesso ao painel admin |
| `MP_ACCESS_TOKEN` | Token do Mercado Pago (`APP_USR-...`) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Credenciais SMTP para envio de emails |
| `SERVER_URL` | URL pública do servidor (ex: `https://licenca.vendacerta.com.br`) |

## Endpoints

### Licença (uso do app PDV)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/licenca/ativar` | Ativa uma chave no dispositivo |
| POST | `/licenca/verificar` | Verifica/renova licença (Bearer token) |

### Pagamentos

| Método | Rota | Descrição |
|---|---|---|
| GET | `/comprar?plano=mensal` | Redireciona para checkout MP |
| POST | `/webhook/mercadopago` | Recebe notificações do MP |
| GET | `/pagamento/sucesso` | Página de retorno pós-pagamento |

### Admin (requer `Authorization: Bearer <ADMIN_TOKEN>`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/admin/stats` | Dashboard com estatísticas |
| GET | `/admin/licencas` | Lista licenças (filtros: ?q= &status= &plano=) |
| POST | `/admin/licencas` | Cria nova licença manualmente |
| GET | `/admin/licencas/:id` | Detalhes + histórico de uma licença |
| PATCH | `/admin/licencas/:id` | Atualiza campos da licença |
| POST | `/admin/licencas/:id/revogar` | Revoga licença |
| POST | `/admin/licencas/:id/reativar` | Reativa licença revogada |
| DELETE | `/admin/licencas/:id` | Exclui definitivamente uma licença revogada |
| POST | `/admin/licencas/:id/resetar-dispositivo` | Remove hardware_id vinculado |

### Painel admin web

Acesse em: `http://localhost:3001/painel`

Use o `ADMIN_TOKEN` como senha na tela de login.

## Deploy no Railway

1. Crie uma conta em [railway.app](https://railway.app)
2. Crie um novo projeto → "Deploy from GitHub repo"
3. Adicione as variáveis de ambiente via "Variables" no painel
4. O servidor sobe automaticamente via Dockerfile

### Variáveis no Railway:

```env
JWT_SECRET=...       (gere com: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
ADMIN_TOKEN=...      (gere com: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
MP_ACCESS_TOKEN=APP_USR-...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu@gmail.com
SMTP_PASS=sua_senha_de_app_google
EMAIL_FROM=VendaCerta <seu@gmail.com>
SERVER_URL=https://seu-app.up.railway.app
FRONTEND_URL=https://vendacerta.com.br
```

## Configurar Mercado Pago

1. Crie uma conta em [mercadopago.com.br](https://www.mercadopago.com.br)
2. Acesse: Configurações → Credenciais → Produção
3. Copie o **Access Token** (`APP_USR-...`)
4. Em "Notificações IPN", adicione: `https://seu-servidor.com/webhook/mercadopago`

## Configurar Gmail para envio de emails

1. Ative **Verificação em 2 etapas** na conta Google
2. Acesse: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Crie uma senha de app → copie os 16 dígitos
4. Use essa senha em `SMTP_PASS`

## Configurar o app PDV

No arquivo `.env` do projeto Tauri (ou `vite.config.ts`), defina:

```env
VITE_LICENSE_SERVER_URL=https://seu-servidor.up.railway.app
```

Ou edite diretamente `src/store/licenca.store.ts`:
```ts
export const SERVIDOR_LICENCA = 'https://seu-servidor.up.railway.app'
```

## Estrutura do banco de dados

```
data/licencas.db
  ├── licencas       — chaves, planos, hardware_id, status
  ├── pagamentos     — registros do MP
  └── logs_ativacao  — auditoria de ativações
```
