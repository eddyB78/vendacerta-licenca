import { createHash, createPrivateKey, sign } from 'node:crypto'
import type { Client } from '@libsql/client'
import { dbAll, dbGet } from './db.js'
import { modulosDoPacote, pacotePremiumId } from './premium-db.js'

const validadeOffline = 24 * 60 * 60

export async function emitirAutorizacaoPremium(db: Client, chave: string, instalacao: string) {
  const chavePrivada = process.env.PREMIUM_PRIVATE_KEY
  if (!chavePrivada) return null

  try {
    const licenca = await dbGet(db, `
      SELECT l.id, l.expira_em, c.id AS cliente_id
      FROM licencas l LEFT JOIN clientes_premium c ON c.licenca_id = l.id
      WHERE l.chave = ? AND l.hardware_id = ? AND l.status = 'ativa'
    `, chave, instalacao)
    if (!licenca) return null

    const agora = Math.floor(Date.now() / 1000)
    const fimLicenca = licenca.expira_em === null
      ? Infinity : Math.floor(Date.parse(String(licenca.expira_em)) / 1000)
    if (!(fimLicenca > agora)) return null

    const exp = Math.min(agora + validadeOffline, fimLicenca)
    const direitos = licenca.cliente_id ? await dbAll(db, `
      SELECT d.modulo_id, d.expira_em FROM direitos_premium d
      JOIN modulos_premium m ON m.id = d.modulo_id
      WHERE d.cliente_id = ? AND d.status = 'ativo' AND m.ativo = 1
        AND (d.expira_em IS NULL OR julianday(d.expira_em) > julianday('now'))
      ORDER BY d.modulo_id
    `, licenca.cliente_id) : []
    const validadePorModulo = new Map<string, number>()
    for (const direito of direitos) {
      const id = String(direito.modulo_id)
      const fim = direito.expira_em === null ? exp
        : Math.min(exp, Math.floor(Date.parse(String(direito.expira_em)) / 1000))
      if (!(fim > agora)) continue
      const incluidos = id === pacotePremiumId ? [id, ...modulosDoPacote] : [id]
      for (const modulo of incluidos) {
        validadePorModulo.set(modulo, Math.max(fim, validadePorModulo.get(modulo) ?? 0))
      }
    }
    const modulos = [...validadePorModulo].map(([id, exp]) => ({ id, exp }))

    const payload = Buffer.from(JSON.stringify({
      v: 1, aud: 'vendacerta-pdv-premium', iat: agora, exp,
      licenca_id: String(licenca.id), cliente_id: licenca.cliente_id,
      licenca_hash: createHash('sha256').update(chave).digest('base64url'),
      instalacao, modulos,
    })).toString('base64url')
    const key = createPrivateKey({
      key: Buffer.from(chavePrivada, 'base64url'), format: 'der', type: 'pkcs8',
    })
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Chave premium deve ser Ed25519.')
    return payload + '.' + sign(null, Buffer.from(payload), key).toString('base64url')
  } catch (erro) {
    console.error('[licenca/premium] Falha na emissão:', erro instanceof Error ? erro.name : 'erro')
    return null
  }
}
