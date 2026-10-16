import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoExemplo, estadoVazio, registrarVenda, cancelarVenda, calcularTotais,
  resumirVendas, vendasNoPeriodo, insumosEmFalta, entradaEstoque, salvarProduto,
  removerInsumo, removerCategoria, normalizar, carregar, salvar,
} from '../js/store.js';
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
  const paoAntes = insumo(e, 'Pão de hambúrguer').qtd;
  const baconAntes = insumo(e, 'Bacon').qtd;

  const venda = registrarVenda(e, [itemDe(e, 'X-Bacon', 2), itemDe(e, 'X-Burger')], {
    pagamento: 'dinheiro', recebido: 10000,
  });

  assert.equal(venda.total, 2 * 2200 + 1800);
  assert.equal(venda.troco, 10000 - 6200);
  assert.equal(venda.numero, 1);
  assert.equal(insumo(e, 'Pão de hambúrguer').qtd, paoAntes - 3);
  assert.equal(insumo(e, 'Bacon').qtd, baconAntes - 0.1);
});

test('dinheiro insuficiente é recusado e não altera nada', () => {
  const e = estadoExemplo();
  const paoAntes = insumo(e, 'Pão de hambúrguer').qtd;
  assert.throws(() => registrarVenda(e, [itemDe(e, 'X-Burger')], { pagamento: 'dinheiro', recebido: 1000 }), /menor/);
  assert.equal(e.vendas.length, 0);
  assert.equal(insumo(e, 'Pão de hambúrguer').qtd, paoAntes);
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
  const antes = insumo(e, 'Batata congelada').qtd;
  const v = registrarVenda(e, [itemDe(e, 'Batata frita G', 2)], { pagamento: 'credito' });
  assert.equal(insumo(e, 'Batata congelada').qtd, antes - 0.8);
  cancelarVenda(e, v.id);
  assert.equal(insumo(e, 'Batata congelada').qtd, antes);
  assert.throws(() => cancelarVenda(e, v.id), /já foi cancelada/);
});

test('cancelamento usa o consumo da venda, mesmo se a receita mudar depois', () => {
  const e = estadoExemplo();
  const antes = insumo(e, 'Batata congelada').qtd;
  const v = registrarVenda(e, [itemDe(e, 'Batata frita P')], { pagamento: 'pix' });
  const p = e.produtos.find((x) => x.nome === 'Batata frita P');
  salvarProduto(e, { ...p, receita: [] });
  cancelarVenda(e, v.id);
  assert.equal(insumo(e, 'Batata congelada').qtd, antes);
});

test('resumo ignora vendas canceladas', () => {
  const e = estadoExemplo();
  registrarVenda(e, [itemDe(e, 'X-Burger', 2)], { pagamento: 'pix' });
  registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'dinheiro', recebido: 500 });
  const c = registrarVenda(e, [itemDe(e, 'X-Bacon')], { pagamento: 'debito' });
  cancelarVenda(e, c.id);

  const hoje = chaveDia();
  const r = resumirVendas(vendasNoPeriodo(e, hoje, hoje));
  assert.equal(r.total, 3600 + 400);
  assert.equal(r.pedidos, 2);
  assert.equal(r.cancelados, 1);
  assert.equal(r.ticketMedio, 2000);
  assert.deepEqual(r.porPagamento, { pix: 3600, dinheiro: 400 });
  assert.equal(r.produtos[0].nome, 'X-Burger');
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
  const pao = insumo(e, 'Pão de hambúrguer');
  removerInsumo(e, pao.id);
  assert.ok(e.produtos.every((p) => p.receita.every((r) => r.insumoId !== pao.id)));
});

test('não remove categoria com produtos', () => {
  const e = estadoExemplo();
  assert.throws(() => removerCategoria(e, e.categorias[0].id), /produtos/);
});

test('salvar e carregar mantém os dados; backup inválido é recusado', () => {
  const memoria = new Map();
  const storage = { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v) };
  const e = estadoExemplo();
  registrarVenda(e, [itemDe(e, 'Água')], { pagamento: 'pix' });
  salvar(e, storage);
  assert.deepEqual(carregar(storage), e);
  assert.throws(() => normalizar({ vendas: 'x' }), /inválido/);
  assert.throws(() => normalizar(null), /inválido/);
});
