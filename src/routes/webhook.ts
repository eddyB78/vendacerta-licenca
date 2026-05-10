import { Router } from 'express'
import type { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago'
import { getDb } from '../db.js'
import { gerarChave, calcularExpiracao } from '../utils/chave.js'
import { enviarChaveLicenca } from '../utils/email.js'

const router = Router()

// Planos disponíveis e seus preços em centavos
const PLANOS: Record<string, { preco: number; nome: string }> = {
  mensal:    { preco: parseInt(process.env.PRECO_MENSAL  ?? '4990'),  nome: 'Plano Mensal VendaCerta PDV' },
  anual:     { preco: parseInt(process.env.PRECO_ANUAL   ?? '39900'), nome: 'Plano Anual VendaCerta PDV' },
  vitalicio: { preco: parseInt(process.env.PRECO_VITALICIO ?? '99900'), nome: 'Plano Vitalício VendaCerta PDV' },
}

// ── GET /comprar?plano=mensal ────────────────────────────────────────────────
// Redireciona para o checkout do Mercado Pago
router.get('/comprar', async (req: Request, res: Response) => {
  try {
    const plano = (req.query.plano as string) ?? 'mensal'
    const infoPlano = PLANOS[plano]

    if (!infoPlano) {
      res.status(400).json({ erro: 'Plano inválido. Use: mensal, anual, vitalicio' })
      return
    }

    const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN ?? '' })
    const preference = new Preference(mp)

    const pref = await preference.create({
      body: {
        items: [{
          id: `vendacerta-${plano}`,
          title: infoPlano.nome,
          quantity: 1,
          unit_price: infoPlano.preco / 100,
          currency_id: 'BRL',
        }],
        back_urls: {
          success: `${process.env.SERVER_URL}/pagamento/sucesso`,
          failure: `${process.env.SERVER_URL}/pagamento/falha`,
          pending: `${process.env.SERVER_URL}/pagamento/pendente`,
        },
        auto_return: 'approved',
        notification_url: `${process.env.SERVER_URL}/webhook/mercadopago`,
        metadata: { plano },
        payment_methods: {
          excluded_payment_types: [],
          installments: plano === 'vitalicio' ? 12 : 1,
        },
        expires: false,
      }
    })

    if (pref.init_point) {
      res.redirect(pref.init_point)
    } else {
      res.status(500).json({ erro: 'Erro ao criar preferência de pagamento.' })
    }
  } catch (err) {
    console.error('[/comprar]', err)
    res.status(500).json({ erro: 'Erro ao processar solicitação.' })
  }
})

// ── POST /webhook/mercadopago ────────────────────────────────────────────────
// Recebe notificações do Mercado Pago
router.post('/webhook/mercadopago', async (req: Request, res: Response) => {
  // Responde imediatamente para o MP não retentar
  res.sendStatus(200)

  try {
    const { type, data } = req.body as { type?: string; data?: { id?: string } }

    // Só processa pagamentos aprovados
    if (type !== 'payment' || !data?.id) return

    const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN ?? '' })
    const paymentClient = new Payment(mp)
    const pagamento = await paymentClient.get({ id: String(data.id) })

    if (pagamento.status !== 'approved') return

    const db = getDb()

    // Evita processar o mesmo pagamento duas vezes
    const existente = db.prepare('SELECT id FROM pagamentos WHERE mp_pagamento_id = ?').get(String(data.id))
    if (existente) return

    const plano = (pagamento.metadata?.plano as string) ?? 'mensal'
    const emailPagador = pagamento.payer?.email ?? ''
    const nomePagador = pagamento.payer?.first_name
      ? `${pagamento.payer.first_name} ${pagamento.payer.last_name ?? ''}`.trim()
      : emailPagador

    const valorCentavos = Math.round((pagamento.transaction_amount ?? 0) * 100)

    // Gera a chave de licença
    const chave = gerarChave()
    const expiraEm = calcularExpiracao(plano)
    const licencaId = uuidv4()
    const pagamentoId = uuidv4()

    // Salva licença no banco
    db.prepare(`
      INSERT INTO licencas (id, chave, plano, email, nome, status, expira_em, criado_em, atualizado_em, mp_pagamento_id)
      VALUES (?, ?, ?, ?, ?, 'pendente', ?, datetime('now'), datetime('now'), ?)
    `).run(licencaId, chave, plano, emailPagador, nomePagador, expiraEm, String(data.id))

    // Salva registro do pagamento
    db.prepare(`
      INSERT INTO pagamentos (id, licenca_id, mp_pagamento_id, plano, valor_centavos, status, email_pagador, nome_pagador, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, 'aprovado', ?, ?, datetime('now'), datetime('now'))
    `).run(pagamentoId, licencaId, String(data.id), plano, valorCentavos, emailPagador, nomePagador)

    console.log(`[Webhook] Pagamento aprovado — ${plano} — ${emailPagador} — chave: ${chave}`)

    // Envia email com a chave
    if (emailPagador) {
      await enviarChaveLicenca({
        email: emailPagador,
        nome: nomePagador,
        chave,
        plano,
        expiraEm,
      })
      console.log(`[Webhook] Email enviado para ${emailPagador}`)
    }
  } catch (err) {
    console.error('[Webhook] Erro ao processar:', err)
  }
})

// ── GET /pagamento/sucesso ───────────────────────────────────────────────────
router.get('/pagamento/sucesso', (_req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Pagamento aprovado — VendaCerta</title>
      <style>
        body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f0fdf4; margin: 0; }
        .card { background: white; border-radius: 20px; padding: 48px; text-align: center; max-width: 460px; box-shadow: 0 8px 40px rgba(0,0,0,.1); }
        .icon { font-size: 64px; margin-bottom: 16px; }
        h1 { color: #15803d; margin: 0 0 8px; }
        p { color: #64748b; line-height: 1.6; }
        .note { background: #f0fdf4; border-radius: 12px; padding: 16px; margin-top: 24px; color: #166534; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">✅</div>
        <h1>Pagamento aprovado!</h1>
        <p>Obrigado pela sua compra. Sua chave de licença foi enviada para o seu email.</p>
        <div class="note">
          📧 Verifique sua caixa de entrada e também a pasta de spam.<br/><br/>
          Dúvidas? Contate <strong>${process.env.SMTP_USER ?? 'suporte@vendacerta.com.br'}</strong>
        </div>
      </div>
    </body>
    </html>
  `)
})

router.get('/pagamento/pendente', (_req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Pagamento pendente — VendaCerta</title>
      <style>
        body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fffbeb; margin: 0; }
        .card { background: white; border-radius: 20px; padding: 48px; text-align: center; max-width: 460px; box-shadow: 0 8px 40px rgba(0,0,0,.1); }
        .icon { font-size: 64px; margin-bottom: 16px; }
        h1 { color: #d97706; margin: 0 0 8px; }
        p { color: #64748b; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">⏳</div>
        <h1>Pagamento em análise</h1>
        <p>Seu pagamento está sendo processado. Assim que aprovado, você receberá a chave de licença por email.</p>
      </div>
    </body>
    </html>
  `)
})

router.get('/pagamento/falha', (_req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Pagamento não aprovado — VendaCerta</title>
      <style>
        body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fef2f2; margin: 0; }
        .card { background: white; border-radius: 20px; padding: 48px; text-align: center; max-width: 460px; box-shadow: 0 8px 40px rgba(0,0,0,.1); }
        .icon { font-size: 64px; margin-bottom: 16px; }
        h1 { color: #dc2626; margin: 0 0 8px; }
        p { color: #64748b; line-height: 1.6; }
        a { color: #2563eb; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">❌</div>
        <h1>Pagamento não aprovado</h1>
        <p>Houve um problema com seu pagamento. <a href="${process.env.SERVER_URL ?? ''}/comprar">Tente novamente</a> ou contate o suporte.</p>
      </div>
    </body>
    </html>
  `)
})

export default router
