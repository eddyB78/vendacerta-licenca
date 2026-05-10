import { Router } from 'express'
import type { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb, dbRun, dbGet } from '../db.js'
import { assinarToken, verificarToken } from '../utils/jwt.js'
import { validarFormatoChave } from '../utils/chave.js'

const router = Router()

// ── POST /licenca/ativar ────────────────────────────────────────────────────
router.post('/ativar', async (req: Request, res: Response) => {
  try {
    const { chave, hardware_id } = req.body as { chave?: string; hardware_id?: string }

    if (!chave || !hardware_id) {
      res.status(400).json({ ok: false, erro: 'Parâmetros inválidos.' }); return
    }
    if (!validarFormatoChave(chave)) {
      res.status(400).json({ ok: false, erro: 'Formato de chave inválido.' }); return
    }

    const db = getDb()
    const licenca = await dbGet(db, 'SELECT * FROM licencas WHERE chave = ?', chave) as unknown as {
      id: string; chave: string; plano: string; status: string
      hardware_id: string | null; expira_em: string | null
    } | null

    if (!licenca) {
      res.status(404).json({ ok: false, erro: 'Chave não encontrada.' }); return
    }
    if (licenca.status === 'revogada' || licenca.status === 'inativa') {
      res.status(403).json({ ok: false, erro: 'Esta chave foi revogada.' }); return
    }
    if (licenca.hardware_id && licenca.hardware_id !== hardware_id) {
      await dbRun(db,
        `INSERT INTO logs_ativacao (id, licenca_id, tipo, hardware_id, ip, detalhes, criado_em)
         VALUES (?, ?, 'ativacao_bloqueada', ?, ?, ?, datetime('now'))`,
        uuidv4(), licenca.id, hardware_id, req.ip ?? '', 'Hardware ID diferente do registrado'
      )
      res.status(403).json({ ok: false, erro: 'Chave já ativada em outro dispositivo.' }); return
    }
    if (licenca.expira_em && new Date(String(licenca.expira_em)) < new Date()) {
      res.status(403).json({ ok: false, erro: 'Chave expirada. Renove sua licença.' }); return
    }

    if (!licenca.hardware_id) {
      await dbRun(db,
        `UPDATE licencas SET hardware_id=?, status='ativa', ativado_em=datetime('now'), atualizado_em=datetime('now') WHERE id=?`,
        hardware_id, licenca.id
      )
    }

    const token = await assinarToken({
      chave: String(licenca.chave), plano: String(licenca.plano),
      hardware_id, expira_em: licenca.expira_em ? String(licenca.expira_em) : null
    })
    await dbRun(db,
      `INSERT INTO logs_ativacao (id, licenca_id, tipo, hardware_id, ip, criado_em) VALUES (?, ?, 'ativacao_ok', ?, ?, datetime('now'))`,
      uuidv4(), licenca.id, hardware_id, req.ip ?? ''
    )

    res.json({ ok: true, token, plano: licenca.plano, expira_em: licenca.expira_em })
  } catch (err) {
    console.error('[/ativar]', err)
    res.status(500).json({ ok: false, erro: 'Erro interno do servidor.' })
  }
})

// ── POST /licenca/verificar ─────────────────────────────────────────────────
router.post('/verificar', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) { res.status(401).json({ ok: false, erro: 'Token não fornecido.' }); return }

    const { chave, hardware_id } = req.body as { chave?: string; hardware_id?: string }

    let payload
    try { payload = await verificarToken(token) }
    catch { res.status(401).json({ ok: false, erro: 'Token inválido.' }); return }

    if (payload.hardware_id !== hardware_id || payload.chave !== chave) {
      res.status(403).json({ ok: false, erro: 'Dados não correspondem ao token.' }); return
    }

    const db = getDb()
    const licenca = await dbGet(db, 'SELECT * FROM licencas WHERE chave = ?', chave) as unknown as {
      id: string; chave: string; plano: string; status: string; expira_em: string | null
    } | null

    if (!licenca || licenca.status === 'revogada') {
      res.status(403).json({ ok: false, erro: 'Licença revogada.' }); return
    }
    if (licenca.expira_em && new Date(String(licenca.expira_em)) < new Date()) {
      res.status(403).json({ ok: false, erro: 'Licença expirada.' }); return
    }

    const novoToken = await assinarToken({
      chave: String(licenca.chave), plano: String(licenca.plano),
      hardware_id: hardware_id ?? '', expira_em: licenca.expira_em ? String(licenca.expira_em) : null
    })
    await dbRun(db,
      `INSERT INTO logs_ativacao (id, licenca_id, tipo, hardware_id, ip, criado_em) VALUES (?, ?, 'verificacao_ok', ?, ?, datetime('now'))`,
      uuidv4(), licenca.id, hardware_id ?? '', req.ip ?? ''
    )

    res.json({ ok: true, status: 'ativa', plano: licenca.plano, expira_em: licenca.expira_em, token: novoToken })
  } catch (err) {
    console.error('[/verificar]', err)
    res.status(500).json({ ok: false, erro: 'Erro interno do servidor.' })
  }
})

export default router
