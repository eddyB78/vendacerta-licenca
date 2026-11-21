import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { createClient } from '@libsql/client'

async function portaLivre() {
  const socket = createServer()
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve))
  const { port } = socket.address()
  await new Promise(resolve => socket.close(resolve))
  return port
}

test('gestão premium no servidor existente com banco de desenvolvimento', async t => {
  const pasta = await mkdtemp(join(tmpdir(), 'vendacerta-premium-'))
  const url = pathToFileURL(join(pasta, 'dev.db')).href
  const token = 'admin-local-teste'
  const port = await portaLivre()
  const origem = 'http://127.0.0.1:' + port
  const processos = new Set()
  t.after(async () => {
    await Promise.all([...processos].map(parar))
    await rm(pasta, { recursive: true, force: true })
  })

  async function iniciar() {
    const filho = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      env: {
        ...process.env,
        PORT: String(port),
        TURSO_URL: url,
        TURSO_TOKEN: '',
        ADMIN_TOKEN: token,
        JWT_SECRET: 'segredo-local-de-teste-com-32-caracteres',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    processos.add(filho)
    let log = ''
    filho.stdout.on('data', dados => { log += dados })
    filho.stderr.on('data', dados => { log += dados })
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origem + '/health')).ok) return filho
      } catch {}
      if (filho.exitCode !== null) break
      await sleep(100)
    }
    assert.fail('Servidor de teste não iniciou. ' + log)
  }

  async function parar(filho) {
    if (filho.exitCode === null && filho.signalCode === null) {
      const saiu = new Promise(resolve => filho.once('exit', resolve))
      filho.kill()
      await saiu
    }
    processos.delete(filho)
  }

  async function chamar(caminho, metodo = 'GET', dados, bearer = token) {
    const resposta = await fetch(origem + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer },
      body: dados === undefined ? undefined : JSON.stringify(dados),
    })
    return { ...(await resposta.json()), status: resposta.status }
  }
  const premium = (caminho, ...args) => chamar('/admin/premium' + caminho, ...args)

  const servidor = await iniciar()
  const db = createClient({ url })
  try {
    await db.execute(`INSERT INTO licencas (id, chave, plano, email, status)
      VALUES ('base', 'VCRT-ABCD-EFGH-JKLM', 'vitalicio', 'loja@example.test', 'pendente'),
             ('descartavel', 'VCRT-MNOP-QRST-UVWX', 'vitalicio', NULL, 'revogada')`)
  } finally {
    db.close()
  }
  const catalogo = await premium('/modulos')
  const [modulo] = catalogo.modulos
  assert.equal(modulo.id, 'importacao_internacional')
  assert.equal(modulo.ativo, 0)
  assert.equal(catalogo.ofertas.length, 3)
  assert(catalogo.ofertas.every(oferta => oferta.disponivel === 0))
  assert.equal((await premium('/modulos', 'GET', undefined, 'errado')).status, 401)
  assert.equal((await premium('/direitos', 'POST', {}, 'errado')).status, 401)
  assert.match(await (await fetch(origem + '/painel')).text(), /Módulos Premium/)
  assert.equal((await fetch(origem + '/painel/premium.js')).status, 200)

  const { id: cliente } = await premium('/clientes', 'POST', {
    nome: 'Loja de teste', email: 'loja@example.test', licenca_id: 'base',
  })
  assert(cliente)
  assert.equal((await premium('/clientes', 'POST', {
    nome: 'Duplicado', email: 'loja@example.test', licenca_id: 'base',
  })).status, 409)
  const concessao = { cliente_id: cliente, modulo_id: modulo.id, modelo: 'mensal', motivo: 'Piloto' }
  assert.equal((await premium('/direitos', 'POST', concessao)).status, 409)

  const edicao = {
    nome: modulo.nome, descricao: modulo.descricao, versao: '1.1.0', ativo: true,
    ofertas: catalogo.ofertas.map((oferta, indice) => ({
      ...oferta, preco_centavos: 1000 * (indice + 1), moeda: 'EUR', disponivel: oferta.modelo !== 'anual',
    })),
  }
  const editar = dados => premium('/modulos/' + modulo.id, 'PUT', dados)
  assert.equal((await editar({ ...edicao, ofertas: edicao.ofertas.slice(1) })).status, 400)
  assert.equal((await editar(edicao)).status, 200)
  assert.equal((await premium('/direitos', 'POST', { ...concessao, modelo: 'anual' })).status, 409)

  const [primeira, segunda] = await Promise.all([
    premium('/direitos', 'POST', concessao), premium('/direitos', 'POST', concessao),
  ])
  assert.deepEqual([primeira.status, segunda.status].sort(), [201, 409])
  const id = primeira.id ?? segunda.id
  const acao = (acao, revisao) => premium('/direitos/' + id + '/acoes', 'POST', { acao, revisao, motivo: 'Teste' })
  const consultar = async () => (await premium('/direitos?cliente_id=' + cliente)).direitos.find(d => d.id === id)
  const inicial = await consultar()
  assert.equal(inicial.situacao, 'ativo')
  assert.equal(inicial.moeda, 'EUR')
  assert.equal((await acao('renovar', 0)).status, 200)
  assert.equal((await acao('renovar', 0)).status, 409)
  assert((await consultar()).expira_em > inicial.expira_em)
  assert.equal((await acao('suspender', 1)).status, 200)
  assert.equal((await consultar()).situacao, 'suspenso')
  assert.equal((await acao('reativar', 2)).status, 200)
  assert.equal((await acao('revogar', 3)).status, 200)
  assert.equal((await consultar()).situacao, 'revogado')
  const { eventos } = await premium('/direitos/' + id + '/auditoria')
  assert.deepEqual(new Set(eventos.map(e => e.acao)), new Set(['concessao', 'renovar', 'suspender', 'reativar', 'revogar']))
  assert.equal(eventos.length, 5)

  const permanente = await premium('/direitos', 'POST', { ...concessao, modelo: 'permanente' })
  assert.equal(permanente.status, 201)
  assert.equal((await premium('/direitos/' + permanente.id + '/acoes', 'POST', {
    acao: 'renovar', revisao: 0, motivo: 'Teste',
  })).status, 409)
  const direitos = async () => (await premium('/direitos')).direitos
  assert.equal((await direitos()).find(d => d.id === permanente.id).expira_em, null)
  assert.equal((await editar({ ...edicao, ativo: false })).status, 200)
  assert.equal((await direitos()).find(d => d.id === permanente.id).situacao, 'modulo_desativado')

  const ativacao = await chamar('/licenca/ativar', 'POST', { chave: 'VCRT-ABCD-EFGH-JKLM', hardware_id: 'dev' })
  assert.equal(ativacao.status, 200)
  assert.equal((await chamar('/licenca/verificar', 'POST', {
    chave: 'VCRT-ABCD-EFGH-JKLM', hardware_id: 'dev',
  }, ativacao.token)).status, 200)
  const outro = await premium('/clientes', 'POST', {
    nome: 'Segunda loja', email: 'segunda@example.test', licenca_id: 'descartavel',
  })
  assert.equal(outro.status, 201)
  assert.equal((await chamar('/admin/licencas/descartavel', 'DELETE')).status, 200)
  assert.equal((await premium('/clientes')).clientes.find(c => c.id === outro.id).licenca_id, null)

  assert.equal((await editar({
    ...edicao, ofertas: edicao.ofertas.map(oferta => ({ ...oferta, disponivel: true })),
  })).status, 200)
  const anual = await premium('/direitos', 'POST', { ...concessao, cliente_id: outro.id, modelo: 'anual' })
  assert.equal(anual.status, 201)
  const direitoAnual = (await direitos()).find(d => d.id === anual.id)
  assert.equal(new Date(direitoAnual.expira_em).getUTCFullYear(), new Date(direitoAnual.inicio_em).getUTCFullYear() + 1)
  const seed = createClient({ url })
  try {
    await seed.execute({
      sql: 'UPDATE direitos_premium SET expira_em=? WHERE id=?',
      args: ['2000-01-01T00:00:00.000Z', anual.id],
    })
  } finally {
    seed.close()
  }
  assert.equal((await direitos()).find(d => d.id === anual.id).situacao, 'expirado')

  await parar(servidor)
  await iniciar()
  const depois = await premium('/modulos')
  assert.equal(depois.modulos[0].versao, '1.1.0')
  assert(depois.ofertas.every(oferta => oferta.moeda === 'EUR'))
  assert.equal((await direitos()).length, 3)
})
