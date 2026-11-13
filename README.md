# pdv-offline

Sistema de ponto de venda (PDV) em PWA, com suporte offline e sincronização posterior com o Google Sheets.

## Visão geral

Este repositório está sendo estruturado para evoluir em etapas pequenas e seguras, priorizando a integridade do caixa, das vendas e do estoque antes de funcionalidades secundárias.

A proposta inicial é um sistema web instalável em formato PWA, operando localmente em um único computador e mantendo a possibilidade de expansão para múltiplos dispositivos no futuro.

## Objetivo

Desenvolver um PDV que:
- funcione mesmo sem conexão com a internet;
- registre vendas e movimentos locais de forma consistente;
- preserve a integridade do caixa e do estoque;
- permita sincronização posterior com uma integração externa;
- suporte operações em ambiente local com baixo custo e boa confiabilidade.

## Premissas arquiteturais

- Persistência local operacional em IndexedDB.
- Aplicação web instalável em PWA.
- Service Worker para recursos offline da aplicação, sem substituir a persistência principal.
- Sincronização eventual, com fila persistente e reprocessamento.
- Google Sheets como integração externa futura, não como fonte de verdade exclusiva.
- Dados reais ou sensíveis não devem ser incluídos no repositório público.

## Status do projeto

**Descontinuado:** o desenvolvimento foi encerrado após o cancelamento do pedido do projeto pela empresa. Consulte [STATUS_DO_PROJETO.md](STATUS_DO_PROJETO.md) para o registro.

O projeto tem uma aplicação local com persistência versionada em IndexedDB, autenticação por PIN e gerenciamento administrativo de usuários, fluxo de abertura/consulta/fechamento do caixa e movimentações manuais de entrada e saída. Vendas, produtos, estoque e sincronização ainda não foram implementados.

## Desenvolvimento local

Requisitos: Node.js 22.12 ou mais recente e npm (incluído na instalação padrão do Node.js). O projeto fixa pnpm `11.25.0` em `package.json`.

Instale a versão de pnpm usada pelo projeto e confirme a versão:

```bash
npm install --global pnpm@11.25.0
pnpm --version
```

O segundo comando deve mostrar `11.25.0`. No Windows, se `pnpm` não for reconhecido logo após a instalação, abra um terminal novo para atualizar o PATH.

```bash
pnpm install
pnpm dev
```

Para validar a base e gerar a versão de produção:

```bash
pnpm test
pnpm build
```

O banco `pdv-offline` é criado no IndexedDB do navegador. As alterações de esquema devem ser adicionadas como novas migrações versionadas em `src/core/persistence/schema.js`; não altere migrações já publicadas.

Após entrar com PIN, o administrador pode cadastrar e gerenciar usuários, incluindo papel, redefinição de PIN e ativação/desativação. Também pode excluir permanentemente a conta autenticável de outro usuário; uma identidade mínima permanece arquivada somente para preservar nomes e atribuição no histórico de caixa e auditoria. Administradores e operadores podem abrir o caixa, registrar entradas/saídas manuais com motivo e fechar a sessão informando o dinheiro contado. A tela apresenta o histórico e os totais. O saldo é calculado em centavos inteiros, saídas acima do disponível são recusadas e gravações críticas são atômicas no IndexedDB. Cada lançamento manual usa uma chave única de solicitação para evitar duplicação acidental. O logout não fecha o caixa. Cancelamento de lançamentos ainda não está implementado; correções futuras deverão usar estorno compensatório auditável, sem apagar o original. Os dados permanecem neste navegador e precisam de uma estratégia de backup antes de uso operacional real.

## Documentação principal

- `docs/requirements.md` — requisitos funcionais, regras de negócio e integridade.
- `docs/architecture.md` — visão de arquitetura e separação de responsabilidades.
- `docs/roadmap.md` — etapas planejadas de desenvolvimento.
- `docs/security.md` — regras de segurança, PIN, permissões e limites do navegador.
- `docs/backup-recovery.md` — backup, restauração e recuperação.
- `docs/sync-google-sheets.md` — integração externa e critérios para avaliação futura.
- `docs/testing-scenarios.md` — cenários de testes e cobertura automatizada atual.

## Regras centrais do negócio

### Autenticação e permissões
- Login por PIN.
- Perfis de administrador e operador.
- Operações administrativas protegidas por autorização.
- O PIN não deve ser gravado em texto puro.
- O ambiente local do navegador tem limites de segurança, e isso deve ser documentado.

### Produtos e estoque
- Cadastro e edição de produtos.
- Categorias, SKU e EAN.
- Custo, preço de venda e promoções.
- Registro de movimentações e histórico de estoque.
- Vendas podem ocorrer mesmo quando o estoque ficar negativo, conforme regra de negócio.
- Produtos não devem ser removidos fisicamente; devem ser inativados quando necessário.

### Vendas
- Carrinho e checkout.
- Pagamentos em dinheiro, Pix com confirmação manual, débito e crédito.
- Pagamentos combinados.
- Descontos somente para administradores.
- Comprovante exibido na tela.
- Histórico de vendas.
- Operações consistentes e sem gravação parcial.
- Cancelamentos com autorização administrativa e auditoria.
- O operador poderá solicitar cancelamento, mas será necessária reautenticação ou aprovação administrativa antes de efetivá-lo.

### Caixa
- Apenas um caixa aberto por vez.
- Não permitir vendas com caixa fechado.
- Abertura com valor inicial.
- Registro de retiradas (sangrias).
- Registro de entradas adicionais (suprimentos).
- Fechamento com conferência de valores.
- Histórico de sessões.

### Operação offline
- Vendas e registros locais devem ocorrer sem conexão constante.
- A aplicação deve seguir uma estratégia de persistência local e sincronização eventual.
- Operações pendentes devem ser reprocessadas após recuperação da conectividade.

### Integridade e auditoria
- Cada operação sincronizável deve ter identificador único.
- A idempotência deve ser prevista para evitar duplicações.
- Cancelamentos devem ser registrados com auditoria.
- Histórico de vendas e caixa não pode ser apagado de forma irrestrita.
- Backups devem ser previstos para recuperação de dados.

## Limitações e decisões em aberto

- A decisão exata da camada externa de integração com Google Sheets ainda não foi escolhida.
- Opções futuras a avaliar: backend próprio, função serverless ou Google Apps Script.
- A arquitetura atual preserva a flexibilidade para essa escolha sem comprometer a estrutura do sistema.

## Objetivos da etapa documental (concluída)

- Documentar escopo, regras de negócio e arquitetura.
- Definir a organização do repositório.
- Registrar requisitos de segurança, backup e sincronização.
- Manter o projeto em estado evolutivo e seguro.

## Limites da implementação atual

A interface atual oferece configuração inicial do administrador, login por PIN, cadastro de operadores e o fluxo base de abertura/consulta/fechamento do caixa. Ainda não é uma PWA instalável: manifesto e Service Worker serão preparados em uma etapa própria. Os dados do navegador são locais e não substituem backups.
