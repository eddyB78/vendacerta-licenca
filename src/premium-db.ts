import type { Client } from '@libsql/client'

const modulosPlanejados = [
  ['estoque_avancado', 'Gestão Avançada de Estoque',
    'Inventários completos e parciais, alertas de ruptura, histórico detalhado de movimentações e controle de perdas e divergências.'],
  ['integracao_ecommerce', 'Integração E-commerce',
    'Sincronização de produtos, preços e estoque, importação de pedidos de lojas virtuais, controle de disponibilidade e prevenção de vendas duplicadas.'],
  ['multi_lojas', 'Multi-lojas',
    'Gerenciamento de várias lojas, estoque por filial, transferências entre unidades e painel central de gerenciamento.'],
  ['inventario_mobile', 'Aplicativo de Inventário',
    'Contagem pelo celular, leitura de códigos de barras e sincronização segura com o VendaCerta PDV. Compatibilidade com coletores Zebra planejada.'],
  ['dashboard_online', 'Dashboard Online',
    'Acompanhamento remoto das vendas, relatórios de faturamento, indicadores de desempenho e informações de estoque.'],
] as const

export async function migrarPremium(db: Client): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS modulos_premium (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL,
      versao TEXT NOT NULL,
      ativo INTEGER NOT NULL CHECK (ativo IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS ofertas_premium (
      modulo_id TEXT NOT NULL REFERENCES modulos_premium(id),
      modelo TEXT NOT NULL CHECK (modelo IN ('mensal', 'anual', 'permanente')),
      preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
      moeda TEXT NOT NULL,
      disponivel INTEGER NOT NULL CHECK (disponivel IN (0, 1)),
      PRIMARY KEY (modulo_id, modelo)
    );

    CREATE TABLE IF NOT EXISTS clientes_premium (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL,
      licenca_id TEXT UNIQUE REFERENCES licencas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS direitos_premium (
      id TEXT PRIMARY KEY,
      cliente_id TEXT NOT NULL REFERENCES clientes_premium(id),
      modulo_id TEXT NOT NULL,
      modelo TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ativo', 'suspenso', 'revogado')),
      inicio_em TEXT NOT NULL,
      expira_em TEXT,
      preco_centavos INTEGER NOT NULL,
      moeda TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'manual',
      referencia_externa TEXT,
      revisao INTEGER NOT NULL DEFAULT 0,
      UNIQUE (origem, referencia_externa),
      FOREIGN KEY (modulo_id, modelo) REFERENCES ofertas_premium(modulo_id, modelo)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_direito_premium_corrente
      ON direitos_premium(cliente_id, modulo_id) WHERE status <> 'revogado';

    CREATE TABLE IF NOT EXISTS auditoria_premium (
      id TEXT PRIMARY KEY,
      direito_id TEXT NOT NULL REFERENCES direitos_premium(id),
      acao TEXT NOT NULL,
      motivo TEXT NOT NULL,
      dados_json TEXT NOT NULL,
      criado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auditoria_premium_direito
      ON auditoria_premium(direito_id, criado_em);

  `)

  await db.batch([
    ...modulosPlanejados.map(([id, nome, descricao]) => ({
      sql: `INSERT INTO modulos_premium (id, nome, descricao, versao, ativo)
            VALUES (?, ?, ?, '1.0.0', 0)
            ON CONFLICT(id) DO NOTHING`,
      args: [id, nome, descricao],
    })),
    {
      sql: `INSERT INTO modulos_premium (id, nome, descricao, versao, ativo)
            VALUES ('importacao_internacional', 'Importação Internacional',
                    'Cálculo de custos, despesas e preços de produtos importados.', '1.0.0', 0)
            ON CONFLICT(id) DO NOTHING`,
      args: [],
    },
    ...['mensal', 'anual', 'permanente'].map(modelo => ({
      sql: `INSERT INTO ofertas_premium VALUES ('importacao_internacional', ?, 0, 'BRL', 0)
            ON CONFLICT(modulo_id, modelo) DO NOTHING`,
      args: [modelo],
    })),
  ], 'write')
}
