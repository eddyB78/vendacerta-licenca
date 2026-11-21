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

### Autorização premium no PDV desktop

O PDV usa a ativação já existente. Clientes que pedem `premium_v: 1` recebem um
comprovante Ed25519, válido por até 24 horas e limitado pelo vencimento da
licença e de cada módulo. Clientes antigos continuam com a resposta anterior.

Configure `PREMIUM_PRIVATE_KEY` no ambiente do servidor (PKCS#8 DER em
base64url). Configure a chave pública Ed25519 correspondente (32 bytes em
base64url) em `VENDACERTA_PREMIUM_PUBLIC_KEY` **antes de compilar** o desktop.
A chave privada fica somente no servidor. Defina também
`VITE_LICENSE_SERVER_URL` no build do PDV com a URL do servidor da edição usada.

#### Teste manual isolado no Windows

No PowerShell, use uma porta local livre e um banco separado. Este exemplo gera
chaves descartáveis de teste e guarda seus valores no ambiente do processo.

```powershell
Set-Location 'D:\PDV\vendacerta-licenca'
$parPremium = node --input-type=module -e "import{generateKeyPairSync}from'node:crypto';const{privateKey,publicKey}=generateKeyPairSync('ed25519');console.log(JSON.stringify({privada:privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),publica:publicKey.export({format:'jwk'}).x}));" | ConvertFrom-Json
$env:PREMIUM_PRIVATE_KEY = $parPremium.privada
$env:VENDACERTA_PREMIUM_PUBLIC_KEY = $parPremium.publica
$env:JWT_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:ADMIN_TOKEN = [guid]::NewGuid().ToString('N')
$env:TURSO_URL = ([uri]::new((Join-Path $env:TEMP ('vendacerta-piloto-' + [guid]::NewGuid().ToString('N') + '.db')))).AbsoluteUri
$env:TURSO_TOKEN = ''
$env:PORT = '3101'
$env:VITE_LICENSE_SERVER_URL = 'http://127.0.0.1:3101'
Start-Process -FilePath (Get-Command node).Source -ArgumentList '--import','tsx','src/index.ts' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden
$env:ADMIN_TOKEN
```

1. Abra `http://127.0.0.1:3101/painel/`. Emita uma licença de teste com nome
   **eddy test**, sem selecionar envio de e-mail. Cadastre um cliente premium,
   vincule a licença, ative **Importação Internacional** e conceda a oferta
   mensal. Use somente dados de teste.
2. Na mesma sessão do PowerShell, inicie o desktop com um identificador Tauri
   separado para preservar o banco e a ativação da instalação habitual.

```powershell
Set-Location 'D:\PDV\pdv'
$configPiloto = Join-Path $env:TEMP 'vendacerta-premium-piloto.json'
'{"identifier":"br.com.vendacerta.premium-piloto"}' | Set-Content $configPiloto
npm run tauri -- dev --config $configPiloto
```

3. Ative com a chave emitida no servidor de teste. Em **Compras**, abra
   **Importação Internacional**. Desconecte o servidor e confirme o acesso
   enquanto o comprovante local estiver válido. Reconecte, revogue o direito
   no painel de teste e clique em **Atualizar autorização** no PDV. A abertura
   do módulo deve ser bloqueada. A consulta a módulos continua disponível.

O teste automatizado `node --test tests/premium.test.mjs` reproduz **eddy test**
em seu próprio banco temporário e se encarrega da vigência de 21/12/2026. Ele
usa uma vigência futura equivalente se for executado depois dessa data.
