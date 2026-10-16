// Regras de negócio (a gravação dos dados fica em persistencia.js).
// Valores em dinheiro são sempre guardados em CENTAVOS (inteiros) para evitar erros de arredondamento.

import { gerarId, chaveDia, arredondar } from './util.js';

export const VERSAO = 1;

export const FORMAS_PAGAMENTO = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
};

export function estadoVazio() {
  return {
    versao: VERSAO,
    config: { nomeLoja: 'Recanto do Café' },
    categorias: [],
    produtos: [],
    insumos: [],
    vendas: [],
    sequencia: { dia: null, numero: 0 },
    caixas: [], // aberturas/fechamentos de caixa
  };
}

/** Dados de exemplo para o primeiro uso. */
export function estadoExemplo() {
  const e = estadoVazio();
  const cat = (nome) => { const c = { id: gerarId(), nome }; e.categorias.push(c); return c.id; };
  const ins = (nome, unidade, qtd, minimo) => {
    const i = { id: gerarId(), nome, unidade, qtd, minimo };
    e.insumos.push(i);
    return i.id;
  };
  const prod = (nome, categoriaId, preco, receita = []) => {
    e.produtos.push({ id: gerarId(), nome, categoriaId, preco, ativo: true, receita });
  };

  const cafes = cat('Cafés');
  const salgados = cat('Salgados');
  const doces = cat('Doces');
  const bebidas = cat('Bebidas');

  const cafe = ins('Café em grão', 'kg', 2, 0.5);
  const leite = ins('Leite', 'L', 10, 3);
  const chocolate = ins('Chocolate em pó', 'kg', 1, 0.2);
  const coxinha = ins('Coxinha', 'un', 30, 10);
  const paoDeQueijo = ins('Pão de queijo', 'un', 60, 20);
  const esfiha = ins('Esfiha', 'un', 20, 6);
  const bolo = ins('Bolo (fatia)', 'un', 12, 4);
  const lata = ins('Refrigerante lata', 'un', 24, 6);
  const polpa = ins('Polpa de fruta', 'un', 20, 5);

  prod('Café expresso', cafes, 600, [{ insumoId: cafe, qtd: 0.008 }]);
  prod('Café coado', cafes, 400, [{ insumoId: cafe, qtd: 0.01 }]);
  prod('Café com leite', cafes, 700, [{ insumoId: cafe, qtd: 0.008 }, { insumoId: leite, qtd: 0.15 }]);
  prod('Cappuccino', cafes, 1000, [{ insumoId: cafe, qtd: 0.008 }, { insumoId: leite, qtd: 0.15 }, { insumoId: chocolate, qtd: 0.01 }]);
  prod('Chocolate quente', cafes, 900, [{ insumoId: leite, qtd: 0.2 }, { insumoId: chocolate, qtd: 0.025 }]);
  prod('Coxinha', salgados, 700, [{ insumoId: coxinha, qtd: 1 }]);
  prod('Pão de queijo', salgados, 400, [{ insumoId: paoDeQueijo, qtd: 1 }]);
  prod('Esfiha', salgados, 650, [{ insumoId: esfiha, qtd: 1 }]);
  prod('Bolo (fatia)', doces, 800, [{ insumoId: bolo, qtd: 1 }]);
  prod('Refrigerante lata', bebidas, 600, [{ insumoId: lata, qtd: 1 }]);
  prod('Suco natural', bebidas, 800, [{ insumoId: polpa, qtd: 1 }]);
  prod('Água', bebidas, 400);
  return e;
}

// ---------- Validação ----------

/** Valida e completa um objeto de dados (usado ao carregar e ao importar backup). */
export function normalizar(dados) {
  if (!dados || typeof dados !== 'object') throw new Error('Arquivo inválido.');
  const listas = ['categorias', 'produtos', 'insumos', 'vendas', 'caixas'];
  for (const l of listas) {
    if (dados[l] !== undefined && !Array.isArray(dados[l])) throw new Error(`Campo "${l}" inválido.`);
  }
  const base = estadoVazio();
  return {
    ...base,
    ...dados,
    config: { ...base.config, ...(dados.config || {}) },
    sequencia: { ...base.sequencia, ...(dados.sequencia || {}) },
    categorias: dados.categorias || [],
    produtos: (dados.produtos || []).map((p) => ({ receita: [], ativo: true, ...p })),
    insumos: dados.insumos || [],
    vendas: dados.vendas || [],
    caixas: dados.caixas || [],
  };
}

// ---------- Vendas ----------

export function calcularTotais(itens, desconto = 0) {
  const subtotal = itens.reduce((s, i) => s + i.preco * i.qtd, 0);
  const descontoAplicado = Math.min(Math.max(desconto || 0, 0), subtotal);
  return { subtotal, desconto: descontoAplicado, total: subtotal - descontoAplicado };
}

/** Quanto de cada insumo os itens consomem: [{insumoId, qtd}]. */
export function calcularConsumo(estado, itens) {
  const mapa = new Map();
  for (const item of itens) {
    const produto = estado.produtos.find((p) => p.id === item.produtoId);
    for (const r of produto?.receita || []) {
      mapa.set(r.insumoId, arredondar((mapa.get(r.insumoId) || 0) + r.qtd * item.qtd));
    }
  }
  return [...mapa].map(([insumoId, qtd]) => ({ insumoId, qtd }));
}

function aplicarConsumo(estado, consumo, sinal) {
  for (const c of consumo) {
    const insumo = estado.insumos.find((i) => i.id === c.insumoId);
    if (insumo) insumo.qtd = arredondar(insumo.qtd + sinal * c.qtd);
  }
}

/**
 * Registra uma venda, dá baixa no estoque e devolve a venda criada.
 * itens: [{produtoId, nome, preco, qtd, obs}]
 */
export function registrarVenda(estado, itens, { desconto = 0, pagamento, recebido } = {}, agora = new Date()) {
  const caixa = caixaAberto(estado);
  if (!caixa) throw new Error('Abra o caixa antes de registrar vendas.');
  if (!itens.length) throw new Error('O pedido está vazio.');
  if (!FORMAS_PAGAMENTO[pagamento]) throw new Error('Escolha a forma de pagamento.');

  const totais = calcularTotais(itens, desconto);
  let troco = 0;
  if (pagamento === 'dinheiro') {
    const valorRecebido = recebido ?? totais.total;
    if (valorRecebido < totais.total) throw new Error('Valor recebido é menor que o total.');
    recebido = valorRecebido;
    troco = valorRecebido - totais.total;
  } else {
    recebido = totais.total;
  }

  const dia = chaveDia(agora);
  if (estado.sequencia.dia !== dia) estado.sequencia = { dia, numero: 0 };
  estado.sequencia.numero += 1;

  const consumo = calcularConsumo(estado, itens);
  aplicarConsumo(estado, consumo, -1);

  const venda = {
    id: gerarId(),
    numero: estado.sequencia.numero,
    data: new Date(agora).toISOString(),
    dia,
    caixaId: caixa.id,
    itens: itens.map(({ produtoId, nome, preco, qtd, obs }) => ({ produtoId, nome, preco, qtd, obs: obs || '' })),
    ...totais,
    pagamento,
    recebido,
    troco,
    consumo,
    cancelada: false,
  };
  estado.vendas.push(venda);
  return venda;
}

/** Cancela uma venda e devolve os insumos ao estoque. */
export function cancelarVenda(estado, vendaId, agora = new Date()) {
  const venda = estado.vendas.find((v) => v.id === vendaId);
  if (!venda) throw new Error('Venda não encontrada.');
  if (venda.cancelada) throw new Error('Esta venda já foi cancelada.');
  const caixa = venda.caixaId && estado.caixas.find((c) => c.id === venda.caixaId);
  if (caixa?.fechamento) {
    throw new Error('Esta venda é de um caixa já fechado e não pode mais ser cancelada.');
  }
  aplicarConsumo(estado, venda.consumo || [], +1);
  venda.cancelada = true;
  venda.canceladaEm = new Date(agora).toISOString();
  return venda;
}

/** Vendas entre dois dias (inclusive), mais recentes primeiro. */
export function vendasNoPeriodo(estado, de, ate) {
  return estado.vendas
    .filter((v) => v.dia >= de && v.dia <= ate)
    .sort((a, b) => b.data.localeCompare(a.data));
}

export function resumirVendas(vendas) {
  const validas = vendas.filter((v) => !v.cancelada);
  const total = validas.reduce((s, v) => s + v.total, 0);
  const porPagamento = {};
  const produtos = new Map();
  for (const v of validas) {
    porPagamento[v.pagamento] = (porPagamento[v.pagamento] || 0) + v.total;
    for (const i of v.itens) {
      const p = produtos.get(i.nome) || { nome: i.nome, qtd: 0, total: 0 };
      p.qtd += i.qtd;
      p.total += i.preco * i.qtd;
      produtos.set(i.nome, p);
    }
  }
  return {
    total,
    pedidos: validas.length,
    cancelados: vendas.length - validas.length,
    ticketMedio: validas.length ? Math.round(total / validas.length) : 0,
    descontos: validas.reduce((s, v) => s + v.desconto, 0),
    porPagamento,
    produtos: [...produtos.values()].sort((a, b) => b.qtd - a.qtd || b.total - a.total),
  };
}

// ---------- Abertura e fechamento de caixa ----------

export const TIPOS_MOVIMENTO = { sangria: 'Sangria', suprimento: 'Suprimento' };

/** O caixa aberto no momento (ou null). Só pode haver um aberto por vez. */
export function caixaAberto(estado) {
  return estado.caixas.find((c) => !c.fechamento) || null;
}

/** Abre o caixa com o fundo de troco (dinheiro que já está na gaveta). */
export function abrirCaixa(estado, { fundo }, agora = new Date()) {
  if (caixaAberto(estado)) throw new Error('Já existe um caixa aberto.');
  if (!(fundo >= 0)) throw new Error('Informe o fundo de troco (pode ser zero).');
  const caixa = { id: gerarId(), abertura: new Date(agora).toISOString(), fundo, movimentos: [], fechamento: null };
  estado.caixas.push(caixa);
  return caixa;
}

/**
 * Totais de um caixa: vendas por forma de pagamento e quanto deveria haver em dinheiro na gaveta.
 * Dinheiro esperado = fundo + vendas em dinheiro + suprimentos − sangrias.
 * (Vendas em dinheiro contam pelo total: o troco já saiu da gaveta.)
 */
export function resumirCaixa(estado, caixa) {
  const vendas = estado.vendas.filter((v) => v.caixaId === caixa.id);
  const validas = vendas.filter((v) => !v.cancelada);
  const porPagamento = Object.fromEntries(Object.keys(FORMAS_PAGAMENTO).map((k) => [k, 0]));
  for (const v of validas) porPagamento[v.pagamento] += v.total;
  const soma = (tipo) => caixa.movimentos.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.valor, 0);
  const suprimentos = soma('suprimento');
  const sangrias = soma('sangria');
  return {
    pedidos: validas.length,
    cancelados: vendas.length - validas.length,
    total: validas.reduce((s, v) => s + v.total, 0),
    descontos: validas.reduce((s, v) => s + v.desconto, 0),
    porPagamento,
    suprimentos,
    sangrias,
    dinheiroEsperado: caixa.fundo + porPagamento.dinheiro + suprimentos - sangrias,
  };
}

/** Sangria (retirada de dinheiro da gaveta) ou suprimento (entrada de troco). */
export function movimentarCaixa(estado, { tipo, valor, motivo = '' }, agora = new Date()) {
  const caixa = caixaAberto(estado);
  if (!caixa) throw new Error('Não há caixa aberto.');
  if (!TIPOS_MOVIMENTO[tipo]) throw new Error('Tipo de movimento inválido.');
  if (!(valor > 0)) throw new Error('Informe um valor maior que zero.');
  if (tipo === 'sangria' && valor > resumirCaixa(estado, caixa).dinheiroEsperado) {
    throw new Error('A sangria é maior que o dinheiro que deveria estar na gaveta.');
  }
  const movimento = { id: gerarId(), tipo, valor, motivo: motivo.trim(), data: new Date(agora).toISOString() };
  caixa.movimentos.push(movimento);
  return movimento;
}

/** Fecha o caixa com o dinheiro contado na gaveta e guarda o resumo do momento. */
export function fecharCaixa(estado, { contado, obs = '' }, agora = new Date()) {
  const caixa = caixaAberto(estado);
  if (!caixa) throw new Error('Não há caixa aberto.');
  if (!(contado >= 0)) throw new Error('Informe quanto dinheiro foi contado na gaveta.');
  const resumo = resumirCaixa(estado, caixa);
  caixa.fechamento = {
    data: new Date(agora).toISOString(),
    contado,
    diferenca: contado - resumo.dinheiroEsperado,
    obs: obs.trim(),
    resumo,
  };
  return caixa;
}

// ---------- Estoque ----------

export function insumosEmFalta(estado) {
  return estado.insumos.filter((i) => i.qtd <= i.minimo);
}

export function entradaEstoque(estado, insumoId, qtd) {
  const insumo = estado.insumos.find((i) => i.id === insumoId);
  if (!insumo) throw new Error('Insumo não encontrado.');
  if (!(qtd > 0)) throw new Error('Informe uma quantidade maior que zero.');
  insumo.qtd = arredondar(insumo.qtd + qtd);
  return insumo;
}

export function salvarInsumo(estado, dados) {
  if (!dados.nome?.trim()) throw new Error('Informe o nome do insumo.');
  const existente = dados.id && estado.insumos.find((i) => i.id === dados.id);
  const insumo = {
    id: existente?.id || gerarId(),
    nome: dados.nome.trim(),
    unidade: dados.unidade?.trim() || 'un',
    qtd: arredondar(dados.qtd || 0),
    minimo: arredondar(dados.minimo || 0),
  };
  if (existente) Object.assign(existente, insumo);
  else estado.insumos.push(insumo);
  return existente || insumo;
}

export function removerInsumo(estado, insumoId) {
  estado.insumos = estado.insumos.filter((i) => i.id !== insumoId);
  for (const p of estado.produtos) p.receita = p.receita.filter((r) => r.insumoId !== insumoId);
}

// ---------- Cardápio ----------

export function salvarCategoria(estado, { id, nome }) {
  if (!nome?.trim()) throw new Error('Informe o nome da categoria.');
  const existente = id && estado.categorias.find((c) => c.id === id);
  if (existente) existente.nome = nome.trim();
  else estado.categorias.push({ id: gerarId(), nome: nome.trim() });
}

export function removerCategoria(estado, id) {
  if (estado.produtos.some((p) => p.categoriaId === id)) {
    throw new Error('Mova ou remova os produtos desta categoria antes.');
  }
  estado.categorias = estado.categorias.filter((c) => c.id !== id);
}

export function salvarProduto(estado, dados) {
  if (!dados.nome?.trim()) throw new Error('Informe o nome do produto.');
  if (!(dados.preco >= 0)) throw new Error('Informe um preço válido.');
  const existente = dados.id && estado.produtos.find((p) => p.id === dados.id);
  const produto = {
    id: existente?.id || gerarId(),
    nome: dados.nome.trim(),
    categoriaId: dados.categoriaId || null,
    preco: dados.preco,
    ativo: dados.ativo !== false,
    receita: (dados.receita || []).filter((r) => r.insumoId && r.qtd > 0),
  };
  if (existente) Object.assign(existente, produto);
  else estado.produtos.push(produto);
  return existente || produto;
}

export function removerProduto(estado, id) {
  estado.produtos = estado.produtos.filter((p) => p.id !== id);
}
