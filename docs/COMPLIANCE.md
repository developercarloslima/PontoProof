# Compliance — trilha de produção

> Documento técnico, não parecer jurídico.

## Brasil / REP-P

A arquitetura deve ser revisada contra a Portaria MTP nº 671/2021 e alterações vigentes, layouts oficiais atuais de AFD/AEJ e orientações do Ministério do Trabalho e Emprego.

Requisitos de projeto:
- registrar fielmente marcações do trabalhador;
- não bloquear marcação simplesmente por estar fora do horário esperado;
- não gerar automaticamente marcação com base no horário contratual;
- não exigir autorização prévia para registrar sobrejornada;
- não sobrescrever/eliminar o registro original;
- manter trilhas e exportações exigidas;
- emitir/fornecer comprovantes conforme requisitos aplicáveis;
- possuir Atestado Técnico e Termo de Responsabilidade quando aplicável;
- acompanhar alterações de layout AFD/AEJ.

## LGPD

Biometria é dado pessoal sensível. Antes de produção:
- mapear bases legais por finalidade;
- RIPD/DPIA quando apropriado;
- minimização;
- retenção e descarte;
- direitos do titular;
- controles de acesso;
- contratos com operadores/suboperadores;
- gestão de incidente;
- criptografia em trânsito e repouso;
- logs sem exposição desnecessária de localização/biometria.

## Segurança mínima

- MFA para perfis privilegiados;
- SSO/SAML/OIDC enterprise;
- segregação multi-tenant;
- política forte de senha;
- JWT curto + refresh rotation ou sessão server-side;
- rate limit;
- WAF;
- KMS;
- backups imutáveis;
- auditoria append-only;
- pentest;
- SAST/DAST/SCA;
- SBOM;
- gestão de segredos;
- processo de resposta a incidentes.

## Antes de vender como “REP-P conforme”

1. Implementar AFD/AEJ exatamente nos layouts vigentes.
2. Implementar comprovante exigido e assinatura eletrônica aplicável.
3. Verificar requisitos de armazenamento/assinatura do REP-P.
4. Validar o fluxo de tratamento de ponto.
5. Criar documentação técnica e termos de responsabilidade.
6. Fazer auditoria independente especializada em Portaria 671.
7. Revisar cada recurso antifraude para não impedir o registro devido.
