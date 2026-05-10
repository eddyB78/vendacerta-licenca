import { randomBytes } from 'crypto'

// Gera chave no formato VCRT-XXXX-XXXX-XXXX
export function gerarChave(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sem 0, O, I, 1 para evitar confusão
  const gerarSegmento = (len: number) =>
    Array.from(randomBytes(len))
      .map(b => chars[b % chars.length])
      .join('')

  return `VCRT-${gerarSegmento(4)}-${gerarSegmento(4)}-${gerarSegmento(4)}`
}

// Valida formato da chave
export function validarFormatoChave(chave: string): boolean {
  return /^VCRT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(chave)
}

// Calcula data de expiração baseada no plano
export function calcularExpiracao(plano: string): string | null {
  const agora = new Date()

  switch (plano) {
    case 'mensal': {
      const data = new Date(agora)
      data.setMonth(data.getMonth() + 1)
      return data.toISOString()
    }
    case 'anual': {
      const data = new Date(agora)
      data.setFullYear(data.getFullYear() + 1)
      return data.toISOString()
    }
    case 'vitalicio':
      return null // sem expiração
    default:
      return null
  }
}
