import { Router } from 'express'
import type { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db.js'
import { gerarChave, calcularExpiracao } from '../utils/chave.js'
import { adminAuth } from '../middleware/adminAuth.js'
import { enviarChaveLicenca } from '../utils/email.js'

const router = Router()
router.use(adminAuth)

// ── GET /admin/licencas ──────────────────────────────────────────────────────
router.get('/licencas', (req: Request, res: Response) => {
  const db = getDb()
  const { status, plano, q } = req.query as Record<string, string>

  let sql = 'SELECT * FROM licencas WHERE 1=1'
  const params: unknown[] = []

  if (status) { sql += ' AND status = ?'; params.push(status) }
  if (plano)  { sql += ' AND plano = ?';  params.push(plano) }
  if (q) {
    sql += ' AND (chave LIKE ? OR email LIKE ? OR nome LIKE ?)'
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }

  sql += ' ORDER BY criado_em DESC LIMIT 200'

  const licencas = db.prepare(sql).all(...params)
  res.json({ ok: true, licencas })
})

// ── GET /admin/licencas/:id ──────────────────────────────────────────────────
router.get('/licencas/:id', (req: Request, res: Response) => {
  const db = getDb()
  const licenca = db.prepare('SELECT * FROM licencas WHERE id = ?').get(req.params.id)

  if (!licenca) {
    res.status(404).json({ ok: false, erro: 'Licença não encontrada.' })
    return
  }

  const logs = db.prepare(
    'SELECT * FROM logs_ativacao WHERE licenca_id = ? ORDER BY criado_em DESC LIMIT 50'
  ).all(req.params.id)

  res.json({ ok: true, licenca, logs })
})

// ── POST /admin/licencas ─────────────────────────────────────────────────────
router.post('/licencas', async (req: Request, res: Response) => {
  const { plano, email, nome, notas, enviar_email } = req.body as {
    plano?: string
    email?: string
    nome?: string
    notas?: string
    enviar_email?: boolean
  }

  if (!plano || !['mensal', 'anual', 'vitalicio'].includes(plano)) {
    res.status(400).json({ ok: false, erro: 'Plano inválido.' })
    return
  }

  const db = getDb()
  const chave = gerarChave()
  const expiraEm = calcularExpiracao(plano)
  const id = uuidv4()

  db.prepare(
    `INSERT INTO licencas (id, chave, plano, email, nome, status, expira_em, notas, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?, datetime('now'), datetime('now'))`
  ).run(id, chave, plano, email ?? null, nome ?? null, expiraEm ?? null, notas ?? null)

  if (enviar_email && email && nome) {
    try {
      await enviarChaveLicenca({ email, nome, chave, plano, expiraEm })
    } catch (err) {
      console.error('[Admin] Erro ao enviar email:', err)
    }
  }

  res.json({ ok: true, id, chave, plano, expira_em: expiraEm })
})

// ── PATCH /admin/licencas/:id ────────────────────────────────────────────────
router.patch('/licencas/:id', (req: Request, res: Response) => {
  const db = getDb()
  const existe = db.prepare('SELECT id FROM licencas WHERE id = ?').get(req.params.id)
  if (!existe) {
    res.status(404).json({ ok: false, erro: 'Licença não encontrada.' })
    return
  }

  const { notas, email, nome, expira_em } = req.body as Record<string, string>

  db.prepare(
    `UPDATE licencas SET
      notas     = COALESCE(?, notas),
      email     = COALESCE(?, email),
      nome      = COALESCE(?, nome),
      expira_em = COALESCE(?, expira_em),
      atualizado_em = datetime('now')
     WHERE id = ?`
  ).run(notas ?? null, email ?? null, nome ?? null, expira_em ?? null, req.params.id)

  res.json({ ok: true })
})

// ── POST /admin/licencas/:id/revogar ────────────────────────────────────────
router.post('/licencas/:id/revogar', (req: Request, res: Response) => {
  const db = getDb()
  const existe = db.prepare('SELECT id FROM licencas WHERE id = ?').get(req.params.id)
  if (!existe) {
    res.status(404).json({ ok: false, erro: 'Licença não encontrada.' })
    return
  }

  const { motivo } = req.body as { motivo?: string }

  db.prepare(
    `UPDATE licencas SET status = 'revogada', notas = ?, atualizado_em = datetime('now') WHERE id = ?`
  ).run(motivo ? `[REVOGADA] ${motivo}` : '[REVOGADA]', req.params.id)

  res.json({ ok: true })
})

// ── POST /admin/licencas/:id/reativar ───────────────────────────────────────
router.post('/licencas/:id/reativar', (req: Request, res: Response) => {
  const db = getDb()
  db.prepare(
    `UPDATE licencas SET status = 'ativa', hardware_id = NULL, atualizado_em = datetime('now') WHERE id = ?`
  ).run(req.params.id)
  res.json({ ok: true })
})

// ── POST /admin/licencas/:id/resetar-dispositivo ────────────────────────────
router.post('/licencas/:id/resetar-dispositivo', (req: Request, res: Response) => {
  const db = getDb()
  db.prepare(
    `UPDATE licencas SET hardware_id = NULL, atualizado_em = datetime('now') WHERE id = ?`
  ).run(req.params.id)
  res.json({ ok: true, mensagem: 'Hardware ID removido. A licença pode ser ativada em novo dispositivo.' })
})

// ── GET /admin/stats ─────────────────────────────────────────────────────────
router.get('/stats', (req: Request, res: Response) => {
  const db = getDb()

  const total     = (db.prepare("SELECT COUNT(*) as n FROM licencas").get() as { n: number }).n
  const ativas    = (db.prepare("SELECT COUNT(*) as n FROM licencas WHERE status = 'ativa'").get() as { n: number }).n
  const revogadas = (db.prepare("SELECT COUNT(*) as n FROM licencas WHERE status = 'revogada'").get() as { n: number }).n
  const pendentes = (db.prepare("SELECT COUNT(*) as n FROM licencas WHERE status = 'pendente'").get() as { n: number }).n
  const porPlano  = db.prepare("SELECT plano, COUNT(*) as n FROM licencas GROUP BY plano").all() as { plano: string; n: number }[]
  const receita   = db.prepare("SELECT SUM(valor_centavos) as total FROM pagamentos WHERE status = 'aprovado'").get() as { total: number | null }
  const vendas30d = (db.prepare(
    `SELECT COUNT(*) as n FROM pagamentos WHERE status = 'aprovado' AND criado_em >= datetime('now', '-30 days')`
  ).get() as { n: number }).n
  const ultimasLicencas = db.prepare('SELECT * FROM licencas ORDER BY criado_em DESC LIMIT 10').all()

  res.json({
    ok: true,
    stats: { total, ativas, revogadas, pendentes, porPlano, receita_total_centavos: receita.total ?? 0, vendas_30d: vendas30d },
    ultimasLicencas,
  })
})

export default router
