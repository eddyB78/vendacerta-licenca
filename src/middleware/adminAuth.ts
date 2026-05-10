import type { Request, Response, NextFunction } from 'express'

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const adminToken = process.env.ADMIN_TOKEN
  if (!adminToken) {
    res.status(500).json({ ok: false, erro: 'ADMIN_TOKEN não configurado no servidor.' })
    return
  }

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token || token !== adminToken) {
    res.status(401).json({ ok: false, erro: 'Não autorizado.' })
    return
  }

  next()
}
