// Usa o SQLite nativo do Node.js 22+ (sem instalar nada!)
// Docs: https://nodejs.org/api/sqlite.html
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DB_PATH
  ? dirname(process.env.DB_PATH)
  : join(__dirname, '..', 'data')

export const DB_PATH = process.env.DB_PATH ?? join(DATA_DIR, 'licencas.db')

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  // Cria a pasta /data se não existir
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }

  _db = new DatabaseSync(DB_PATH)
  _db.exec('PRAGMA journal_mode = WAL')
  _db.exec('PRAGMA foreign_keys = ON')
  migrate(_db)
  return _db
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS licencas (
      id            TEXT PRIMARY KEY,
      chave         TEXT UNIQUE NOT NULL,
      plano         TEXT NOT NULL DEFAULT 'mensal',
      email         TEXT,
      nome          TEXT,
      hardware_id   TEXT,
      status        TEXT NOT NULL DEFAULT 'pendente',
      expira_em     TEXT,
      ativado_em    TEXT,
      criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      mp_pagamento_id TEXT,
      notas         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_licencas_chave  ON licencas(chave);
    CREATE INDEX IF NOT EXISTS idx_licencas_email  ON licencas(email);
    CREATE INDEX IF NOT EXISTS idx_licencas_status ON licencas(status);

    CREATE TABLE IF NOT EXISTS logs_ativacao (
      id          TEXT PRIMARY KEY,
      licenca_id  TEXT NOT NULL REFERENCES licencas(id),
      tipo        TEXT NOT NULL,
      hardware_id TEXT,
      ip          TEXT,
      detalhes    TEXT,
      criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pagamentos (
      id              TEXT PRIMARY KEY,
      licenca_id      TEXT REFERENCES licencas(id),
      mp_pagamento_id TEXT UNIQUE,
      plano           TEXT NOT NULL,
      valor_centavos  INTEGER NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pendente',
      email_pagador   TEXT,
      nome_pagador    TEXT,
      criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pagamentos_mp ON pagamentos(mp_pagamento_id);
  `)
}
