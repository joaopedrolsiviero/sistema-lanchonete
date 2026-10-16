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
//
// Tudo que vem de fora (backup restaurado) ou do armazenamento é conferido campo a campo antes de ser usado.
// Isso impede que um arquivo adulterado coloque código ou valores absurdos no sistema.

const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

const TIPOS = {
  id: (v) => typeof v === 'string' && RE_ID.test(v),
  texto: (v) => typeof v === 'string' && v.length <= 500,
  numero: (v) => typeof v === 'number' && Number.isFinite(v),
  inteiro: (v) => Number.isSafeInteger(v),
  centavos: (v) => Number.isSafeInteger(v) && v >= 0,
  positivo: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  bool: (v) => typeof v === 'boolean',
  dia: (v) => typeof v === 'string' && RE_DIA.test(v),
  dataHora: (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)),
  pagamento: (v) => Object.hasOwn(FORMAS_PAGAMENTO, v),
  chave: (v) => typeof v === 'string' && /^\d{44}$/.test(v),
  cpf: (v) => typeof v === 'string' && /^\d{11}$/.test(v),
  digitos: (v) => typeof v === 'string' && /^\d{1,8}$/.test(v),
  situacaoNfce: (v) => Object.hasOwn(SITUACOES_NFCE, v),
  url: (v) => typeof v === 'string' && /^https?:\/\/[^\s"'<>]{1,200}$/.test(v),
  movimento: (v) => Object.hasOwn(TIPOS_MOVIMENTO, v),
  base64: (v) => typeof v === 'string' && /^[A-Za-z0-9+/=]{1,200}$/.test(v),
};

/** Confere um objeto contra um esquema { campo: 'tipo' } ('tipo?' = opcional). */
function conferir(obj, esquema, onde) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`Dados inválidos: ${onde}.`);
  for (const [campo, regra] of Object.entries(esquema)) {
    const opcional = regra.endsWith('?');
    const valor = obj[campo];
    if (opcional && valor == null) continue;
    if (!TIPOS[regra.replace('?', '')](valor)) throw new Error(`Dados inválidos: ${onde}, campo "${campo}".`);
  }
}

function conferirLista(lista, esquema, onde, extra) {
  if (lista == null) return;
  if (!Array.isArray(lista)) throw new Error(`Dados inválidos: ${onde}.`);
  lista.forEach((item, i) => {
    const local = `${onde} nº ${i + 1}`;
    conferir(item, esquema, local);
    extra?.(item, local);
  });
}

function validar(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new Error('Arquivo inválido.');

  if (dados.config != null) {
    conferir(dados.config, { nomeLoja: 'texto?' }, 'configuração');
    if (dados.config.fiscal != null) {
      conferir(dados.config.fiscal, { ativo: 'bool?', url: 'url?', token: 'texto?' }, 'configuração fiscal');
      conferir(dados.config.fiscal.padrao ?? {}, {
        cfop: 'digitos?', csosn: 'digitos?', cstPis: 'digitos?', cstCofins: 'digitos?',
      }, 'padrões fiscais');
    }
    const senha = dados.config.senha;
    if (senha != null) {
      conferir(senha, { sal: 'base64', hash: 'base64', iteracoes: 'inteiro' }, 'senha');
      if (senha.recuperacao != null) {
        conferir(senha.recuperacao, { sal: 'base64', hash: 'base64', iteracoes: 'inteiro' }, 'código de recuperação');
      }
    }
  }
  if (dados.sequencia != null) conferir(dados.sequencia, { dia: 'dia?', numero: 'inteiro' }, 'sequência de pedidos');

  conferirLista(dados.categorias, { id: 'id', nome: 'texto' }, 'categoria');
  conferirLista(dados.insumos, { id: 'id', nome: 'texto', unidade: 'texto', qtd: 'numero', minimo: 'numero' }, 'insumo');
  conferirLista(dados.produtos, {
    id: 'id', nome: 'texto', categoriaId: 'id?', preco: 'centavos', ativo: 'bool?',
  }, 'produto', (p, onde) => {
    conferirLista(p.receita, { insumoId: 'id', qtd: 'positivo' }, `${onde}, ficha técnica`);
    if (p.fiscal != null) {
      conferir(p.fiscal, {
        ncm: 'digitos?', cfop: 'digitos?', csosn: 'digitos?', cstPis: 'digitos?', cstCofins: 'digitos?',
        cest: 'digitos?', unidade: 'texto?',
      }, `${onde}, dados fiscais`);
    }
  });

  conferirLista(dados.vendas, {
    id: 'id', numero: 'inteiro', data: 'dataHora', dia: 'dia', caixaId: 'id?',
    subtotal: 'centavos', desconto: 'centavos', total: 'centavos',
    pagamento: 'pagamento', recebido: 'centavos', troco: 'centavos',
    cancelada: 'bool', canceladaEm: 'dataHora?', cpf: 'cpf?',
  }, 'venda', (v, onde) => {
    if (v.nfce != null) {
      conferir(v.nfce, {
        situacao: 'situacaoNfce', chave: 'chave?', numero: 'inteiro?', serie: 'inteiro?', protocolo: 'texto?',
      }, `${onde}, NFC-e`);
    }
    if (!Array.isArray(v.itens)) throw new Error(`Dados inválidos: ${onde}, campo "itens".`);
    conferirLista(v.itens, { produtoId: 'id?', nome: 'texto', preco: 'centavos', qtd: 'inteiro', obs: 'texto?' }, `${onde}, item`);
    conferirLista(v.consumo, { insumoId: 'id', qtd: 'numero' }, `${onde}, consumo`);
  });

  conferirLista(dados.caixas, { id: 'id', abertura: 'dataHora', fundo: 'centavos' }, 'caixa', (c, onde) => {
    if (!Array.isArray(c.movimentos)) throw new Error(`Dados inválidos: ${onde}, campo "movimentos".`);
    conferirLista(c.movimentos, { id: 'id', tipo: 'movimento', valor: 'centavos', motivo: 'texto?', data: 'dataHora' }, `${onde}, movimento`);
    const f = c.fechamento;
    if (f == null) return;
    conferir(f, { data: 'dataHora', contado: 'centavos', diferenca: 'inteiro', obs: 'texto?' }, `${onde}, fechamento`);
    conferir(f.resumo, {
      pedidos: 'inteiro', cancelados: 'inteiro', total: 'centavos', descontos: 'centavos?',
      suprimentos: 'centavos', sangrias: 'centavos', dinheiroEsperado: 'inteiro',
    }, `${onde}, resumo do fechamento`);
    conferir(f.resumo.porPagamento, Object.fromEntries(Object.keys(FORMAS_PAGAMENTO).map((k) => [k, 'centavos?'])),
      `${onde}, resumo por pagamento`);
  });
}

/** Valida e completa um objeto de dados (usado ao carregar e ao importar backup). */
export function normalizar(dados) {
  validar(dados);
  const base = estadoVazio();
  // Só os campos conhecidos são aproveitados; qualquer outra coisa no arquivo é descartada.
  return {
    versao: base.versao,
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
 * Confere uma venda sem registrar nada: devolve caixa, totais, valor recebido e troco.
 * Usada antes de emitir a nota fiscal, para não emitir nota de uma venda que seria recusada.
 */
export function prepararVenda(estado, itens, { desconto = 0, pagamento, recebido } = {}) {
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
  return { caixa, totais, recebido, troco };
}

/** Número que o próximo pedido vai receber (a numeração recomeça a cada dia). */
export function proximoNumeroPedido(estado, agora = new Date()) {
  return estado.sequencia.dia === chaveDia(agora) ? estado.sequencia.numero + 1 : 1;
}

/**
 * Registra uma venda, dá baixa no estoque e devolve a venda criada.
 * itens: [{produtoId, nome, preco, qtd, obs}]
 * Opcionais: id (definido antes, quando a nota fiscal é emitida primeiro), cpf e nfce (dados da nota).
 */
export function registrarVenda(estado, itens, opcoes = {}, agora = new Date()) {
  const { pagamento } = opcoes;
  const { caixa, totais, recebido, troco } = prepararVenda(estado, itens, opcoes);

  const dia = chaveDia(agora);
  estado.sequencia = { dia, numero: proximoNumeroPedido(estado, agora) };

  const consumo = calcularConsumo(estado, itens);
  aplicarConsumo(estado, consumo, -1);

  const venda = {
    id: opcoes.id || gerarId(),
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
  if (opcoes.cpf) venda.cpf = opcoes.cpf;
  if (opcoes.nfce) venda.nfce = opcoes.nfce;
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

// ---------- Nota fiscal (NFC-e) ----------

export const SITUACOES_NFCE = {
  autorizada: 'Autorizada',
  contingencia: 'Contingência (aguardando envio)',
  cancelada: 'Cancelada',
  denegada: 'Denegada',
  rejeitada_contingencia: 'Recusada após contingência',
  pendente_emissao: 'Sem nota (emitir)',
};

/** Padrões fiscais usados quando o produto não tem o campo preenchido (o contador confirma). */
export const PADRAO_FISCAL = { cfop: '5102', csosn: '102', cstPis: '49', cstCofins: '49', unidade: 'UN' };

export function fiscalAtivo(estado) {
  const f = estado.config.fiscal;
  return Boolean(f?.ativo && f.url && f.token);
}

/** Dados fiscais efetivos de um produto (os do produto, completados pelos padrões). */
export function dadosFiscaisProduto(estado, produto) {
  const padrao = { ...PADRAO_FISCAL, ...(estado.config.fiscal?.padrao || {}) };
  const f = produto?.fiscal || {};
  const escolher = (campo) => (f[campo] ? f[campo] : padrao[campo] ?? null);
  return {
    ncm: f.ncm || null, cfop: escolher('cfop'), csosn: escolher('csosn'), cstPis: escolher('cstPis'),
    cstCofins: escolher('cstCofins'), cest: f.cest || null, unidade: escolher('unidade'),
  };
}

/** Produtos do pedido sem NCM (a nota não pode ser emitida sem ele). */
export function produtosSemNcm(estado, itens) {
  const nomes = new Set();
  for (const i of itens) {
    const p = estado.produtos.find((x) => x.id === i.produtoId);
    if (!dadosFiscaisProduto(estado, p).ncm) nomes.add(i.nome);
  }
  return [...nomes];
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
    throw new Error('Valor de sangria inválido: confira o valor digitado.');
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
  const fiscal = limparFiscal(dados.fiscal);
  if (fiscal) produto.fiscal = fiscal;
  else if (existente) delete existente.fiscal;
  if (existente) Object.assign(existente, produto);
  else estado.produtos.push(produto);
  return existente || produto;
}

/** Valida e limpa os dados fiscais digitados no cadastro do produto (só dígitos; campos vazios saem). */
function limparFiscal(fiscal) {
  if (!fiscal) return null;
  const regras = {
    ncm: [8, 'NCM deve ter 8 dígitos.'], cfop: [4, 'CFOP deve ter 4 dígitos.'], csosn: [3, 'CSOSN deve ter 3 dígitos.'],
    cstPis: [2, 'CST do PIS deve ter 2 dígitos.'], cstCofins: [2, 'CST da COFINS deve ter 2 dígitos.'],
    cest: [7, 'CEST deve ter 7 dígitos.'],
  };
  const limpo = {};
  for (const [campo, [tamanho, mensagem]] of Object.entries(regras)) {
    const v = String(fiscal[campo] ?? '').replace(/\D/g, '');
    if (!v) continue;
    if (v.length !== tamanho) throw new Error(mensagem);
    limpo[campo] = v;
  }
  const unidade = String(fiscal.unidade ?? '').trim().toUpperCase();
  if (unidade) {
    if (!/^[A-Z0-9]{1,6}$/.test(unidade)) throw new Error('Unidade deve ter até 6 letras/números (ex.: UN).');
    limpo.unidade = unidade;
  }
  return Object.keys(limpo).length ? limpo : null;
}

export function removerProduto(estado, id) {
  estado.produtos = estado.produtos.filter((p) => p.id !== id);
}
