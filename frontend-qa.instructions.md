# Frontend QA Instructions - Fromtherm Intranet

Use este checklist ao avaliar ou entregar qualquer alteracao visual no frontend.

## Viewports Obrigatorios

Validar pelo menos:

```txt
390x844   mobile
768x1024  tablet
1366x768  notebook
1440x900  desktop
```

## Carregamento

- A pagina abre no localhost.
- O console nao possui novos erros.
- O carregamento nao fica preso sem feedback.
- Recarregar a pagina mantem a rota correta quando aplicavel.

## Layout

- Nao existe area branca inesperada fora do app.
- Nao existe scroll horizontal na pagina inteira.
- Header, sidebar, drawer e botoes flutuantes nao cobrem conteudo.
- Textos cabem em botoes, cards, badges e tabelas.
- Componentes fixos continuam corretos em notebook e mobile.

## Navegacao

- Menu principal funciona no desktop.
- Menu principal tem alternativa clara no mobile.
- Tabs indicam a tela ativa corretamente.
- URL/hash/rota refletem a tela atual quando aplicavel.
- Refresh ou deep link nao leva o usuario para tela errada.

## Legibilidade

- Evitar texto abaixo de 12px.
- Garantir contraste em textos cinza sobre fundo escuro.
- Badges e status precisam ser legiveis.
- Tabelas e cards precisam permitir escaneamento rapido.

## Mobile

- Tabelas grandes viram cards/listas ou possuem scroll interno intencional.
- Calendario mensal nao deve ficar ilegivel; usar agenda/lista se necessario.
- Filtros podem abrir em drawer/modal.
- Acoes principais devem ser faceis de tocar.
- Elementos clicaveis devem ter tamanho confortavel.

## Acessibilidade

- Botoes so com icone possuem `aria-label` ou `title`.
- Inputs possuem labels.
- Campos de senha possuem autocomplete adequado quando aplicavel.
- Foco de teclado e visivel.
- Headings visiveis representam a tela atual.

## Estados

Validar quando relevante:

- carregando
- vazio
- erro de rede
- permissao negada
- sucesso
- validacao de formulario

## Evidencia Recomendada

Ao concluir uma avaliacao, registrar:

- URL testada
- viewports testados
- principais problemas encontrados
- screenshots quando houver alteracao visual relevante
- erros de console, se existirem
