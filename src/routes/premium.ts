import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import { dbAll, getDb } from '../db.js'

const router = Router()
const modelos = ['mensal', 'anual', 'permanente']
const padraoId = /^[a-z][a-z0-9_]{2,63}$/
const moedas = new Set(Intl.supportedValuesOf('currency').filter(moeda =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda })
    .resolvedOptions().maximumFractionDigits === 2
))

class Erro extends Error {
  constructor(readonly status: number, mensagem: string) { super(mensagem) }
}

function rota(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res)
    } catch (erro) {
      if (erro instanceof Erro) {
        res.status(erro.status).json({ ok: false, erro: erro.message })
      } else {
        console.error('[premium]', erro)
        res.status(500).json({ ok: false, erro: 'Não foi possível concluir a operação.' })
      }
    }
  }
}

function texto(valor: unknown, campo: string, limite: number, obrigatorio = true): string {
  if (typeof valor !== 'string' || valor.trim().length > limite || (obrigatorio && !valor.trim())) {
    throw new Erro(400, campo + ' inválido.')
  }
  return valor.trim()
}

function booleano(valor: unknown, campo: string): number {
  if (typeof valor !== 'boolean') throw new Erro(400, campo + ' inválido.')
  return Number(valor)
}

function vencimento(modelo: string, base: Date): string | null {
  if (modelo === 'permanente') return null
  const data = new Date(base)
  const dia = data.getUTCDate()
  data.setUTCDate(1)
  data.setUTCMonth(data.getUTCMonth() + (modelo === 'mensal' ? 1 : 12))
  const ultimoDia = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 0)).getUTCDate()
  data.setUTCDate(Math.min(dia, ultimoDia))
  return data.toISOString()
}

router.get('/modulos', rota(async (_req, res) => {
  const db = getDb()
  const modulos = await dbAll(db, 'SELECT * FROM modulos_premium ORDER BY nome, id')
  const ofertas = await dbAll(db, 'SELECT * FROM ofertas_premium')
  res.json({ ok: true, modulos, ofertas })
}))

router.put('/modulos/:id', rota(async (req, res) => {
  const id = String(req.params.id)
  if (!padraoId.test(id)) throw new Erro(400, 'Use um identificador de 3 a 64 caracteres com letras minúsculas, números e sublinhados.')
  const nome = texto(req.body?.nome, 'Nome', 120)
  const descricao = texto(req.body?.descricao, 'Descrição', 2000, false)
  const versao = texto(req.body?.versao, 'Versão', 40)
  const ativo = booleano(req.body?.ativo, 'Status')
  const ofertas = req.body?.ofertas
  if (!Array.isArray(ofertas) || ofertas.length !== modelos.length ||
      !modelos.every(modelo => ofertas.some(oferta => oferta?.modelo === modelo))) {
    throw new Erro(400, 'Informe as três ofertas comerciais.')
  }

  await getDb().batch([
    {
      sql: `INSERT INTO modulos_premium VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, descricao=excluded.descricao,
            versao=excluded.versao, ativo=excluded.ativo`,
      args: [id, nome, descricao, versao, ativo],
    },
    ...ofertas.map(oferta => {
      const { modelo, preco_centavos, moeda, disponivel } = oferta
      if (!Number.isSafeInteger(preco_centavos) || preco_centavos < 0 || !moedas.has(moeda) ||
          (disponivel === true && preco_centavos === 0)) {
        throw new Erro(400, 'Informe moeda com duas casas decimais e preço positivo para cada oferta disponível.')
      }
      return {
        sql: `INSERT INTO ofertas_premium VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(modulo_id, modelo) DO UPDATE SET preco_centavos=excluded.preco_centavos,
              moeda=excluded.moeda, disponivel=excluded.disponivel`,
        args: [id, modelo, preco_centavos, moeda, booleano(disponivel, 'Disponibilidade')],
      }
    }),
  ], 'write')
  res.json({ ok: true })
}))

router.get('/clientes', rota(async (_req, res) => {
  const clientes = await dbAll(getDb(), `SELECT c.*, l.email AS email_licenca
    FROM clientes_premium c LEFT JOIN licencas l ON l.id=c.licenca_id ORDER BY c.nome, c.id`)
  const licencas_disponiveis = await dbAll(getDb(), `
    SELECT l.id, l.nome, l.email
    FROM licencas l
    WHERE l.status = 'ativa' AND (l.expira_em IS NULL OR julianday(l.expira_em) > julianday('now'))
      AND NOT EXISTS (SELECT 1 FROM clientes_premium c WHERE c.licenca_id=l.id)
    ORDER BY l.nome, l.email, l.id
  `)
  res.json({ ok: true, clientes, licencas_disponiveis })
}))

router.post('/clientes', rota(async (req, res) => {
  const nome = texto(req.body?.nome, 'Nome', 120)
  const email = texto(req.body?.email, 'E-mail', 254)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Erro(400, 'E-mail inválido.')
  const licencaId = req.body?.licenca_id == null ? null : texto(req.body.licenca_id, 'Licença', 80)
  const id = randomUUID()
  const resultado = await getDb().execute({
    sql: `INSERT INTO clientes_premium (id, nome, email, licenca_id)
          SELECT ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM licencas WHERE id=?)
          ON CONFLICT(licenca_id) DO NOTHING`,
    args: [id, nome, email, licencaId, licencaId, licencaId],
  })
  if (!resultado.rowsAffected) throw new Erro(409, 'Selecione uma licença existente e ainda sem vínculo.')
  res.status(201).json({ ok: true, id })
}))

router.get('/direitos', rota(async (req, res) => {
  const cliente = texto(req.query.cliente_id ?? '', 'Cliente', 80, false)
  const direitos = await dbAll(getDb(), `
    SELECT d.*, c.nome AS cliente_nome, m.nome AS modulo_nome,
      CASE WHEN d.status <> 'ativo' THEN d.status
           WHEN d.expira_em IS NOT NULL AND d.expira_em <= ? THEN 'expirado'
           WHEN m.ativo = 0 THEN 'modulo_desativado'
           ELSE 'ativo' END AS situacao
    FROM direitos_premium d JOIN clientes_premium c ON c.id=d.cliente_id
    JOIN modulos_premium m ON m.id=d.modulo_id
    WHERE (? = '' OR d.cliente_id = ?) ORDER BY c.nome, m.nome
  `, new Date().toISOString(), cliente, cliente)
  res.json({ ok: true, direitos })
}))

router.get('/direitos/:id/auditoria', rota(async (req, res) => {
  const eventos = await dbAll(getDb(), `SELECT acao, motivo, dados_json, criado_em
    FROM auditoria_premium WHERE direito_id=? ORDER BY criado_em DESC, id DESC`, req.params.id)
  res.json({ ok: true, eventos })
}))

router.post('/direitos', rota(async (req, res) => {
  const cliente = req.body?.cliente_id == null ? null : texto(req.body.cliente_id, 'Cliente', 80)
  const licenca = req.body?.licenca_id == null ? null : texto(req.body.licenca_id, 'Licença', 80)
  if (Boolean(cliente) === Boolean(licenca)) throw new Erro(400, 'Selecione um cliente ou uma licença.')
  const modulo = texto(req.body?.modulo_id, 'Módulo', 64)
  const modelo = texto(req.body?.modelo, 'Modelo comercial', 20)
  if (!modelos.includes(modelo)) throw new Erro(400, 'Modelo comercial inválido.')
  const motivo = texto(req.body?.motivo, 'Motivo', 500)
  const id = randomUUID()
  const agora = new Date()
  const inicio = agora.toISOString()
  const expira = vencimento(modelo, agora)

  const vinculo = licenca ? [{
    sql: `INSERT INTO clientes_premium (id, nome, email, licenca_id)
          SELECT ?, COALESCE(NULLIF(TRIM(l.nome), ''), NULLIF(TRIM(l.email), ''), 'Licença ' || l.id),
                 COALESCE(l.email, ''), l.id
          FROM licencas l
          WHERE l.id=? AND l.status='ativa'
            AND (l.expira_em IS NULL OR julianday(l.expira_em) > julianday('now'))
            AND EXISTS (SELECT 1 FROM ofertas_premium o JOIN modulos_premium m ON m.id=o.modulo_id
                        WHERE o.modulo_id=? AND o.modelo=? AND o.disponivel=1 AND m.ativo=1)
          ON CONFLICT(licenca_id) DO NOTHING`,
    args: [randomUUID(), licenca, modulo, modelo],
  }] : []

  const resultados = await getDb().batch([
    ...vinculo,
    {
      sql: `INSERT INTO direitos_premium
            (id, cliente_id, modulo_id, modelo, status, inicio_em, expira_em, preco_centavos, moeda)
            SELECT ?, c.id, o.modulo_id, o.modelo, 'ativo', ?, ?, o.preco_centavos, o.moeda
            FROM ofertas_premium o JOIN modulos_premium m ON m.id=o.modulo_id
            JOIN clientes_premium c ON (c.id=? OR c.licenca_id=?)
            WHERE o.modulo_id=? AND o.modelo=? AND o.disponivel=1 AND m.ativo=1
              AND (? IS NULL OR EXISTS (
                SELECT 1 FROM licencas l WHERE l.id=? AND l.status='ativa'
                  AND (l.expira_em IS NULL OR julianday(l.expira_em) > julianday('now'))
              ))
            ON CONFLICT(cliente_id, modulo_id) WHERE status <> 'revogado' DO NOTHING`,
      args: [id, inicio, expira, cliente, licenca, modulo, modelo, licenca, licenca],
    },
    evento(id, 'concessao', motivo, inicio, 0),
  ], 'write')

  if (!resultados[vinculo.length].rowsAffected) {
    throw new Erro(409, 'Verifique cliente, disponibilidade da oferta e se já existe um direito para este módulo.')
  }
  res.status(201).json({ ok: true, id })
}))

function evento(id: string, acao: string, motivo: string, agora: string, revisao: number) {
  return {
    sql: `INSERT INTO auditoria_premium (id, direito_id, acao, motivo, dados_json, criado_em)
          SELECT ?, id, ?, ?, json_object('status', status, 'modelo', modelo, 'expira_em', expira_em,
                 'preco_centavos', preco_centavos, 'moeda', moeda, 'revisao', revisao), ?
          FROM direitos_premium WHERE id=? AND revisao=? AND changes()=1`,
    args: [randomUUID(), acao, motivo, agora, id, revisao],
  }
}

router.post('/direitos/:id/acoes', rota(async (req, res) => {
  const id = String(req.params.id)
  const acao = req.body?.acao
  const revisao = req.body?.revisao
  const motivo = texto(req.body?.motivo, 'Motivo', 500)
  if (!['renovar', 'suspender', 'revogar', 'reativar'].includes(acao) ||
      !Number.isSafeInteger(revisao) || revisao < 0) {
    throw new Erro(400, 'Ação ou revisão inválida.')
  }

  const db = getDb()
  const [direito] = await dbAll(db, 'SELECT status, modelo, expira_em, revisao FROM direitos_premium WHERE id=?', id)
  if (!direito) throw new Erro(404, 'Direito não encontrado.')
  if (direito.revisao !== revisao) throw new Erro(409, 'O direito foi alterado. Atualize a lista.')
  if (direito.status === 'revogado') throw new Erro(409, 'O direito já foi revogado.')

  const agora = new Date().toISOString()
  let expira = direito.expira_em as string | null
  let status = String(direito.status)

  switch (acao) {
    case 'renovar':
      if (!expira) throw new Erro(409, 'A licença permanente não possui renovação.')
      expira = vencimento(String(direito.modelo), new Date(expira > agora ? expira : agora))
      break
    case 'suspender':
      if (status !== 'ativo') throw new Erro(409, 'Somente um direito ativo pode ser suspenso.')
      status = 'suspenso'
      break
    case 'reativar':
      if (status !== 'suspenso' || (expira && expira <= agora)) {
        throw new Erro(409, 'O direito precisa estar suspenso e dentro da validade.')
      }
      status = 'ativo'
      break
    case 'revogar':
      status = 'revogado'
      break
  }

  const [resultado] = await db.batch([
    {
      sql: 'UPDATE direitos_premium SET status=?, expira_em=?, revisao=revisao+1 WHERE id=? AND revisao=?',
      args: [status, expira, id, revisao],
    },
    evento(id, acao, motivo, agora, revisao + 1),
  ], 'write')
  if (!resultado.rowsAffected) throw new Erro(409, 'O direito foi alterado. Atualize a lista.')
  res.json({ ok: true })
}))

export default router
