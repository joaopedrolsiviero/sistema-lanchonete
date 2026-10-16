// Gravação dos dados no navegador usando IndexedDB.
//
// Organização no banco "recanto-do-cafe" (uma única tabela chave → valor):
//   "meta"               → config, categorias, produtos, insumos e sequência de pedidos
//   "vendas:AAAA-MM-DD"  → vendas daquele dia
// A cada gravação, só os registros que mudaram são reescritos (normalmente "meta" e o dia de hoje),
// tudo dentro de uma única transação: ou grava tudo, ou nada.
//
// Versões antigas guardavam tudo no localStorage (limite de ~5 MB). Na primeira abertura
// desta versão, esses dados são transferidos automaticamente para o IndexedDB.

import { normalizar, estadoExemplo } from './store.js';

const NOME_BANCO = 'recanto-do-cafe';
const TABELA = 'dados';
const CHAVE_META = 'meta';
const PREFIXO_DIA = 'vendas:';
export const CHAVE_LEGADA = 'lanchonete:dados';

/** Separa o estado em registros: meta + vendas agrupadas por dia. */
export function dividirEstado(estado) {
  const { vendas, ...meta } = estado;
  const registros = new Map([[CHAVE_META, meta]]);
  for (const v of vendas) {
    const chave = PREFIXO_DIA + v.dia;
    if (!registros.has(chave)) registros.set(chave, []);
    registros.get(chave).push(v);
  }
  return registros;
}

/** Junta os registros lidos do banco de volta num estado completo. */
export function juntarEstado(registros) {
  const meta = registros.get(CHAVE_META);
  const vendas = [];
  for (const [chave, lista] of registros) {
    if (chave.startsWith(PREFIXO_DIA)) vendas.push(...lista);
  }
  vendas.sort((a, b) => a.data.localeCompare(b.data));
  return normalizar({ ...meta, vendas });
}

// ---------- Utilitários do IndexedDB (que usa eventos) em forma de Promise ----------

function abrirBanco() {
  return new Promise((ok, falha) => {
    const req = indexedDB.open(NOME_BANCO, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABELA);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
    req.onblocked = () => falha(new Error('Feche as outras janelas do sistema e tente de novo.'));
  });
}

function resultado(req) {
  return new Promise((ok, falha) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

function concluida(tx) {
  return new Promise((ok, falha) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => falha(tx.error);
    tx.onabort = () => falha(tx.error || new Error('Gravação interrompida.'));
  });
}

// ---------- Armazenamento principal: IndexedDB ----------

function armazenamentoIndexedDB(db) {
  // Último conteúdo gravado de cada registro (JSON), para regravar só o que mudou.
  const gravado = new Map();
  // Gravações em fila, uma de cada vez, na ordem em que foram pedidas.
  let fila = Promise.resolve();

  function gravar(estado, { substituirTudo = false } = {}) {
    // Tira a "foto" dos dados agora; alterações feitas depois não afetam esta gravação.
    const novos = new Map([...dividirEstado(estado)].map(([k, v]) => [k, JSON.stringify(v)]));

    const operacao = fila.then(async () => {
      const tx = db.transaction(TABELA, 'readwrite');
      const tabela = tx.objectStore(TABELA);
      if (substituirTudo) tabela.clear();
      for (const chave of gravado.keys()) {
        if (!novos.has(chave) && !substituirTudo) tabela.delete(chave);
      }
      const alterados = [...novos].filter(([k, json]) => substituirTudo || gravado.get(k) !== json);
      for (const [chave, json] of alterados) tabela.put(json, chave);
      await concluida(tx);

      if (substituirTudo) gravado.clear();
      for (const chave of [...gravado.keys()]) if (!novos.has(chave)) gravado.delete(chave);
      for (const [chave, json] of alterados) gravado.set(chave, json);
    });
    // Se uma gravação falhar, as próximas continuam (e regravam o que ficou pendente).
    fila = operacao.catch(() => {});
    return operacao;
  }

  async function carregar() {
    const tx = db.transaction(TABELA, 'readonly');
    const tabela = tx.objectStore(TABELA);
    const [chaves, valores] = await Promise.all([resultado(tabela.getAllKeys()), resultado(tabela.getAll())]);
    chaves.forEach((k, i) => gravado.set(k, valores[i]));

    if (gravado.has(CHAVE_META)) {
      const registros = new Map(chaves.map((k, i) => [k, JSON.parse(valores[i])]));
      return { estado: juntarEstado(registros), migrado: false };
    }

    // Banco vazio: traz os dados da versão antiga (localStorage), se houver; senão, dados de exemplo.
    const legado = localStorage.getItem(CHAVE_LEGADA);
    const estado = legado ? normalizar(JSON.parse(legado)) : estadoExemplo();
    await gravar(estado, { substituirTudo: true });
    if (legado) localStorage.removeItem(CHAVE_LEGADA); // só depois de gravado com sucesso
    return { estado, migrado: Boolean(legado) };
  }

  return { tipo: 'indexeddb', carregar, gravar };
}

// ---------- Reserva: localStorage (navegadores sem IndexedDB) ----------

function armazenamentoLocal() {
  return {
    tipo: 'localstorage',
    async carregar() {
      const legado = localStorage.getItem(CHAVE_LEGADA);
      const estado = legado ? normalizar(JSON.parse(legado)) : estadoExemplo();
      if (!legado) localStorage.setItem(CHAVE_LEGADA, JSON.stringify(estado));
      return { estado, migrado: false };
    },
    async gravar(estado) {
      localStorage.setItem(CHAVE_LEGADA, JSON.stringify(estado));
    },
  };
}

/** Abre o armazenamento disponível: IndexedDB, ou localStorage se não houver. */
export async function abrirArmazenamento() {
  try {
    if (!globalThis.indexedDB) throw new Error('IndexedDB indisponível');
    return armazenamentoIndexedDB(await abrirBanco());
  } catch (e) {
    console.warn('Usando localStorage como reserva:', e);
    return armazenamentoLocal();
  }
}

// ---------- Armazenamento permanente ----------

/**
 * Pede ao navegador para não apagar os dados sozinho quando o disco estiver cheio.
 * Retorna true (concedido), false (negado) ou null (navegador não suporta).
 * Observação: "Limpar dados de navegação" feito manualmente continua apagando tudo.
 */
export async function pedirArmazenamentoPermanente() {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

/** Situação do armazenamento para exibir em Ajustes. */
export async function situacaoArmazenamento() {
  const info = { permanente: null, usado: null, cota: null };
  if (navigator.storage?.persisted) info.permanente = await navigator.storage.persisted();
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    info.usado = usage;
    info.cota = quota;
  }
  return info;
}
