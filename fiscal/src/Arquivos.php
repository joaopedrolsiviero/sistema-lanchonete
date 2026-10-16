<?php

declare(strict_types=1);

namespace Recanto\Fiscal;

use ZipArchive;

/**
 * Guarda os XMLs na pasta configurada, organizados por ano e mês:
 *   <pastaXml>/2026/10/<chave>-nfce.xml
 *   <pastaXml>/2026/10/<chave>-cancelamento.xml
 *   <pastaXml>/2026/10/inutilizacao-serie1-num123.xml
 * Nenhum arquivo é apagado pelo sistema (a guarda legal é de pelo menos 5 anos).
 */
final class Arquivos
{
    public function __construct(private string $pastaXml)
    {
    }

    public function caminho(\DateTimeInterface $data, string $nome): string
    {
        return sprintf('%s/%s/%s/%s', rtrim($this->pastaXml, '/\\'), $data->format('Y'), $data->format('m'), $nome);
    }

    /** Grava de forma atômica: escreve num arquivo temporário e só então substitui o definitivo. */
    public function salvar(string $caminho, string $conteudo): string
    {
        $pasta = dirname($caminho);
        if (!is_dir($pasta) && !mkdir($pasta, 0700, true) && !is_dir($pasta)) {
            throw new ErroConfiguracao("Não foi possível criar a pasta de XMLs: $pasta");
        }
        $temporario = $caminho . '.tmp';
        if (file_put_contents($temporario, $conteudo) === false || !rename($temporario, $caminho)) {
            @unlink($temporario);
            throw new ErroConfiguracao("Não foi possível gravar o XML em $caminho");
        }
        return $caminho;
    }

    public function ler(string $caminho): string
    {
        $conteudo = @file_get_contents($caminho);
        if ($conteudo === false) {
            throw new ErroFiscal("XML não encontrado: $caminho", 500);
        }
        return $conteudo;
    }

    /** Gera um .zip com todos os XMLs de um mês (AAAA-MM) e devolve o caminho do arquivo temporário. */
    public function zipDoMes(string $mes): string
    {
        if (!preg_match('/^(\d{4})-(0[1-9]|1[0-2])$/', $mes, $m)) {
            throw new ErroValidacao('Mês inválido (use AAAA-MM).');
        }
        $pasta = sprintf('%s/%s/%s', rtrim($this->pastaXml, '/\\'), $m[1], $m[2]);
        $arquivos = is_dir($pasta) ? glob($pasta . '/*.xml') : [];
        if (!$arquivos) {
            throw new ErroFiscal("Nenhum XML encontrado em $mes.", 404);
        }
        $zipPath = tempnam(sys_get_temp_dir(), 'nfce') . '.zip';
        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new ErroFiscal('Não foi possível criar o arquivo .zip.', 500);
        }
        foreach ($arquivos as $arquivo) {
            $zip->addFile($arquivo, basename($arquivo));
        }
        $zip->close();
        return $zipPath;
    }
}
