// Regras de negócio e persistência dos dados.
// Valores em dinheiro são sempre guardados em CENTAVOS (inteiros) para evitar erros de arredondamento.

import { gerarId, chaveDia, arredondar } from './util.js';

export const CHAVE_STORAGE = 'lanchonete:dados';
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
    config: { nomeLoja: 'Minha Lanchonete' },
    categorias: [],
    produtos: [],
    insumos: [],
    vendas: [],
    sequencia: { dia: null, numero: 0 },
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

  const lanches = cat('Lanches');
  const porcoes = cat('Porções');
  const bebidas = cat('Bebidas');

  const pao = ins('Pão de hambúrguer', 'un', 50, 10);
  const carne = ins('Hambúrguer 120g', 'un', 40, 10);
  const queijo = ins('Queijo (fatia)', 'un', 80, 20);
  const bacon = ins('Bacon', 'kg', 2, 0.5);
  const batata = ins('Batata congelada', 'kg', 10, 2);
  const coca = ins('Refrigerante lata', 'un', 48, 12);
  const suco = ins('Polpa de fruta', 'un', 20, 5);

  prod('X-Burger', lanches, 1800, [{ insumoId: pao, qtd: 1 }, { insumoId: carne, qtd: 1 }, { insumoId: queijo, qtd: 1 }]);
  prod('X-Bacon', lanches, 2200, [{ insumoId: pao, qtd: 1 }, { insumoId: carne, qtd: 1 }, { insumoId: queijo, qtd: 1 }, { insumoId: bacon, qtd: 0.05 }]);
  prod('X-Salada', lanches, 2000, [{ insumoId: pao, qtd: 1 }, { insumoId: carne, qtd: 1 }, { insumoId: queijo, qtd: 1 }]);
  prod('Batata frita P', porcoes, 1500, [{ insumoId: batata, qtd: 0.2 }]);
  prod('Batata frita G', porcoes, 2500, [{ insumoId: batata, qtd: 0.4 }]);
  prod('Refrigerante lata', bebidas, 600, [{ insumoId: coca, qtd: 1 }]);
  prod('Suco natural', bebidas, 800, [{ insumoId: suco, qtd: 1 }]);
  prod('Água', bebidas, 400);
  return e;
}

// ---------- Persistência ----------

export function carregar(storage = globalThis.localStorage) {
  const bruto = storage?.getItem(CHAVE_STORAGE);
  if (!bruto) return estadoExemplo();
  try {
    return normalizar(JSON.parse(bruto));
  } catch (erro) {
    console.error('Dados corrompidos, usando estado vazio', erro);
    return estadoVazio();
  }
}

export function salvar(estado, storage = globalThis.localStorage) {
  storage.setItem(CHAVE_STORAGE, JSON.stringify(estado));
}

/** Valida e completa um objeto de dados (usado ao carregar e ao importar backup). */
export function normalizar(dados) {
  if (!dados || typeof dados !== 'object') throw new Error('Arquivo inválido.');
  const listas = ['categorias', 'produtos', 'insumos', 'vendas'];
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
