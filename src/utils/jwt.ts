import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const encoder = new TextEncoder()

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres')
  }
  return encoder.encode(secret)
}

export interface LicencaPayload extends JWTPayload {
  chave: string
  plano: string
  hardware_id: string
  expira_em: string | null
}

export async function assinarToken(payload: Omit<LicencaPayload, 'iss' | 'iat'>): Promise<string> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('vendacerta-licenca')
    .sign(getSecret())

  return token
}

export async function verificarToken(token: string): Promise<LicencaPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: 'vendacerta-licenca',
  })
  return payload as LicencaPayload
}
