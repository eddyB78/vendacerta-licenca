const premiumModelos = {
  mensal: 'Assinatura mensal',
  anual: 'Assinatura anual',
  permanente: 'Licença permanente',
}
const premiumSituacoes = {
  ativo: 'Ativo',
  suspenso: 'Suspenso',
  revogado: 'Revogado',
  expirado: 'Expirado',
  modulo_desativado: 'Módulo desativado',
}
const premiumAcoes = {
  concessao: 'Concessão',
  renovar: 'Renovar',
  suspender: 'Suspender',
  revogar: 'Revogar',
  reativar: 'Reativar',
}
const premiumCampo = id => document.getElementById('premium-' + id)
const premiumModuloForm = premiumCampo('modulo')
let premiumModulos = []
let premiumOfertas = []
let premiumClientes = []

for (const [modelo, titulo] of Object.entries(premiumModelos)) {
  const oferta = document.createElement('fieldset')
  oferta.style.cssText = 'border:1px solid var(--border);padding:12px;margin-bottom:14px;border-radius:8px'
  oferta.innerHTML = `
    <legend>${titulo}</legend>
    <div class="form-row">
      <div class="form-group"><label for="premium-preco-${modelo}">Preço</label>
      <input id="premium-preco-${modelo}" name="preco_${modelo}" type="text" inputmode="decimal" value="0,00" maxlength="18" required /></div>
      <div class="form-group"><label for="premium-moeda-${modelo}">Moeda ISO</label>
      <input id="premium-moeda-${modelo}" name="moeda_${modelo}" value="BRL" maxlength="3" pattern="[A-Za-z]{3}" required /></div>
    </div>
    <label><input name="disponivel_${modelo}" type="checkbox" style="width:auto" /> Oferta disponível</label>
  `
  premiumCampo('ofertas').append(oferta)
}
premiumModuloForm.elements.ativo.style.width = 'auto'

async function premiumApi(caminho, metodo = 'GET', dados) {
  const resposta = await apiFetch('/admin/premium' + caminho, {
    method: metodo,
    body: dados === undefined ? undefined : JSON.stringify(dados),
  })
  if (!resposta.ok) throw new Error(resposta.erro || 'Não foi possível concluir a operação.')
  return resposta
}

function premiumOpcoes(select, opcoes, inicial) {
  const anterior = select.value
  select.replaceChildren(new Option(inicial, ''))
  for (const [valor, rotulo] of opcoes) select.add(new Option(rotulo, valor))
  if (opcoes.some(([valor]) => valor === anterior)) select.value = anterior
}

function premiumEditar() {
  const modulo = premiumModulos.find(item => item.id === premiumCampo('editar').value)
  const campos = premiumModuloForm.elements
  for (const campo of ['id', 'nome', 'descricao', 'versao']) {
    campos[campo].value = modulo?.[campo] ?? (campo === 'versao' ? '1.0.0' : '')
  }
  campos.id.readOnly = Boolean(modulo)
  campos.ativo.checked = Boolean(modulo?.ativo)
  for (const modelo of Object.keys(premiumModelos)) {
    const oferta = premiumOfertas.find(item => item.modulo_id === modulo?.id && item.modelo === modelo)
    const centavos = oferta?.preco_centavos ?? 0
    campos['preco_' + modelo].value = Math.floor(centavos / 100) + ',' + String(centavos % 100).padStart(2, '0')
    campos['moeda_' + modelo].value = oferta?.moeda ?? 'BRL'
    campos['disponivel_' + modelo].checked = Boolean(oferta?.disponivel)
  }
}

function premiumOfertasDisponiveis() {
  const id = premiumCampo('grant-modulo').value
  const ofertas = premiumOfertas.filter(item => item.modulo_id === id && item.disponivel)
  premiumOpcoes(premiumCampo('grant-modelo'), ofertas.map(item => [
    item.modelo,
    premiumModelos[item.modelo] + ' · ' + premiumPreco(item),
  ]), 'Selecione a oferta')
}

function premiumPreco(item) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: item.moeda,
  }).format(item.preco_centavos / 100)
}

async function carregarPremium() {
  try {
    const [catalogo, cadastro] = await Promise.all([premiumApi('/modulos'), premiumApi('/clientes')])
    premiumModulos = catalogo.modulos
    premiumOfertas = catalogo.ofertas
    premiumClientes = cadastro.clientes
    premiumOpcoes(premiumCampo('editar'), premiumModulos.map(m => {
      const disponivel = m.ativo && premiumOfertas.some(oferta => oferta.modulo_id === m.id && oferta.disponivel)
      return [m.id, disponivel ? m.nome : m.nome + ' · Indisponível para contratação']
    }), 'Novo módulo')
    premiumEditar()
    const clientes = premiumClientes.map(c => [c.id, c.nome + ' · ' + c.email + (c.licenca_id ? ' · Licença vinculada' : '')])
    const licencas = (cadastro.licencas_disponiveis ?? []).map(licenca => [
      'licenca:' + licenca.id,
      [licenca.nome || licenca.email || 'Licença ' + licenca.id, licenca.nome && licenca.email, 'Licença existente']
        .filter(Boolean).join(' · '),
    ])
    premiumOpcoes(premiumCampo('grant-cliente'), [...clientes, ...licencas], 'Selecione o cliente')
    premiumOpcoes(premiumCampo('filtro-cliente'), clientes, 'Todos os clientes')
    premiumOpcoes(premiumCampo('grant-modulo'), premiumModulos.filter(m => m.ativo).map(m => [m.id, m.nome]), 'Selecione o módulo')
    premiumOfertasDisponiveis()
    await premiumCarregarDireitos()
  } catch (erro) {
    showToast(erro.message, 'error')
  }
}

let premiumConsulta = 0
async function premiumCarregarDireitos() {
  const consulta = ++premiumConsulta
  const cliente = premiumCampo('filtro-cliente').value
  const { direitos } = await premiumApi('/direitos?cliente_id=' + encodeURIComponent(cliente))
  if (consulta !== premiumConsulta) return
  const destino = premiumCampo('direitos')
  destino.replaceChildren()
  if (!direitos.length) {
    destino.textContent = 'Nenhum direito encontrado.'
    return
  }
  const tabela = document.createElement('table')
  tabela.innerHTML = '<thead><tr><th>Cliente</th><th>Módulo</th><th>Plano</th><th>Preço</th><th>Situação</th><th>Válido até</th><th>Ações</th></tr></thead>'
  const corpo = tabela.createTBody()
  for (const direito of direitos) {
    const linha = corpo.insertRow()
    const validade = direito.expira_em ? new Date(direito.expira_em).toLocaleString('pt-BR') : 'Sem vencimento'
    for (const valor of [
      direito.cliente_nome, direito.modulo_nome, premiumModelos[direito.modelo],
      premiumPreco(direito), premiumSituacoes[direito.situacao], validade,
    ]) linha.insertCell().textContent = valor
    const acoes = linha.insertCell()
    acoes.className = 'actions'
    premiumBotao(acoes, 'Histórico', () => premiumHistorico(direito))
    if (direito.status === 'revogado') continue
    if (direito.expira_em) premiumBotao(acoes, 'Renovar', () => premiumAcao(direito, 'renovar'))
    if (direito.status === 'suspenso' && (!direito.expira_em || Date.parse(direito.expira_em) > Date.now())) {
      premiumBotao(acoes, 'Reativar', () => premiumAcao(direito, 'reativar'))
    }
    if (direito.status === 'ativo') premiumBotao(acoes, 'Suspender', () => premiumAcao(direito, 'suspender'))
    premiumBotao(acoes, 'Revogar', () => premiumAcao(direito, 'revogar'))
  }
  destino.append(tabela)
}

function premiumBotao(destino, titulo, acao) {
  const botao = document.createElement('button')
  botao.type = 'button'
  botao.className = 'btn-ghost'
  botao.textContent = titulo
  botao.addEventListener('click', async () => {
    botao.disabled = true
    try { await acao() } catch (erro) { showToast(erro.message, 'error') }
    finally { botao.disabled = false }
  })
  destino.append(botao)
}

async function premiumAcao(direito, acao) {
  const motivo = window.prompt(premiumAcoes[acao] + ' ' + direito.modulo_nome + ' — informe o motivo')
  if (!motivo?.trim()) return
  await premiumApi('/direitos/' + encodeURIComponent(direito.id) + '/acoes', 'POST', {
    acao, motivo, revisao: direito.revisao,
  })
  showToast('Direito atualizado.')
  premiumCampo('historico').replaceChildren()
  await premiumCarregarDireitos()
}

async function premiumHistorico(direito) {
  const { eventos } = await premiumApi('/direitos/' + encodeURIComponent(direito.id) + '/auditoria')
  const titulo = document.createElement('h3')
  titulo.textContent = 'Histórico · ' + direito.cliente_nome + ' · ' + direito.modulo_nome
  const lista = document.createElement('ul')
  for (const evento of eventos) {
    const item = document.createElement('li')
    item.textContent = new Date(evento.criado_em).toLocaleString('pt-BR') + ' · ' +
      premiumAcoes[evento.acao] + ' · ' + evento.motivo
    lista.append(item)
  }
  premiumCampo('historico').replaceChildren(titulo, lista)
}

function premiumFormulario(form, salvar) {
  form.addEventListener('submit', async evento => {
    evento.preventDefault()
    const botao = form.querySelector('button:not([type="button"])')
    botao.disabled = true
    try { await salvar(new FormData(form)) } catch (erro) { showToast(erro.message, 'error') }
    finally { botao.disabled = false }
  })
}

function premiumCentavos(valor) {
  const partes = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(valor.trim())
  if (!partes) throw new Error('Informe um preço com até duas casas decimais, sem separador de milhares.')
  const centavos = Number(partes[1] + (partes[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(centavos)) throw new Error('Preço fora do limite permitido.')
  return centavos
}

premiumFormulario(premiumModuloForm, async dados => {
  const id = dados.get('id').trim()
  if (!premiumCampo('editar').value && premiumModulos.some(modulo => modulo.id === id)) {
    throw new Error('Esse identificador já existe. Selecione o módulo para editá-lo.')
  }
  await premiumApi('/modulos/' + encodeURIComponent(id), 'PUT', {
    nome: dados.get('nome'),
    descricao: dados.get('descricao'),
    versao: dados.get('versao'),
    ativo: dados.has('ativo'),
    ofertas: Object.keys(premiumModelos).map(modelo => ({
      modelo,
      preco_centavos: premiumCentavos(dados.get('preco_' + modelo)),
      moeda: dados.get('moeda_' + modelo).trim().toUpperCase(),
      disponivel: dados.has('disponivel_' + modelo),
    })),
  })
  if (!premiumCampo('editar').value) premiumCampo('editar').add(new Option(dados.get('nome'), id, false, true))
  showToast('Módulo salvo.')
  await carregarPremium()
})

premiumFormulario(premiumCampo('cliente'), async dados => {
  await premiumApi('/clientes', 'POST', {
    nome: dados.get('nome'),
    email: dados.get('email'),
    licenca_id: dados.get('licenca_id') || null,
  })
  premiumCampo('cliente').reset()
  premiumOpcoes(premiumCampo('licenca'), [], 'Sem vínculo')
  showToast('Cliente cadastrado.')
  await carregarPremium()
})

premiumFormulario(premiumCampo('concessao'), async dados => {
  const { cliente_id, ...concessao } = Object.fromEntries(dados)
  const destinatario = cliente_id.startsWith('licenca:')
    ? { licenca_id: cliente_id.slice('licenca:'.length) }
    : { cliente_id }
  await premiumApi('/direitos', 'POST', { ...concessao, ...destinatario })
  premiumCampo('grant-motivo').value = ''
  showToast('Acesso concedido.')
  await carregarPremium()
})

premiumCampo('editar').addEventListener('change', premiumEditar)
premiumCampo('grant-modulo').addEventListener('change', premiumOfertasDisponiveis)
premiumCampo('filtro-cliente').addEventListener('change', () => {
  premiumCampo('historico').replaceChildren()
  premiumCarregarDireitos().catch(erro => showToast(erro.message, 'error'))
})
premiumCampo('buscar').addEventListener('click', async () => {
  try {
    const busca = premiumCampo('busca-licenca').value.trim()
    if (!busca) throw new Error('Informe um nome ou e-mail.')
    const resultado = await apiFetch('/admin/licencas?q=' + encodeURIComponent(busca))
    if (!resultado.ok) throw new Error(resultado.erro || 'Falha ao buscar licenças.')
    const ocupadas = new Set(premiumClientes.map(cliente => cliente.licenca_id))
    const opcoes = resultado.licencas.filter(licenca => !ocupadas.has(licenca.id)).map(licenca => [
      licenca.id, [licenca.nome, licenca.email, licenca.plano, licenca.id].filter(Boolean).join(' · '),
    ])
    premiumOpcoes(premiumCampo('licenca'), opcoes, 'Sem vínculo')
    if (!opcoes.length) showToast('Nenhuma licença disponível para vínculo.')
  } catch (erro) {
    showToast(erro.message, 'error')
  }
})
