// Funções utilitárias sem dependência do navegador (usadas também nos testes).

/** Formata centavos como moeda brasileira: 1250 -> "R$ 12,50". */
export function formatarMoeda(centavos) {
  const valor = (centavos || 0) / 100;
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Converte texto digitado em centavos. Aceita "12", "12,5", "12.50", "R$ 1.234,56".
 * Retorna null se não for um número válido.
 */
export function lerMoeda(texto) {
  if (typeof texto === 'number') return Math.round(texto * 100);
  let s = String(texto ?? '').replace(/R\$|\s/g, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Converte texto em número decimal (quantidades). Aceita vírgula. */
export function lerNumero(texto) {
  const s = String(texto ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Arredonda quantidades de estoque para evitar erros de ponto flutuante. */
export function arredondar(n, casas = 3) {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/** Formata quantidade com vírgula: 1.5 -> "1,5". */
export function formatarQtd(n) {
  return arredondar(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/** Escapa texto para inserir em HTML. */
export function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Gera um id curto e único o suficiente para uso local. */
export function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Chave do dia no fuso local: "2026-10-16". */
export function chaveDia(data = new Date()) {
  const d = new Date(data);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Soma dias a uma chave de dia e devolve outra chave. */
export function somarDias(chave, dias) {
  const [a, m, d] = chave.split('-').map(Number);
  return chaveDia(new Date(a, m - 1, d + dias));
}

/** "16/10/2026 14:05" */
export function formatarDataHora(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "2026-10-16" -> "16/10/2026" */
export function formatarDia(chave) {
  const [a, m, d] = chave.split('-');
  return `${d}/${m}/${a}`;
}
