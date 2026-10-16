<?php

declare(strict_types=1);

namespace Recanto\Fiscal;

/** Erro do serviço fiscal com código HTTP e mensagem pronta para mostrar ao usuário. */
class ErroFiscal extends \RuntimeException
{
    public function __construct(string $mensagem, public readonly int $http = 400, public readonly array $extra = [])
    {
        parent::__construct($mensagem);
    }
}

/** Configuração ausente ou inválida. */
final class ErroConfiguracao extends ErroFiscal
{
    public function __construct(string $mensagem)
    {
        parent::__construct($mensagem, 503);
    }
}

/** Dados do pedido inválidos (corrigir no cadastro do produto ou no pedido). */
final class ErroValidacao extends ErroFiscal
{
    public function __construct(string $mensagem)
    {
        parent::__construct($mensagem, 400);
    }
}

/** A SEFAZ respondeu recusando o documento. */
final class ErroSefaz extends ErroFiscal
{
    public function __construct(string $cStat, string $xMotivo)
    {
        parent::__construct("SEFAZ recusou ($cStat): $xMotivo", 422, ['cStat' => $cStat, 'xMotivo' => $xMotivo]);
    }
}
