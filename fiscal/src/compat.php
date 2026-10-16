<?php

// A biblioteca usa as constantes da extensão "soap" do PHP, mas envia via cURL (SoapCurl).
// Se a extensão não estiver ativa, define as constantes para o serviço funcionar mesmo assim.
if (!defined('SOAP_1_2')) {
    define('SOAP_1_1', 1);
    define('SOAP_1_2', 2);
}
