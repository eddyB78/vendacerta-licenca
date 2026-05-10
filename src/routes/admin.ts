import { Router } from 'express'
import type { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb, dbRun, dbAll, dbGet } from '../db.js'
import { gerarChave, calcularExpiracao } from '../utils/chave.js'
import { adminAuth } from '../middleware/adminAuth.js'
import { enviarChaveLicenca } from '../utils/email.js'

const router = Router()
router.use(adminAuth)

router.get('/licencas', async (req: Request, res: Response) => {
  const db = getDb()
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const plano  = typeof req.query.plano  === 'string' ? req.query.plano  : undefined
  const q      = typeof req.query.q      === 'string' ? req.query.q      : undefined

  let sql = 'SELECT * FROM licencas WHERE 1=1'
  const params: string[] = []
  if (status) { sql += ' AND status = ?'; params.push(status) }
  if (plano)  { sql += ' AND plano = ?';  params.push(plano) }
  if (q) { sql += ' AND (chave LIKE ? OR email LIKE ? OR nome LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  sql += ' ORDER BY criado_em DESC LIMIT 200'

  const licencas = await dbAll(db, sql, ...params)
  res.json({ ok: true, licencas })
})

router.get('/licencas/:id', async (req: Request, res: Response) => {
  const db = getDb()
  const licenca = await dbGet(db, 'SELECT * FROM licencas WHERE id = ?', req.params.id)
  if (!licenca) { res.status(404).json({ ok: false, erro: 'Licença não encontrada.' }); return }
  const logs = await dbAll(db, 'SELECT * FROM logs_ativacao WHERE licenca_id = ? ORDER BY criado_em DESC LIMIT 50', req.params.id)
  res.json({ ok: true, licenca, logs })
})

router.post('/licencas', async (req: Request, res: Response) => {
  const { plano, email, nome, notas, enviar_email } = req.body as {
    plano?: string; email?: string; nome?: string; notas?: string; enviar_email?: boolean
  }
  if (!plano || !['mensal', 'anual', 'vitalicio'].includes(plano)) {
    res.status(400).json({ ok: false, erro: 'Plano inválido.' }); return
  }

  const db = getDb()
  const chave = gerarChave()
  const expiraEm = calcularExpiracao(plano)
  const id = uuidv4()

  await dbRun(db,
    `INSERT INTO licencas (id, chave, plano, email, nome, status, expira_em, notas, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?, datetime('now'), datetime('now'))`,
    id, chave, plano, email ?? null, nome ?? null, expiraEm ?? null, notas ?? null
  )

  if (enviar_email && email && nome) {
    try { await enviarChaveLicenca({ email, nome, chave, plano, expiraEm }) }
    catch (err) { console.error('[Admin] Erro ao enviar email:', err) }
  }

  res.json({ ok: true, id, chave, plano, expira_em: expiraEm })
})

router.patch('/licencas/:id', async (req: Request, res: Response) => {
  const db = getDb()
  if (!await dbGet(db, 'SELECT id FROM licencas WHERE id = ?', req.params.id)) {
    res.status(404).json({ ok: false, erro: 'Licença não encontrada.' }); return
  }
  const { notas, email, nome, expira_em } = req.body as Record<string, string | undefined>
  await dbRun(db,
    `UPDATE licencas SET notas=COALESCE(?,notas), email=COALESCE(?,email), nome=COALESCE(?,nome),
     expira_em=COALESCE(?,expira_em), atualizado_em=datetime('now') WHERE id=?`,
    notas ?? null, email ?? null, nome ?? null, expira_em ?? null, req.params.id
  )
  res.json({ ok: true })
})

router.post('/licencas/:id/revogar', async (req: Request, res: Response) => {
  const db = getDb()
  if (!await dbGet(db, 'SELECT id FROM licencas WHERE id = ?', req.params.id)) {
    res.status(404).json({ ok: false, erro: 'Licença não encontrada.' }); return
  }
  const { motivo } = req.body as { motivo?: string }
  await dbRun(db,
    `UPDATE licencas SET status='revogada', notas=?, atualizado_em=datetime('now') WHERE id=?`,
    motivo ? `[REVOGADA] ${motivo}` : '[REVOGADA]', req.params.id
  )
  res.json({ ok: true })
})

router.post('/licencas/:id/reativar', async (req: Request, res: Response) => {
  const db = getDb()
  await dbRun(db, `UPDATE licencas SET status='ativa', hardware_id=NULL, atualizado_em=datetime('now') WHERE id=?`, req.params.id)
  res.json({ ok: true })
})

router.post('/licencas/:id/resetar-dispositivo', async (req: Request, res: Response) => {
  const db = getDb()
  await dbRun(db, `UPDATE licencas SET hardware_id=NULL, atualizado_em=datetime('now') WHERE id=?`, req.params.id)
  res.json({ ok: true, mensagem: 'Hardware ID removido.' })
})

router.get('/stats', async (_req: Request, res: Response) => {
  const db = getDb()
  const total     = (await dbGet(db, "SELECT COUNT(*) as n FROM licencas") as { n: number }).n
  const ativas    = (await dbGet(db, "SELECT COUNT(*) as n FROM licencas WHERE status='ativa'") as { n: number }).n
  const revogadas = (await dbGet(db, "SELECT COUNT(*) as n FROM licencas WHERE status='revogada'") as { n: number }).n
  const pendentes = (await dbGet(db, "SELECT COUNT(*) as n FROM licencas WHERE status='pendente'") as { n: number }).n
  const porPlano  = await dbAll(db, "SELECT plano, COUNT(*) as n FROM licencas GROUP BY plano")
  const receita   = await dbGet(db, "SELECT SUM(valor_centavos) as total FROM pagamentos WHERE status='aprovado'") as { total: number | null }
  const vendas30d = (await dbGet(db, `SELECT COUNT(*) as n FROM pagamentos WHERE status='aprovado' AND criado_em>=datetime('now','-30 days')`) as { n: number }).n
  const ultimasLicencas = await dbAll(db, 'SELECT * FROM licencas ORDER BY criado_em DESC LIMIT 10')

  res.json({
    ok: true,
    stats: { total, ativas, revogadas, pendentes, porPlano, receita_total_centavos: receita?.total ?? 0, vendas_30d: vendas30d },
    ultimasLicencas,
  })
})

export default router
