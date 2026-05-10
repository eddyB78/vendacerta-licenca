import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getDb, initDb } from './db.js'
import licencaRoutes from './routes/licenca.js'
import webhookRoutes from './routes/webhook.js'
import adminRoutes from './routes/admin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT ?? '3001')

const app = express()

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL ?? 'https://vendacerta.com.br',
    /^tauri:\/\//,        // Tauri app
    /^http:\/\/localhost/,
  ],
  credentials: true,
}))

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Logging básico ────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  const ts = new Date().toISOString()
  console.log(`[${ts}] ${req.method} ${req.path}`)
  next()
})

// ── Rotas ─────────────────────────────────────────────────────────────────────
app.use('/licenca', licencaRoutes)
app.use('/', webhookRoutes)          // /comprar, /webhook/mercadopago, /pagamento/*
app.use('/admin', adminRoutes)

// ── Painel admin (SPA estático) ───────────────────────────────────────────────
app.use('/painel', express.static(join(__dirname, '..', 'public', 'painel')))
app.get('/painel', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'painel', 'index.html'))
})

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), version: '1.0.0' })
})

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ ok: false, erro: 'Rota não encontrada.' })
})

// ── Inicia servidor ───────────────────────────────────────────────────────────
// Garante que o banco (Turso) seja inicializado antes de aceitar conexões
;(async () => {
  try {
    await initDb()
    console.log('[DB] Banco de dados Turso inicializado.')
  } catch (err) {
    console.error('[DB] Erro ao inicializar banco:', err)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════╗
  ║    VendaCerta — Servidor Licenças    ║
  ╠══════════════════════════════════════╣
  ║  HTTP  → http://localhost:${PORT}       ║
  ║  Admin → /painel  (Bearer token)    ║
  ║  Env   → ${process.env.NODE_ENV ?? 'development'}               ║
  ╚══════════════════════════════════════╝
  `)
  })
})()

export default app
