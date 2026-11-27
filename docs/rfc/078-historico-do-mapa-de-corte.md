# RFC 078 — Histórico do Mapa de corte

A operadora precisa saber se um pedido já entrou em um mapa. A carteira
mostra **Mapa de corte gerado**, com acesso às datas e versões registradas para
aquele pedido. Uma nova geração continua disponível, com aviso na prévia e ação
explícita **Gerar novamente**.

Reaproveitar a auditoria imutável de cada geração como fonte da consulta
preserva registros existentes e evita manter uma segunda trilha para o mesmo
fato. A seleção confere uma nova prévia quando muda a versão dos pedidos ou
quando outro PDF é gerado para qualquer pedido selecionado.

[CAR-08](../../.specs/features/order-portfolio/spec.md) ·
[ADR 102](../adr/102-historico-do-mapa-de-corte.md)
