import { Resend } from 'resend'

export async function enviarChaveLicenca(params: {
  email: string
  nome: string
  chave: string
  plano: string
  expiraEm: string | null
}): Promise<void> {
  const { email, nome, chave, plano, expiraEm } = params

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada.')

  const nomePlano: Record<string, string> = {
    mensal: 'Mensal',
    anual: 'Anual',
    vitalicio: 'Vitalício',
  }

  const expiracao = expiraEm
    ? `Válida até: ${new Date(expiraEm).toLocaleDateString('pt-BR')}`
    : 'Licença vitalícia — sem data de expiração'

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; padding: 24px; }
    .card { background: white; border-radius: 16px; max-width: 520px; margin: 0 auto; padding: 40px; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .logo { color: #2563eb; font-size: 22px; font-weight: 800; margin-bottom: 28px; }
    h1 { font-size: 20px; color: #0f172a; margin-bottom: 6px; }
    p { color: #475569; font-size: 14px; line-height: 1.6; }
    .chave-box { background: #0f172a; border-radius: 12px; padding: 20px 24px; margin: 24px 0; text-align: center; }
    .chave { font-family: 'Courier New', monospace; font-size: 22px; font-weight: 700; color: #60a5fa; letter-spacing: 3px; }
    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
    .info-label { color: #94a3b8; font-size: 13px; }
    .info-value { color: #0f172a; font-size: 13px; font-weight: 600; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🛍 VendaCerta PDV</div>
    <h1>Bem-vindo, ${nome}!</h1>
    <p>Seu pagamento foi confirmado. Abaixo está sua chave de licença para ativar o software:</p>

    <div class="chave-box">
      <div class="chave">${chave}</div>
    </div>

    <div>
      <div class="info-row">
        <span class="info-label">Plano</span>
        <span class="info-value">${nomePlano[plano] ?? plano}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Validade</span>
        <span class="info-value">${expiracao}</span>
      </div>
    </div>

    <p style="margin-top: 20px;">Para ativar, abra o VendaCerta PDV e clique em <strong>Ativar Agora</strong>. Cole a chave acima e pronto!</p>

    <div class="footer">
      <p>Dúvidas? Entre em contato com o suporte.<br/>VendaCerta PDV</p>
    </div>
  </div>
</body>
</html>`

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'VendaCerta <onboarding@resend.dev>',
    to: email,
    subject: `Sua chave de licença VendaCerta PDV — ${nomePlano[plano] ?? plano}`,
    html,
  })

  if (error) throw new Error(error.message)
}
