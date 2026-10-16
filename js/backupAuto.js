// Backup automático numa pasta do computador (Chrome/Edge no computador, via File System Access API).
//
// - O usuário escolhe a pasta uma vez (de preferência dentro do Google Drive para computador ou do OneDrive,
//   para a cópia ir também para a nuvem). O acesso à pasta fica guardado no navegador.
// - Depois de cada alteração, espera alguns segundos sem novas alterações e grava o arquivo do dia:
//   backup-recanto-do-cafe-AAAA-MM-DD.json (mesmo formato do "Baixar backup", pode ser restaurado em Ajustes).
// - Mantém os 30 arquivos mais recentes; os mais antigos (só os com esse nome) são apagados.
// - Se o navegador pedir a permissão de novo, a situação vira "sem-permissao" e o topo mostra um aviso.

import { chaveDia } from './util.js';

const PREFIXO = 'backup-recanto-do-cafe-';
const PADRAO_NOME = /^backup-recanto-do-cafe-\d{4}-\d{2}-\d{2}\.json$/;
const MANTER = 30;
const ESPERA_MS = 15000;

// situacao: 'nao-suportado' | 'inativo' | 'ativo' | 'sem-permissao' | 'erro'
const info = { situacao: 'inativo', pasta: null, ultimo: null, erro: null };
const ouvintes = new Set();
let pasta = null; // FileSystemDirectoryHandle
let obterDados = () => null;
let timer = null;
let fila = Promise.resolve();

export function suportado() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function situacao() {
  return { ...info };
}

/** Avisa `fn` sempre que a situação mudar. Retorna função para cancelar. */
export function aoMudar(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function mudar(parcial) {
  Object.assign(info, parcial);
  for (const fn of ouvintes) fn(situacao());
}

// ---------- Configuração guardada no navegador (o acesso à pasta não cabe em JSON) ----------

function abrirConfig() {
  return new Promise((ok, falha) => {
    const req = indexedDB.open('recanto-config', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

async function config(modo, operacao) {
  const db = await abrirConfig();
  try {
    return await new Promise((ok, falha) => {
      const tx = db.transaction('kv', modo);
      const req = operacao(tx.objectStore('kv'));
      tx.oncomplete = () => ok(req.result);
      tx.onerror = () => falha(tx.error);
    });
  } finally {
    db.close();
  }
}
const lerConfig = (chave) => config('readonly', (t) => t.get(chave));
const gravarConfig = (chave, valor) => config('readwrite', (t) => t.put(valor, chave));
const apagarConfig = (chave) => config('readwrite', (t) => t.delete(chave));

// ---------- Ciclo de vida ----------

/** Chamado ao abrir o sistema. `fnDados` devolve o estado atual a ser salvo. */
export async function iniciar(fnDados) {
  obterDados = fnDados;
  if (!suportado()) return mudar({ situacao: 'nao-suportado' });

  // Ao fechar/minimizar o app, grava na hora o que estiver pendente.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) fazerAgora().catch(() => {});
  });

  pasta = await lerConfig('pastaBackup');
  const ultimo = (await lerConfig('ultimoBackup')) || null;
  if (!pasta) return mudar({ situacao: 'inativo', ultimo });

  const permissao = await pasta.queryPermission({ mode: 'readwrite' });
  mudar({ situacao: permissao === 'granted' ? 'ativo' : 'sem-permissao', pasta: pasta.name, ultimo, erro: null });
  if (permissao === 'granted') agendar();
}

/** Abre o seletor de pasta (precisa de clique do usuário) e ativa o backup. */
export async function escolherPasta() {
  const nova = await window.showDirectoryPicker({ id: 'backup-recanto', mode: 'readwrite', startIn: 'documents' });
  pasta = nova;
  await gravarConfig('pastaBackup', nova);
  mudar({ situacao: 'ativo', pasta: nova.name, erro: null });
  await fazerAgora();
}

/** Pede de novo a permissão da pasta já escolhida (precisa de clique do usuário). */
export async function permitirNovamente() {
  if (!pasta) throw new Error('Nenhuma pasta escolhida.');
  const permissao = await pasta.requestPermission({ mode: 'readwrite' });
  if (permissao !== 'granted') throw new Error('O acesso à pasta não foi permitido.');
  mudar({ situacao: 'ativo', erro: null });
  await fazerAgora();
}

export async function desativar() {
  clearTimeout(timer);
  timer = null;
  pasta = null;
  await apagarConfig('pastaBackup');
  mudar({ situacao: 'inativo', pasta: null, erro: null });
}

/** Marca que houve alteração; o backup é gravado após alguns segundos sem novas alterações. */
export function agendar() {
  if (info.situacao !== 'ativo') return;
  clearTimeout(timer);
  timer = setTimeout(() => fazerAgora().catch(() => {}), ESPERA_MS);
}

/** Grava o backup imediatamente (uma gravação por vez). */
export function fazerAgora() {
  clearTimeout(timer);
  timer = null;
  const operacao = fila.then(gravarArquivo);
  fila = operacao.catch(() => {});
  return operacao;
}

async function gravarArquivo() {
  try {
    if (!pasta) throw new Error('Nenhuma pasta escolhida.');
    const conteudo = JSON.stringify(obterDados());
    const arquivo = await pasta.getFileHandle(`${PREFIXO}${chaveDia()}.json`, { create: true });
    // createWritable grava num arquivo temporário e só substitui o original ao fechar:
    // se algo falhar no meio, o backup anterior continua intacto.
    const escrita = await arquivo.createWritable();
    await escrita.write(conteudo);
    await escrita.close();
    await apagarAntigos();
    const agora = new Date().toISOString();
    await gravarConfig('ultimoBackup', agora);
    mudar({ situacao: 'ativo', ultimo: agora, erro: null });
  } catch (e) {
    const semPermissao = e.name === 'NotAllowedError' || e.name === 'SecurityError';
    const mensagem = e.name === 'NotFoundError'
      ? 'a pasta de backup não foi encontrada (foi apagada ou movida?)'
      : e.message;
    mudar({ situacao: semPermissao ? 'sem-permissao' : 'erro', erro: mensagem });
    throw e;
  }
}

/** Mantém só os MANTER backups mais recentes. Nunca mexe em arquivos com outro nome. */
async function apagarAntigos() {
  const nomes = [];
  for await (const [nome, item] of pasta.entries()) {
    if (item.kind === 'file' && PADRAO_NOME.test(nome)) nomes.push(nome);
  }
  nomes.sort(); // a data no nome (AAAA-MM-DD) deixa a ordem alfabética igual à cronológica
  for (const nome of nomes.slice(0, Math.max(0, nomes.length - MANTER))) {
    await pasta.removeEntry(nome);
  }
}
