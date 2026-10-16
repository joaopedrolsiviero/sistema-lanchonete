import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoExemplo } from '../js/store.js';
import {
  definirSenha, conferirSenha, conferirCodigo, recuperarComCodigo, removerSenha, temSenha, liberado,
  rotaProtegida,
} from '../js/acesso.js';

test('sem senha, tudo liberado; áreas protegidas são Cardápio, Relatórios e Ajustes', () => {
  const e = estadoExemplo();
  assert.equal(temSenha(e), false);
  assert.equal(liberado(e), true);
  assert.deepEqual(['pdv', 'cardapio', 'estoque', 'relatorios', 'ajustes'].filter(rotaProtegida),
    ['cardapio', 'relatorios', 'ajustes']);
});

test('senha não é guardada em texto e é conferida corretamente', async () => {
  const e = estadoExemplo();
  const codigo = await definirSenha(e, 'cafe2026');
  assert.match(codigo, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(JSON.stringify(e.config).includes('cafe2026'), false);
  assert.equal(JSON.stringify(e.config).includes(codigo), false);
  assert.equal(await conferirSenha(e, 'cafe2026'), true);
  assert.equal(await conferirSenha(e, 'Cafe2026'), false);
  assert.equal(await conferirSenha(e, ''), false);
  assert.equal(liberado(e), false);
});

test('senha curta é recusada', async () => {
  await assert.rejects(definirSenha(estadoExemplo(), '123'), /pelo menos 4/);
});

test('código de recuperação cria senha nova e é trocado', async () => {
  const e = estadoExemplo();
  const codigo = await definirSenha(e, 'antiga1');
  // aceita minúsculas e sem hífens
  assert.equal(await conferirCodigo(e, codigo.toLowerCase().replace(/-/g, ' ')), true);
  await assert.rejects(recuperarComCodigo(e, 'AAAA-BBBB-CCCC', 'nova123'), /incorreto/);
  const novoCodigo = await recuperarComCodigo(e, codigo, 'nova123');
  assert.equal(await conferirSenha(e, 'nova123'), true);
  assert.equal(await conferirSenha(e, 'antiga1'), false);
  assert.notEqual(novoCodigo, codigo);
  assert.equal(await conferirCodigo(e, codigo), false); // o antigo deixa de valer
});

test('trocar senha mantém o código de recuperação; remover libera tudo', async () => {
  const e = estadoExemplo();
  const codigo = await definirSenha(e, 'primeira');
  assert.equal(await definirSenha(e, 'segunda', { novoCodigo: false }), null);
  assert.equal(await conferirSenha(e, 'segunda'), true);
  assert.equal(await conferirCodigo(e, codigo), true);
  removerSenha(e);
  assert.equal(temSenha(e), false);
  assert.equal(liberado(e), true);
});
