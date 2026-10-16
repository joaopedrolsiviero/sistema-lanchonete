<?php

declare(strict_types=1);

namespace Recanto\Fiscal;

/**
 * Pedido recebido do sistema de caixa, validado e normalizado.
 * Valores em CENTAVOS (inteiros), como no sistema de caixa.
 *
 * Formato esperado (JSON):
 * {
 *   "vendaId": "abc123",               // id da venda no caixa (evita emitir duas notas para a mesma venda)
 *   "numeroPedido": 12,
 *   "itens": [{ "codigo": "p1", "descricao": "Cappuccino", "ncm": "21011110", "cfop": "5102",
 *               "csosn": "102", "cstPis": "49", "cstCofins": "49", "cest": null, "unidade": "UN",
 *               "quantidade": 2, "valorUnitario": 1000 }],
 *   "desconto": 0,
 *   "pagamento": { "forma": "dinheiro", "valorPago": 5000, "troco": 3000 },
 *   "cpf": "12345678909"               // opcional (CPF na nota)
 * }
 */
final class Pedido
{
    public const FORMAS_PAGAMENTO = ['dinheiro' => '01', 'credito' => '03', 'debito' => '04', 'pix' => '17'];
    // CSOSN aceitos sem campos adicionais (Simples Nacional).
    public const CSOSN_ACEITOS = ['102', '103', '300', '400', '500'];
    // CST de PIS/COFINS aceitos sem alíquota: não tributados (04 a 09) e outras operações (49 a 99).
    private const CST_PIS_ACEITOS = '/^(0[4-9]|49|[5-9][0-9])$/';

    private function __construct(
        public readonly string $vendaId,
        public readonly ?int $numeroPedido,
        /** @var array<int, array> */
        public readonly array $itens,
        public readonly int $desconto,
        public readonly string $formaPagamento,
        public readonly int $valorPago,
        public readonly int $troco,
        public readonly ?string $cpf,
    ) {
    }

    public static function validar(mixed $d): self
    {
        if (!is_array($d)) {
            throw new ErroValidacao('Pedido inválido.');
        }
        $vendaId = (string) ($d['vendaId'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $vendaId)) {
            throw new ErroValidacao('Pedido sem identificação da venda (vendaId).');
        }
        $itensEntrada = $d['itens'] ?? null;
        if (!is_array($itensEntrada) || !$itensEntrada || count($itensEntrada) > 990) {
            throw new ErroValidacao('O pedido precisa ter de 1 a 990 itens.');
        }

        $itens = [];
        foreach (array_values($itensEntrada) as $i => $it) {
            $n = $i + 1;
            $nome = trim((string) ($it['descricao'] ?? ''));
            $onde = "Item $n" . ($nome !== '' ? " ($nome)" : '');
            $ncm = preg_replace('/\D/', '', (string) ($it['ncm'] ?? ''));
            $cfop = preg_replace('/\D/', '', (string) ($it['cfop'] ?? ''));
            $csosn = (string) ($it['csosn'] ?? '');
            $cstPis = (string) ($it['cstPis'] ?? '');
            $cstCofins = (string) ($it['cstCofins'] ?? '');
            $cest = preg_replace('/\D/', '', (string) ($it['cest'] ?? ''));
            $unidade = strtoupper(trim((string) ($it['unidade'] ?? 'UN'))) ?: 'UN';
            $qtd = $it['quantidade'] ?? null;
            $vUn = $it['valorUnitario'] ?? null;

            if ($nome === '' || mb_strlen($nome) > 120) {
                throw new ErroValidacao("$onde: descrição deve ter de 1 a 120 caracteres.");
            }
            if (strlen($ncm) !== 8) {
                throw new ErroValidacao("$onde: NCM não cadastrado ou inválido (8 dígitos). Cadastre no Cardápio.");
            }
            if (!preg_match('/^5\d{3}$/', $cfop)) {
                throw new ErroValidacao("$onde: CFOP inválido para venda dentro do estado (5xxx).");
            }
            if (!in_array($csosn, self::CSOSN_ACEITOS, true)) {
                throw new ErroValidacao("$onde: CSOSN \"$csosn\" não suportado (aceitos: " . implode(', ', self::CSOSN_ACEITOS) . ').');
            }
            if (!preg_match(self::CST_PIS_ACEITOS, $cstPis) || !preg_match(self::CST_PIS_ACEITOS, $cstCofins)) {
                throw new ErroValidacao("$onde: CST de PIS/COFINS não suportado (use 04 a 09 ou 49 a 99).");
            }
            if ($cest !== '' && strlen($cest) !== 7) {
                throw new ErroValidacao("$onde: CEST deve ter 7 dígitos.");
            }
            if (!preg_match('/^[A-Z0-9]{1,6}$/', $unidade)) {
                throw new ErroValidacao("$onde: unidade inválida.");
            }
            if (!is_int($qtd) || $qtd <= 0 || $qtd > 9999) {
                throw new ErroValidacao("$onde: quantidade inválida.");
            }
            if (!is_int($vUn) || $vUn <= 0) {
                throw new ErroValidacao("$onde: valor unitário inválido.");
            }
            $itens[] = [
                'codigo' => substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($it['codigo'] ?? $n)) ?: (string) $n, 0, 60),
                'descricao' => $nome, 'ncm' => $ncm, 'cfop' => $cfop, 'csosn' => $csosn,
                'cstPis' => $cstPis, 'cstCofins' => $cstCofins, 'cest' => $cest ?: null,
                'unidade' => $unidade, 'quantidade' => $qtd, 'valorUnitario' => $vUn, 'valorTotal' => $qtd * $vUn,
            ];
        }

        $subtotal = array_sum(array_column($itens, 'valorTotal'));
        $desconto = $d['desconto'] ?? 0;
        if (!is_int($desconto) || $desconto < 0 || $desconto >= $subtotal) {
            throw new ErroValidacao('Desconto inválido.');
        }
        $total = $subtotal - $desconto;

        $pag = $d['pagamento'] ?? [];
        $forma = (string) ($pag['forma'] ?? '');
        if (!isset(self::FORMAS_PAGAMENTO[$forma])) {
            throw new ErroValidacao('Forma de pagamento inválida.');
        }
        $valorPago = $pag['valorPago'] ?? $total;
        $troco = $pag['troco'] ?? 0;
        if (!is_int($valorPago) || !is_int($troco) || $troco < 0 || $valorPago - $troco !== $total) {
            throw new ErroValidacao('Pagamento não confere com o total do pedido.');
        }
        if ($forma !== 'dinheiro' && $troco !== 0) {
            throw new ErroValidacao('Só há troco em pagamento em dinheiro.');
        }

        $cpf = preg_replace('/\D/', '', (string) ($d['cpf'] ?? ''));
        if ($cpf !== '' && !self::cpfValido($cpf)) {
            throw new ErroValidacao('CPF inválido.');
        }

        $numeroPedido = isset($d['numeroPedido']) && is_int($d['numeroPedido']) ? $d['numeroPedido'] : null;

        return new self(
            $vendaId, $numeroPedido, self::distribuirDesconto($itens, $desconto), $desconto,
            $forma, $valorPago, $troco, $cpf ?: null,
        );
    }

    public function total(): int
    {
        return array_sum(array_column($this->itens, 'valorTotal')) - $this->desconto;
    }

    /** Divide o desconto entre os itens proporcionalmente (a soma fecha exatamente no desconto). */
    private static function distribuirDesconto(array $itens, int $desconto): array
    {
        $subtotal = array_sum(array_column($itens, 'valorTotal'));
        $distribuido = 0;
        foreach ($itens as $i => $it) {
            $parte = intdiv($desconto * $it['valorTotal'], $subtotal);
            $itens[$i]['desconto'] = $parte;
            $distribuido += $parte;
        }
        // centavos que sobraram do arredondamento vão para os itens de maior valor
        $resto = $desconto - $distribuido;
        $ordem = array_keys($itens);
        usort($ordem, fn ($a, $b) => $itens[$b]['valorTotal'] <=> $itens[$a]['valorTotal']);
        for ($k = 0; $resto > 0; $k = ($k + 1) % count($ordem)) {
            $i = $ordem[$k];
            if ($itens[$i]['desconto'] < $itens[$i]['valorTotal']) {
                $itens[$i]['desconto']++;
                $resto--;
            }
        }
        return $itens;
    }

    public static function cpfValido(string $cpf): bool
    {
        if (!preg_match('/^\d{11}$/', $cpf) || preg_match('/^(\d)\1{10}$/', $cpf)) {
            return false;
        }
        for ($t = 9; $t < 11; $t++) {
            $soma = 0;
            for ($i = 0; $i < $t; $i++) {
                $soma += (int) $cpf[$i] * (($t + 1) - $i);
            }
            $digito = ((10 * $soma) % 11) % 10;
            if ((int) $cpf[$t] !== $digito) {
                return false;
            }
        }
        return true;
    }
}
