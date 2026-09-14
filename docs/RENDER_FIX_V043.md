# Render fix v0.4.3 — WebAuthn

No Render, o navegador rejeitava o cadastro com `The RP ID "localhost" is invalid for this domain`.

A causa era a avaliação de `security.ts` antes de `server.ts` inferir `WEBAUTHN_RP_ID` e `WEBAUTHN_ORIGIN` a partir de `RENDER_EXTERNAL_HOSTNAME`.

A v0.4.3 resolve RP ID/origin no momento de cada operação WebAuthn e força o hostname público do Render quando o ambiente é produção e a configuração residual aponta para localhost.

Para `https://pontoproof.onrender.com`, a configuração efetiva passa a ser:

- RP ID: `pontoproof.onrender.com`
- Origin: `https://pontoproof.onrender.com`

Em desenvolvimento local continuam válidos `localhost` e `http://localhost:5173`.
