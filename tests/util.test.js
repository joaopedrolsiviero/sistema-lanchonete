import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarCsv } from '../js/util.js';

test('CSV neutraliza fórmulas e escapa aspas', () => {
  const csv = gerarCsv([
    ['Pedido', 'Itens'],
    [1, '=HYPERLINK("http://malicioso","clique")'],
    [2, '+1+1'],
    [3, '@SOMA(A1)'],
    [4, '1x Café "especial"'],
  ]);
  const linhas = csv.replace('﻿', '').split('\r\n');
  assert.equal(csv[0], '﻿');
  assert.equal(linhas[1], `"1";"'=HYPERLINK(""http://malicioso"",""clique"")"`);
  assert.equal(linhas[2], `"2";"'+1+1"`);
  assert.equal(linhas[3], `"3";"'@SOMA(A1)"`);
  assert.equal(linhas[4], `"4";"1x Café ""especial"""`);
});
