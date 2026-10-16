<?php

declare(strict_types=1);

namespace Recanto\Fiscal;

/**
 * Configuração do serviço fiscal (config/config.json).
 * Veja config/config.exemplo.json e o README para o significado de cada campo.
 */
final class Config
{
    public const UF_CODIGOS = ['GO' => 52];

    public readonly int $ambiente;          // 1 = produção, 2 = homologação (testes, sem valor fiscal)
    public readonly string $token;          // segredo compartilhado com o sistema de caixa
    /** @var string[] */
    public readonly array $origensPermitidas;
    public readonly array $emitente;
    public readonly string $certificadoArquivo;
    public readonly string $certificadoSenha;
    public readonly string $cscId;
    public readonly string $csc;
    public readonly int $serie;
    public readonly string $pastaXml;
    public readonly string $pastaDados;
    public readonly int $timeoutSefaz;
    public readonly array $responsavelTecnico;

    public function __construct(array $c, string $baseDir)
    {
        $erros = [];
        $exigir = function (array $origem, string $caminho) use (&$erros) {
            $valor = $origem;
            foreach (explode('.', $caminho) as $parte) {
                if (!is_array($valor) || !array_key_exists($parte, $valor) || $valor[$parte] === '' || $valor[$parte] === null) {
                    $erros[] = "Falta o campo \"$caminho\" na configuração.";
                    return null;
                }
                $valor = $valor[$parte];
            }
            return $valor;
        };

        $this->ambiente = (int) ($c['ambiente'] ?? 2);
        if (!in_array($this->ambiente, [1, 2], true)) {
            $erros[] = '"ambiente" deve ser 1 (produção) ou 2 (homologação).';
        }
        $this->token = (string) $exigir($c, 'token');
        if (strlen($this->token) < 24) {
            $erros[] = '"token" deve ter pelo menos 24 caracteres aleatórios.';
        }
        $this->origensPermitidas = array_values(array_filter((array) ($c['origensPermitidas'] ?? [])));

        foreach ([
            'emitente.cnpj', 'emitente.ie', 'emitente.razaoSocial', 'emitente.endereco.logradouro',
            'emitente.endereco.numero', 'emitente.endereco.bairro', 'emitente.endereco.codigoMunicipio',
            'emitente.endereco.municipio', 'emitente.endereco.uf', 'emitente.endereco.cep',
        ] as $campo) {
            $exigir($c, $campo);
        }
        $this->emitente = $c['emitente'] ?? [];
        $cnpj = preg_replace('/\D/', '', (string) ($this->emitente['cnpj'] ?? ''));
        if (strlen($cnpj) !== 14) {
            $erros[] = '"emitente.cnpj" deve ter 14 dígitos.';
        }
        $uf = strtoupper((string) ($this->emitente['endereco']['uf'] ?? ''));
        if ($uf !== '' && !isset(self::UF_CODIGOS[$uf])) {
            $erros[] = "UF \"$uf\" ainda não suportada por este serviço (configurado para GO).";
        }

        $this->certificadoArquivo = self::caminho((string) $exigir($c, 'certificado.arquivo'), $baseDir);
        $this->certificadoSenha = (string) ($c['certificado']['senha'] ?? '');
        $this->cscId = (string) $exigir($c, 'csc.id');
        $this->csc = (string) $exigir($c, 'csc.codigo');
        $this->serie = (int) ($c['serie'] ?? 1);
        if ($this->serie < 0 || $this->serie > 999) {
            $erros[] = '"serie" deve estar entre 0 e 999.';
        }
        $this->pastaXml = self::caminho((string) $exigir($c, 'pastaXml'), $baseDir);
        $this->pastaDados = self::caminho((string) ($c['pastaDados'] ?? 'dados'), $baseDir);
        $this->timeoutSefaz = max(3, (int) ($c['timeoutSefaz'] ?? 10));
        $this->responsavelTecnico = (array) ($c['responsavelTecnico'] ?? []);

        if ($erros) {
            throw new ErroConfiguracao(implode(' ', $erros));
        }
    }

    /**
     * Procura a configuração, nesta ordem:
     *  1. variável de ambiente RECANTO_FISCAL_CONFIG (usada nos testes automáticos);
     *  2. config.json na pasta acima do serviço (instalação no Windows: C:\RecantoFiscal\config.json,
     *     fora da pasta do programa, para as atualizações não mexerem nela);
     *  3. config/config.json dentro do serviço.
     */
    public static function carregar(string $baseDir): self
    {
        $candidatos = array_filter([
            getenv('RECANTO_FISCAL_CONFIG') ?: null,
            dirname($baseDir) . '/config.json',
            $baseDir . '/config/config.json',
        ]);
        $arquivo = null;
        foreach ($candidatos as $c) {
            if (is_file($c)) {
                $arquivo = $c;
                break;
            }
        }
        if ($arquivo === null) {
            throw new ErroConfiguracao('Arquivo config.json não encontrado. Rode o instalador ou copie config/config.exemplo.json.');
        }
        // O Bloco de Notas às vezes grava um BOM no início; o json_decode não aceita.
        $texto = preg_replace('/^\xEF\xBB\xBF/', '', (string) file_get_contents($arquivo));
        $dados = json_decode($texto, true);
        if (!is_array($dados)) {
            throw new ErroConfiguracao("$arquivo não é um JSON válido (" . json_last_error_msg()
                . '). Confira vírgulas e aspas.');
        }
        return new self($dados, $baseDir);
    }

    public function cnpj(): string
    {
        return preg_replace('/\D/', '', (string) $this->emitente['cnpj']);
    }

    public function uf(): string
    {
        return strtoupper((string) $this->emitente['endereco']['uf']);
    }

    public function codigoUf(): int
    {
        return self::UF_CODIGOS[$this->uf()];
    }

    /** JSON de configuração no formato que a biblioteca sped-nfe espera. */
    public function jsonSped(): string
    {
        return json_encode([
            'atualizacao' => date('Y-m-d H:i:s'),
            'tpAmb' => $this->ambiente,
            'razaosocial' => $this->emitente['razaoSocial'],
            'cnpj' => $this->cnpj(),
            'siglaUF' => $this->uf(),
            'schemes' => Emissor::SCHEMA,
            'versao' => '4.00',
            'tokenIBPT' => '',
            'CSC' => $this->csc,
            'CSCid' => $this->cscId,
            'proxyConf' => ['proxyIp' => '', 'proxyPort' => '', 'proxyUser' => '', 'proxyPass' => ''],
        ], JSON_THROW_ON_ERROR);
    }

    private static function caminho(string $caminho, string $baseDir): string
    {
        if ($caminho === '') {
            return '';
        }
        $absoluto = preg_match('#^([A-Za-z]:[\\\\/]|/|\\\\\\\\)#', $caminho) === 1;
        return $absoluto ? $caminho : $baseDir . '/' . $caminho;
    }
}
