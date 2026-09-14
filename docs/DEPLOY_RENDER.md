# PontoProof — deploy de teste no Render

Esta configuração publica frontend + API no mesmo domínio HTTPS e cria um Render Postgres.

## Arquivos

- `render.yaml`: Blueprint do Render.
- `Dockerfile.render`: build único do frontend + API.

## Modo de teste gratuito

O Blueprint usa o plano gratuito para o serviço web e para o PostgreSQL. O filesystem do serviço é efêmero; portanto, os arquivos de selfie/evidência salvos em `BIOMETRIC_STORAGE_DIR` podem desaparecer quando o serviço reiniciar ou sofrer redeploy. Os embeddings faciais criptografados permanecem no PostgreSQL e o fluxo funcional de reconhecimento pode ser testado.

Para produção, anexe um Persistent Disk e altere `BIOMETRIC_STORAGE_DIR` para o caminho montado (por exemplo `/var/data/biometrics`), além de usar planos pagos/adequados para serviço e banco.

## Primeiro acesso demo

`DEMO_SEED=true` cria as seis contas de demonstração documentadas no README. Cada conta deve trocar a senha e cadastrar sua própria face e passkey/WebAuthn no primeiro acesso.

## WebAuthn

No Render, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` e `WEB_ORIGIN` são derivados automaticamente de `RENDER_EXTERNAL_HOSTNAME`. Isso permite usar o domínio HTTPS `*.onrender.com` sem editar o código.

## Produção

Antes de uso real:

1. Remova `DEMO_SEED=true`.
2. Use banco pago com política de backup adequada.
3. Adicione disco persistente ou migre evidências para object storage seguro.
4. Defina domínio próprio e revise `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN`.
5. Execute revisão jurídica/LGPD e de compliance trabalhista.
