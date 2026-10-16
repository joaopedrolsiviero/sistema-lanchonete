// Senha do dono: protege as áreas administrativas (Cardápio, Relatórios e Ajustes).
//
// A senha não é guardada: fica só um "resumo" dela (hash PBKDF2-SHA-256 com sal), em config.senha.
// Junto, um código de recuperação (também só o hash), mostrado uma vez ao definir a senha,
// permite criar uma senha nova se a atual for esquecida.
//
// Limite: os dados ficam no navegador do caixa; quem souber usar as ferramentas de desenvolvedor
// do navegador consegue mexer neles. A senha impede o acesso comum pela tela, não um ataque técnico.

export const ROTAS_PROTEGIDAS = ['cardapio', 'relatorios', 'ajustes'];
export const TAMANHO_MINIMO = 4;
const ITERACOES = 150000;
const INATIVIDADE_MS = 5 * 60 * 1000;
const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I, para não confundir

let desbloqueado = false;
let timer = null;
let aoBloquear = () => {};

export const rotaProtegida = (rota) => ROTAS_PROTEGIDAS.includes(rota);
export const temSenha = (estado) => Boolean(estado.config.senha);
/** A área do dono está acessível agora? (sem senha definida, sempre está) */
export const liberado = (estado) => !temSenha(estado) || desbloqueado;

// ---------- Criptografia ----------

const paraBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const deBase64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

async function resumir(texto, salBase64, iteracoes = ITERACOES) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(texto), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deBase64(salBase64), iterations: iteracoes }, chave, 256,
  );
  return paraBase64(bits);
}

const novoSal = () => paraBase64(crypto.getRandomValues(new Uint8Array(16)));

function gerarCodigoRecuperacao() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const letras = [...bytes].map((b) => ALFABETO_CODIGO[b % ALFABETO_CODIGO.length]).join('');
  return letras.match(/.{4}/g).join('-'); // ex.: K7QM-2XRD-9HTA
}

/** Aceita o código com ou sem hífens/espaços, maiúsculas ou minúsculas. */
const normalizarCodigo = (codigo) => String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- Senha ----------

function validarNovaSenha(senha) {
  if (String(senha || '').length < TAMANHO_MINIMO) {
    throw new Error(`A senha precisa ter pelo menos ${TAMANHO_MINIMO} caracteres.`);
  }
}

/**
 * Define (ou troca) a senha. Gera um novo código de recuperação quando `novoCodigo` for true
 * (sempre na primeira vez) e devolve esse código para ser mostrado ao dono.
 */
export async function definirSenha(estado, senha, { novoCodigo = true } = {}) {
  validarNovaSenha(senha);
  const atual = estado.config.senha;
  const sal = novoSal();
  const registro = { sal, hash: await resumir(senha, sal), iteracoes: ITERACOES };
  let codigo = null;
  if (novoCodigo || !atual?.recuperacao) {
    codigo = gerarCodigoRecuperacao();
    const salCodigo = novoSal();
    registro.recuperacao = { sal: salCodigo, hash: await resumir(normalizarCodigo(codigo), salCodigo), iteracoes: ITERACOES };
  } else {
    registro.recuperacao = atual.recuperacao;
  }
  estado.config.senha = registro;
  return codigo;
}

export async function conferirSenha(estado, senha) {
  const s = estado.config.senha;
  if (!s) return true;
  return (await resumir(String(senha || ''), s.sal, s.iteracoes)) === s.hash;
}

export async function conferirCodigo(estado, codigo) {
  const r = estado.config.senha?.recuperacao;
  if (!r) return false;
  return (await resumir(normalizarCodigo(codigo), r.sal, r.iteracoes)) === r.hash;
}

/** Usa o código de recuperação para criar uma senha nova. Devolve um NOVO código (o antigo deixa de valer). */
export async function recuperarComCodigo(estado, codigo, novaSenha) {
  validarNovaSenha(novaSenha);
  if (!(await conferirCodigo(estado, codigo))) throw new Error('Código de recuperação incorreto.');
  return definirSenha(estado, novaSenha, { novoCodigo: true });
}

export function removerSenha(estado) {
  delete estado.config.senha;
}

// ---------- Sessão (liberado / bloqueado) ----------

/** Chamado uma vez ao iniciar: `fn` é avisada quando a área do dono for bloqueada. */
export function configurar(fn) {
  aoBloquear = fn;
  // qualquer uso da tela conta como atividade
  for (const evento of ['pointerdown', 'keydown']) {
    document.addEventListener(evento, () => { if (desbloqueado) reiniciarTimer(); }, { passive: true });
  }
}

function reiniciarTimer() {
  clearTimeout(timer);
  timer = setTimeout(bloquear, INATIVIDADE_MS);
}

export function desbloquear() {
  desbloqueado = true;
  reiniciarTimer();
}

export function bloquear() {
  clearTimeout(timer);
  timer = null;
  if (!desbloqueado) return;
  desbloqueado = false;
  aoBloquear();
}
