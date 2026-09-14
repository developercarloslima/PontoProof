# Validação v0.4.6

Validações executadas neste pacote:

- parse sintático de todos os arquivos TypeScript/TSX da pasta `apps`;
- validação de todos os JSON;
- validação dos YAML de Render/Docker Compose;
- `sh -n` nos scripts de deploy;
- revisão de consistência dos fluxos: onboarding pendente, WebAuthn no ponto, ativação facial e logins biométricos.

O ambiente de geração não conseguiu concluir `npm install` dentro do limite externo, portanto o build tipado completo (`npm run build`) deve ser executado pelo Render/ambiente local, como já ocorre no Dockerfile de deploy. O `render.yaml`/Dockerfile interrompe o deploy automaticamente se `tsc` ou o frontend falharem.
