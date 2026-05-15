# Frontend Migration Instructions - Fromtherm Intranet

## Objetivo

Migrar e melhorar o frontend da Intranet Fromtherm com seguranca, sem interromper o uso do sistema atual.

Stack alvo recomendada:

```txt
Frontend: React + TypeScript + Vite + Tailwind CSS
Backend: manter Node.js + Express
Banco: manter PostgreSQL
Deploy: manter Render
```

## Regra Principal

Nao fazer rewrite total. Usar migracao gradual: tela por tela, modulo por modulo, mantendo o frontend legado funcionando enquanto a nova interface nasce.

## Contexto Atual

O sistema atual usa principalmente:

- `server.js` com Node.js/Express
- PostgreSQL no Render
- frontend legado em HTML/CSS/JavaScript puro
- arquivos grandes como `menu_produto.html`, `menu_produto.css` e `menu_produto.js`

Esses arquivos devem ser tratados como legado critico. Evitar aumentar ainda mais esses arquivos quando a tarefa permitir criar estrutura nova.

## Estrategia Recomendada

1. Manter APIs existentes.
2. Criar um frontend React/Vite em paralelo ao legado.
3. Configurar proxy/dev para consumir o Express local.
4. Migrar uma tela pequena primeiro.
5. Validar desktop e mobile.
6. Redirecionar usuarios para a tela nova somente depois de QA.
7. Remover codigo legado apenas quando a substituicao estiver aprovada.

## Primeiras Telas Candidatas

- Lista de produtos
- Agenda/calendario de reservas
- Detalhe de produto
- Fluxos com muitos modais ou filtros

Priorizar telas com alto uso, muitos problemas visuais, ou baixa responsividade.

## Padrao de UX

Isto e um ERP/intranet operacional. Priorizar:

- clareza
- legibilidade
- densidade organizada
- velocidade de uso
- responsividade real
- estados de erro/carregamento/vazio

Evitar:

- visual de landing page
- hero grande em tela operacional
- gradientes decorativos pesados
- cards demais sem necessidade
- tabelas desktop espremidas no celular
- texto pequeno demais

## Mobile

O mobile nao deve ser copia exata do desktop.

Padroes esperados:

- tabelas viram cards/listas
- calendario mensal pode virar agenda/lista por dia
- filtros podem ir para modal ou drawer
- menu lateral vira drawer ou navegacao compacta
- acoes principais ficam claras e acessiveis

## Componentes Obrigatorios no Novo Front

Criar componentes reutilizaveis para:

- botoes
- inputs/selects
- tabs
- modais
- drawers
- cards
- tabelas/listas
- filtros
- badges/status
- empty states
- loading states
- error states

## Acessibilidade Minima

- botoes so com icone precisam de `aria-label`
- formularios precisam de label
- foco de teclado deve ser visivel
- contraste deve ser legivel em tema escuro
- titulos devem refletir a tela atual

## Uso de Skills

Quando disponivel, usar a skill `ui-ux-pro-max` apenas como apoio de design. As regras da Fromtherm e deste arquivo prevalecem.

Quando disponivel, usar a skill `fromtherm-frontend-migration` para planejar ou executar migracoes de frontend.

## Checklist Antes de PR

- A tela funciona no desktop.
- A tela funciona no mobile.
- Nao ha novo erro no console.
- Nao ha scroll horizontal inesperado.
- Textos nao cortam de forma ruim.
- Menus e modais funcionam.
- Estados vazio/carregando/erro foram tratados.
- A rota antiga continua segura ate a nova ser aprovada.
