<?php

declare(strict_types=1);

namespace Recanto\Fiscal;

use PDO;

/**
 * Índice local das notas (SQLite). Os XMLs em si ficam em arquivos na pasta de XMLs;
 * aqui ficam a numeração, a situação de cada nota e as tentativas com resultado incerto.
 */
final class Banco
{
    private PDO $pdo;

    public function __construct(string $pastaDados)
    {
        if (!is_dir($pastaDados) && !mkdir($pastaDados, 0700, true) && !is_dir($pastaDados)) {
            throw new ErroConfiguracao("Não foi possível criar a pasta de dados: $pastaDados");
        }
        $this->pdo = new PDO('sqlite:' . $pastaDados . '/fiscal.sqlite', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->pdo->exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
        $this->pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS numeracao (
                ambiente INTEGER NOT NULL,
                serie INTEGER NOT NULL,
                proximo INTEGER NOT NULL,
                PRIMARY KEY (ambiente, serie)
            );
            CREATE TABLE IF NOT EXISTS notas (
                chave TEXT PRIMARY KEY,
                venda_id TEXT NOT NULL,
                ambiente INTEGER NOT NULL,
                serie INTEGER NOT NULL,
                numero INTEGER NOT NULL,
                tp_emis INTEGER NOT NULL,
                situacao TEXT NOT NULL,        -- autorizada | contingencia | cancelada | denegada | rejeitada_contingencia
                protocolo TEXT,
                dh_emi TEXT NOT NULL,
                dh_recbto TEXT,
                valor INTEGER NOT NULL,        -- centavos
                arquivo TEXT NOT NULL,         -- caminho do XML
                qr_code TEXT,
                mensagem TEXT,
                criado_em TEXT NOT NULL,
                atualizado_em TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS notas_venda ON notas (venda_id, ambiente);
            -- Tentativas normais que não tiveram resposta (ex.: internet caiu no meio do envio).
            -- A SEFAZ pode ou não ter recebido: depois é preciso consultar e cancelar ou inutilizar.
            CREATE TABLE IF NOT EXISTS incertas (
                chave TEXT PRIMARY KEY,
                ambiente INTEGER NOT NULL,
                serie INTEGER NOT NULL,
                numero INTEGER NOT NULL,
                venda_id TEXT NOT NULL,
                situacao TEXT NOT NULL,        -- pendente | inutilizada | cancelada | erro
                mensagem TEXT,
                criado_em TEXT NOT NULL
            );
            SQL);
    }

    public function transacao(callable $fn): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $resultado = $fn();
            $this->pdo->commit();
            return $resultado;
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /** Reserva o próximo número da série (atômico). */
    public function reservarNumero(int $ambiente, int $serie): int
    {
        return $this->transacao(function () use ($ambiente, $serie) {
            $this->pdo->prepare('INSERT OR IGNORE INTO numeracao (ambiente, serie, proximo) VALUES (?, ?, 1)')
                ->execute([$ambiente, $serie]);
            $st = $this->pdo->prepare('SELECT proximo FROM numeracao WHERE ambiente = ? AND serie = ?');
            $st->execute([$ambiente, $serie]);
            $numero = (int) $st->fetchColumn();
            $this->pdo->prepare('UPDATE numeracao SET proximo = ? WHERE ambiente = ? AND serie = ?')
                ->execute([$numero + 1, $ambiente, $serie]);
            return $numero;
        });
    }

    /**
     * Devolve um número que não chegou a ser usado (nota recusada pela SEFAZ não fica registrada lá),
     * desde que ele ainda seja o último reservado.
     */
    public function devolverNumero(int $ambiente, int $serie, int $numero): void
    {
        $this->pdo->prepare('UPDATE numeracao SET proximo = ? WHERE ambiente = ? AND serie = ? AND proximo = ?')
            ->execute([$numero, $ambiente, $serie, $numero + 1]);
    }

    public function proximoNumero(int $ambiente, int $serie): int
    {
        $st = $this->pdo->prepare('SELECT proximo FROM numeracao WHERE ambiente = ? AND serie = ?');
        $st->execute([$ambiente, $serie]);
        return (int) ($st->fetchColumn() ?: 1);
    }

    /** Ajuste manual do próximo número (ex.: continuar a numeração de outro emissor). */
    public function definirProximoNumero(int $ambiente, int $serie, int $proximo): void
    {
        $this->pdo->prepare('INSERT INTO numeracao (ambiente, serie, proximo) VALUES (?, ?, ?)
            ON CONFLICT (ambiente, serie) DO UPDATE SET proximo = excluded.proximo')->execute([$ambiente, $serie, $proximo]);
    }

    public function inserirNota(array $n): void
    {
        $agora = date('c');
        $this->pdo->prepare('INSERT INTO notas (chave, venda_id, ambiente, serie, numero, tp_emis, situacao, protocolo,
                dh_emi, dh_recbto, valor, arquivo, qr_code, mensagem, criado_em, atualizado_em)
            VALUES (:chave, :venda_id, :ambiente, :serie, :numero, :tp_emis, :situacao, :protocolo,
                :dh_emi, :dh_recbto, :valor, :arquivo, :qr_code, :mensagem, :agora, :agora)')
            ->execute([
                'chave' => $n['chave'], 'venda_id' => $n['venda_id'], 'ambiente' => $n['ambiente'],
                'serie' => $n['serie'], 'numero' => $n['numero'], 'tp_emis' => $n['tp_emis'],
                'situacao' => $n['situacao'], 'protocolo' => $n['protocolo'] ?? null, 'dh_emi' => $n['dh_emi'],
                'dh_recbto' => $n['dh_recbto'] ?? null, 'valor' => $n['valor'], 'arquivo' => $n['arquivo'],
                'qr_code' => $n['qr_code'] ?? null, 'mensagem' => $n['mensagem'] ?? null, 'agora' => $agora,
            ]);
    }

    public function atualizarNota(string $chave, array $campos): void
    {
        $sets = [];
        foreach (array_keys($campos) as $c) {
            if (!preg_match('/^[a-z_]+$/', $c)) {
                throw new \InvalidArgumentException("Campo inválido: $c");
            }
            $sets[] = "$c = :$c";
        }
        $campos['chave'] = $chave;
        $campos['agora'] = date('c');
        $this->pdo->prepare('UPDATE notas SET ' . implode(', ', $sets) . ', atualizado_em = :agora WHERE chave = :chave')
            ->execute($campos);
    }

    public function notaPorChave(string $chave): ?array
    {
        $st = $this->pdo->prepare('SELECT * FROM notas WHERE chave = ?');
        $st->execute([$chave]);
        return $st->fetch() ?: null;
    }

    public function notaPorVenda(string $vendaId, int $ambiente): ?array
    {
        $st = $this->pdo->prepare('SELECT * FROM notas WHERE venda_id = ? AND ambiente = ?');
        $st->execute([$vendaId, $ambiente]);
        return $st->fetch() ?: null;
    }

    /** @return array<int, array> */
    public function notasEmContingencia(int $ambiente): array
    {
        $st = $this->pdo->prepare("SELECT * FROM notas WHERE ambiente = ? AND situacao = 'contingencia' ORDER BY dh_emi");
        $st->execute([$ambiente]);
        return $st->fetchAll();
    }

    /** @return array<int, array> */
    public function notasComProblema(int $ambiente): array
    {
        $st = $this->pdo->prepare("SELECT * FROM notas WHERE ambiente = ? AND situacao = 'rejeitada_contingencia' ORDER BY dh_emi");
        $st->execute([$ambiente]);
        return $st->fetchAll();
    }

    public function inserirIncerta(string $chave, int $ambiente, int $serie, int $numero, string $vendaId): void
    {
        $this->pdo->prepare("INSERT OR IGNORE INTO incertas (chave, ambiente, serie, numero, venda_id, situacao, criado_em)
            VALUES (?, ?, ?, ?, ?, 'pendente', ?)")->execute([$chave, $ambiente, $serie, $numero, $vendaId, date('c')]);
    }

    /** @return array<int, array> */
    public function incertasPendentes(int $ambiente): array
    {
        $st = $this->pdo->prepare("SELECT * FROM incertas WHERE ambiente = ? AND situacao IN ('pendente', 'erro') ORDER BY numero");
        $st->execute([$ambiente]);
        return $st->fetchAll();
    }

    public function resolverIncerta(string $chave, string $situacao, ?string $mensagem = null): void
    {
        $this->pdo->prepare('UPDATE incertas SET situacao = ?, mensagem = ? WHERE chave = ?')
            ->execute([$situacao, $mensagem, $chave]);
    }
}
