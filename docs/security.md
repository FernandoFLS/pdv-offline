# Segurança do projeto

## 1. Objetivo

Registrar as regras de segurança da aplicação, os limites do ambiente do navegador e os cuidados que devem ser observados no desenvolvimento do PDV offline.

## 2. Limitações do login por PIN em aplicação local

O login por PIN é útil para distinguir operadores e controlar acesso ao sistema, mas possui limitações importantes quando a aplicação roda em um navegador local.

### Limitações relevantes
- O navegador não é um ambiente de execução seguro para segredos.
- O dispositivo local pode ser acessado por terceiros.
- O processo de autenticação do navegador não substitui a proteção física do computador.
- Um usuário com acesso físico ao dispositivo pode contornar algumas limitações da aplicação se o sistema não for robusto.

### Regras mínimas
- O PIN não deve ser salvo em texto puro.
- O sistema deve usar mecanismos de autenticação local simples, mas com documentação clara sobre o limite da segurança.
- A interface pode exigir PIN para facilitar identificação do operador, mas a proteção real de dados locais não deve ser confundida com segurança criptográfica forte.

## 3. Autenticação, autorização e regras de negócio

### Autenticação de interface
- Identifica quem está operando.
- Pode bloquear acesso ao painel ou às ações sem perfil adequado.

### Autorização de negócio
- Define se determinada ação é permitida.
- Exemplos:
  - somente administrador pode aplicar desconto;
  - operador não pode cancelar venda sem autorização;
  - caixa fechado bloqueia abertura de venda;
  - ações sensíveis exigem reautenticação ou nível de privilégio.

Importante: a autenticação da interface não substitui a autorização nas regras de negócio.

## 4. Proteção contra acesso a dados locais

O sistema deve prever que o ambiente local pode ser usado em computador compartilhado ou pouco protegido.

Medidas esperadas:
- evitar exportação de dados sensíveis sem necessidade;
- limitar exibição de informações financeiras sensíveis;
- evitar logs de dados críticos;
- separar a autenticação de interface da lógica de autorização da aplicação;
- não incluir credenciais reais no repositório.

## 5. Dados sensíveis e política de logs

A política de logs deve evitar registrar:
- PINs;
- tokens;
- chaves de acesso;
- dados financeiros completos;
- conteúdo de pagamentos em claro.

Os logs devem conter apenas:
- identificadores internos seguros;
- status da operação;
- timestamps;
- códigos de falha úteis para diagnóstico;
- informações administrativas necessárias para auditoria.

## 6. Credenciais e acesso externo

O frontend não deve armazenar segredos de integração como se fossem seguros.

A integração com serviços externos, inclusive o Google Sheets, deve usar uma solução apropriada para proteção do segredo, fora do navegador, quando essa integração for implementada.

A arquitetura atual preserva essa separação:
- frontend local opera com dados do usuário e do caixa;
- integração externa, quando existir, será tratada em uma camada separada e segura.

## 7. Regras de segurança do PDV

- Nenhum dado real de clientes, produtos, vendas ou pagamentos deve entrar no repositório público.
- O repositório deve conter somente dados fictícios ou exemplos genéricos.
- As operações críticas devem ficar auditadas.
- O cancelamento e os ajustes financeiros devem estar protegidos por autorização.
- O acesso administrativo deve ser separado do uso operacional comum.
- Cancelamentos não devem remover o histórico da venda. Em vez disso, devem gerar registros de reversão e compensação coerentes para caixa e estoque.

## 8. Níveis de proteção esperados

A aplicação local deve considerar três níveis:

1. Proteção da interface
   - PIN para identificação do operador.
   - Perfis e permissões.

2. Proteção de regras de negócio
   - validações internas;
   - auditoria e autorização;
   - restrição de operações sensíveis.

3. Proteção de infraestrutura externa
   - o segredo de integração não fica no frontend;
   - a camada externa deve usar autenticação segura em backend, serverless ou serviço controlado.

## 9. Decisão em aberto

Ainda não será escolhida a tecnologia específica para integração externa. A arquitetura atual reconhece que o aplicativo local e a camada externa devem ser separados por segurança.

A decisão final sobre backend, função serverless ou Google Apps Script dependerá da avaliação futura de:
- segurança;
- custo;
- manutenção;
- confiabilidade;
- necessidade operacional.
