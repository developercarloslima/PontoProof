# PontoProof Presence Gateway

Serviço opcional para comprovar que o navegador alcança a rede local da unidade sem tentar ler o SSID, que não é exposto de forma confiável pelos navegadores.

Variáveis obrigatórias:
- `GATEWAY_WORKSITE_ID`: ID do Worksite no PontoProof.
- `GATEWAY_ID`: deve ser igual ao `ID do gateway de rede local` configurado no Worksite.
- `PRESENCE_SIGNING_SECRET`: deve ser o mesmo segredo da API.
- `WEB_ORIGIN`: origem HTTPS do PontoProof.
- `GATEWAY_PORT`: padrão 3444.

Publique `/attest` somente dentro da LAN/VLAN da unidade. Em produção, use HTTPS (ou um reverse proxy HTTPS local) para evitar mixed-content no navegador.
