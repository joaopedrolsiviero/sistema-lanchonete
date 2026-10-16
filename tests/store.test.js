import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoExemplo, estadoVazio, registrarVenda, cancelarVenda, calcularTotais,
  resumirVendas, vendasNoPeriodo, insumosEmFalta, entradaEstoque, salvarProduto,
  removerInsumo, removerCategoria, normalizar,
  abrirCaixa, caixaAberto, movimentarCaixa, resumirCaixa, fecharCaixa,
} from '../js/store.js';
import { dividirEstado, juntarEstado } from '../js/persistencia.js';
import { lerMoeda, chaveDia, somarDias } from '../js/util.js';

function itemDe(estado, nome, qtd = 1) {
  const p = estado.produtos.find((x) => x.nome === nome);
  return { produtoId: p.id, nome: p.nome, preco: p.preco, qtd, obs: '' };
}
const insumo = (estado, nome) => estado.insumos.find((i) => i.nome === nome);

/** Dados de exemplo com o caixa já aberto (fundo zero), para os testes de venda. */
function exemploAberto(fundo = 0) {
  const e = estadoExemplo();
  abrirCaixa(e, { fundo });
  return e;
}

test('lerMoeda aceita formatos brasileiros', () => {
  assert.equal(lerMoeda('12'), 1200);
  assert.equal(lerMoeda('12,5'), 1250);
  assert.equal(lerMoeda('12.50'), 1250);
  assert.equal(lerMoeda('R$ 1.234,56'), 123456);
  assert.equal(lerMoeda('0,10'), 10);
  assert.equal(lerMoeda(''), null);
  assert.equal(lerMoeda('abc'), null);
});

test('somarDias atravessa meses', () => {
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
});

test('calcularTotais limita o desconto ao subtotal', () => {
  const itens = [{ preco: 1000, qtd: 2 }];
  assert.deepEqual(calcularTotais(itens, 500), { subtotal: 2000, desconto: 500, total: 1500 });
  assert.deepEqual(calcularTotais(itens, 9999), { subtotal: 2000, desconto: 2000, total: 0 });
  assert.deepEqual(calcularTotais(itens, -5), { subtotal: 2000, desconto: 0, total: 2000 });
});

test('venda em dinheiro calcula troco e baixa estoque pela ficha técnica', () => {
  const e = exemploAberto();
  const venda = registrarVenda(e, [itemDe(e, 'Cappuccino', 2), itemDe(e, 'Coxinha')], {
    pagamento: 'dinheiro', recebido: 5000,
  });

  assert.equal(venda.total, 2 * 1000 + 700);
  assert.equal(venda.troco, 5000 - 2700);
  assert.equal(venda.numero, 1);
  assert.equal(insumo(e, 'Coxinha').qtd, 29);
  assert.equal(insumo(e, 'Leite').qtd, 9.7);
  assert.equal(insumo(e, 'Café em grão').qtd, 1.984);
  assert.equal(insumo(e, 'Chocolate em pó').qtd, 0.98);
});

test('dinheiro insuficiente é recusado e não altera nada', () => {
  const e = exemploAberto();
  assert.throws(() => registrarVenda(e, [itemDe(e, 'Coxinha')], { pagamento: 'dinheiro', recebido: 500 }), /menor/);
  assert.equal(e.vendas.length, 0);
  assert.equal(insumo(e, 'Coxinha').qtd, 30);
});

test('exige itens e forma de pagamento', () => {
  const e = exemploAberto();
  assert.throws(() => registrarVenda(e, [], { pagamento: 'pix' }), /vazio/);
  assert.throws(() => registrarVenda(e, [itemDe(e, 'Água')], {}), /pagamento/);
});

test('número do pedido reinicia a cada dia', () => {
  const e = exemploAberto();
  const ontem = new Date(2026, 9, 15, 20);
  const hoje = new Date(2026, 9, 16, 11);
  registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }, ontem);
  registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }, ontem);
  const v = registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }, hoje);
  assert.equal(v.numero, 1);
});

test('cancelar devolve o estoque e não pode ser repetido', () => {
  const e = exemploAberto();
  const v = registrarVenda(e, [itemDe(e, 'Chocolate quente', 2)], { pagamento: 'credito' });
  assert.equal(insumo(e, 'Leite').qtd, 9.6);
  cancelarVenda(e, v.id);
  assert.equal(insumo(e, 'Leite').qtd, 10);
  assert.throws(() => cancelarVenda(e, v.id), /já foi cancelada/);
});

test('cancelamento usa o consumo da venda, mesmo se a receita mudar depois', () => {
  const e = exemploAberto();
  const v = registrarVenda(e, [itemDe(e, 'Café expresso')], { pagamento: 'pix' });
  const p = e.produtos.find((x) => x.nome === 'Café expresso');
  salvarProduto(e, { ...p, receita: [] });
  cancelarVenda(e, v.id);
  assert.equal(insumo(e, 'Café em grão').qtd, 2);
});

test('resumo ignora vendas canceladas', () => {
  const e = exemploAberto();
  registrarVenda(e, [itemDe(e, 'Coxinha', 2)], { pagamento: 'pix' });
  registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'dinheiro', recebido: 500 });
  const c = registrarVenda(e, [itemDe(e, 'Cappuccino')], { pagamento: 'debito' });
  cancelarVenda(e, c.id);

  const hoje = chaveDia();
  const r = resumirVendas(vendasNoPeriodo(e, hoje, hoje));
  assert.equal(r.total, 1400 + 400);
  assert.equal(r.pedidos, 2);
  assert.equal(r.cancelados, 1);
  assert.equal(r.ticketMedio, 900);
  assert.deepEqual(r.porPagamento, { pix: 1400, dinheiro: 400 });
  assert.equal(r.produtos[0].nome, 'Coxinha');
});

test('estoque baixo e entrada de mercadoria', () => {
  const e = estadoVazio();
  e.insumos.push({ id: 'a', nome: 'Pão', unidade: 'un', qtd: 5, minimo: 10 });
  assert.equal(insumosEmFalta(e).length, 1);
  entradaEstoque(e, 'a', 20);
  assert.equal(insumosEmFalta(e).length, 0);
  assert.throws(() => entradaEstoque(e, 'a', 0), /maior que zero/);
});

test('remover insumo tira ele das fichas técnicas', () => {
  const e = exemploAberto();
  const leite = insumo(e, 'Leite');
  removerInsumo(e, leite.id);
  assert.ok(e.produtos.every((p) => p.receita.every((r) => r.insumoId !== leite.id)));
});

test('não remove categoria com produtos', () => {
  const e = exemploAberto();
  assert.throws(() => removerCategoria(e, e.categorias[0].id), /produtos/);
});

test('dados de exemplo são do Recanto do Café', () => {
  const e = estadoExemplo();
  assert.equal(e.config.nomeLoja, 'Recanto do Café');
  assert.deepEqual(e.categorias.map((c) => c.nome), ['Cafés', 'Salgados', 'Doces', 'Bebidas']);
});

test('backup inválido é recusado', () => {
  assert.throws(() => normalizar({ vendas: 'x' }), /inválido/);
  assert.throws(() => normalizar(null), /inválido/);
});

test('dados são divididos por dia e remontados sem perda', () => {
  const e = exemploAberto();
  registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }, new Date(2026, 9, 14, 9));
  registrarVenda(e, [itemDe(e, 'Coxinha')], { pagamento: 'pix' }, new Date(2026, 9, 15, 9));
  registrarVenda(e, [itemDe(e, 'Cappuccino')], { pagamento: 'pix' }, new Date(2026, 9, 15, 10));

  const registros = dividirEstado(e);
  assert.deepEqual([...registros.keys()], ['meta', 'vendas:2026-10-14', 'vendas:2026-10-15']);
  assert.equal(registros.get('vendas:2026-10-15').length, 2);
  assert.equal(registros.get('meta').vendas, undefined);

  // Simula a ida e volta pelo banco (gravado como texto JSON).
  const lidos = new Map([...registros].reverse().map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  assert.deepEqual(juntarEstado(lidos), e);
});

// ---------- Abertura e fechamento de caixa ----------

test('não vende com o caixa fechado e só abre um caixa por vez', () => {
  const e = estadoExemplo();
  assert.equal(caixaAberto(e), null);
  assert.throws(() => registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }), /Abra o caixa/);
  const c = abrirCaixa(e, { fundo: 10000 });
  assert.equal(caixaAberto(e).id, c.id);
  assert.throws(() => abrirCaixa(e, { fundo: 0 }), /Já existe/);
  assert.equal(registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }).caixaId, c.id);
});

test('dinheiro esperado = fundo + vendas em dinheiro + suprimentos − sangrias', () => {
  const e = exemploAberto(10000); // R$ 100 de troco
  registrarVenda(e, [itemDe(e, 'Cappuccino')], { pagamento: 'dinheiro', recebido: 5000 }); // +10 (troco 40 saiu)
  registrarVenda(e, [itemDe(e, 'Coxinha', 2)], { pagamento: 'pix' }); // não entra na gaveta
  const cancelada = registrarVenda(e, [itemDe(e, 'Bolo (fatia)')], { pagamento: 'dinheiro' });
  cancelarVenda(e, cancelada.id); // não conta
  movimentarCaixa(e, { tipo: 'suprimento', valor: 2000, motivo: 'moedas' });
  movimentarCaixa(e, { tipo: 'sangria', valor: 5000, motivo: 'depósito' });

  const r = resumirCaixa(e, caixaAberto(e));
  assert.equal(r.pedidos, 2);
  assert.equal(r.cancelados, 1);
  assert.equal(r.total, 1000 + 1400);
  assert.deepEqual(r.porPagamento, { dinheiro: 1000, pix: 1400, debito: 0, credito: 0 });
  assert.equal(r.dinheiroEsperado, 10000 + 1000 + 2000 - 5000);
});

test('sangria não pode passar do dinheiro da gaveta; valores precisam ser positivos', () => {
  const e = exemploAberto(5000);
  assert.throws(() => movimentarCaixa(e, { tipo: 'sangria', valor: 5001 }), /sangria inválido/);
  assert.throws(() => movimentarCaixa(e, { tipo: 'suprimento', valor: 0 }), /maior que zero/);
  assert.throws(() => movimentarCaixa(e, { tipo: 'outro', valor: 100 }), /inválido/);
  movimentarCaixa(e, { tipo: 'sangria', valor: 5000 });
});

test('fechamento registra contado, diferença e resumo; depois não aceita vendas nem cancelamentos', () => {
  const e = exemploAberto(10000);
  const v = registrarVenda(e, [itemDe(e, 'Café expresso')], { pagamento: 'dinheiro', recebido: 600 });
  const c = fecharCaixa(e, { contado: 10500, obs: ' faltou moeda ' });
  assert.equal(c.fechamento.resumo.dinheiroEsperado, 10600);
  assert.equal(c.fechamento.diferenca, -100);
  assert.equal(c.fechamento.obs, 'faltou moeda');
  assert.equal(caixaAberto(e), null);
  assert.throws(() => registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }), /Abra o caixa/);
  assert.throws(() => cancelarVenda(e, v.id), /caixa já fechado/);
  assert.throws(() => fecharCaixa(e, { contado: 0 }), /Não há caixa/);
  // um novo caixa pode ser aberto em seguida
  abrirCaixa(e, { fundo: 10500 });
});

test('vendas antigas (sem caixa) continuam podendo ser canceladas', () => {
  const e = exemploAberto();
  const v = registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' });
  delete v.caixaId; // como as vendas feitas antes desta versão
  fecharCaixa(e, { contado: 0 });
  cancelarVenda(e, v.id);
  assert.equal(v.cancelada, true);
});
