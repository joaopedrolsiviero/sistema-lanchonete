import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoExemplo, estadoVazio, registrarVenda, cancelarVenda, calcularTotais,
  resumirVendas, vendasNoPeriodo, insumosEmFalta, entradaEstoque, salvarProduto,
  removerInsumo, removerCategoria, normalizar,
} from '../js/store.js';
import { dividirEstado, juntarEstado } from '../js/persistencia.js';
import { lerMoeda, chaveDia, somarDias } from '../js/util.js';

function itemDe(estado, nome, qtd = 1) {
  const p = estado.produtos.find((x) => x.nome === nome);
  return { produtoId: p.id, nome: p.nome, preco: p.preco, qtd, obs: '' };
}
const insumo = (estado, nome) => estado.insumos.find((i) => i.nome === nome);

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
  const e = estadoExemplo();
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
  const e = estadoExemplo();
  assert.throws(() => registrarVenda(e, [itemDe(e, 'Coxinha')], { pagamento: 'dinheiro', recebido: 500 }), /menor/);
  assert.equal(e.vendas.length, 0);
  assert.equal(insumo(e, 'Coxinha').qtd, 30);
});

test('exige itens e forma de pagamento', () => {
  const e = estadoExemplo();
  assert.throws(() => registrarVenda(e, [], { pagamento: 'pix' }), /vazio/);
  assert.throws(() => registrarVenda(e, [itemDe(e, 'Água')], {}), /pagamento/);
});

test('número do pedido reinicia a cada dia', () => {
  const e = estadoExemplo();
  const ontem = new Date(2026, 9, 15, 20);
  const hoje = new Date(2026, 9, 16, 11);
  registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }, ontem);
  registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }, ontem);
  const v = registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' }, hoje);
  assert.equal(v.numero, 1);
});

test('cancelar devolve o estoque e não pode ser repetido', () => {
  const e = estadoExemplo();
  const v = registrarVenda(e, [itemDe(e, 'Chocolate quente', 2)], { pagamento: 'credito' });
  assert.equal(insumo(e, 'Leite').qtd, 9.6);
  cancelarVenda(e, v.id);
  assert.equal(insumo(e, 'Leite').qtd, 10);
  assert.throws(() => cancelarVenda(e, v.id), /já foi cancelada/);
});

test('cancelamento usa o consumo da venda, mesmo se a receita mudar depois', () => {
  const e = estadoExemplo();
  const v = registrarVenda(e, [itemDe(e, 'Café expresso')], { pagamento: 'pix' });
  const p = e.produtos.find((x) => x.nome === 'Café expresso');
  salvarProduto(e, { ...p, receita: [] });
  cancelarVenda(e, v.id);
  assert.equal(insumo(e, 'Café em grão').qtd, 2);
});

test('resumo ignora vendas canceladas', () => {
  const e = estadoExemplo();
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
  const e = estadoExemplo();
  const leite = insumo(e, 'Leite');
  removerInsumo(e, leite.id);
  assert.ok(e.produtos.every((p) => p.receita.every((r) => r.insumoId !== leite.id)));
});

test('não remove categoria com produtos', () => {
  const e = estadoExemplo();
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
  const e = estadoExemplo();
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
