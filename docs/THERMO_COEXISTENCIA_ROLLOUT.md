# Coexistência entre Intranet e Thermo

## Estado inicial seguro

O legado continua respondendo em `/` e `/menu_produto.html`. O frontend Thermo
fica em `/thermo/` e não é registrado enquanto `THERMO_FRONTEND_ENABLED` não for
igual a `true`.

## Build

O build da hospedagem deve executar, nesta ordem:

```sh
npm ci
npm run build:thermo
```

O comando gera `thermo-web/dist`, que não é versionado. Se a flag estiver ligada
sem esse diretório, `/thermo/` retorna `503` sem afetar o legado.

## Liberação gradual

1. Fazer o merge com `THERMO_FRONTEND_ENABLED` ausente ou `false`.
2. Implantar e validar login, `/`, `/menu_produto.html` e APIs críticas.
3. Confirmar nos logs: `[thermo] frontend { enabled: false, mounted: false }`.
4. Configurar `THERMO_FRONTEND_ENABLED=true` e fazer nova implantação.
5. Confirmar nos logs: `[thermo] frontend { enabled: true, mounted: true }`.
6. Entrar no legado e usar `Usar Thermo`.
7. No Thermo, confirmar que `Sistema atual` retorna ao legado com a mesma sessão.

Não há redirecionamento automático. Cada usuário entra no Thermo por escolha e
pode voltar ao legado a qualquer momento.

## Validação mínima após ativação

- usuário sem sessão recebe `401` em `/thermo/`;
- usuário autenticado abre `/thermo/` e os assets em `/thermo/assets/`;
- atualização em uma rota interna do Thermo retorna o SPA, não `404`;
- `/`, menu, login, logout e APIs do legado continuam funcionando;
- os botões de alternância aparecem em uma única linha do cabeçalho;
- nenhuma permissão ou regra de negócio é alterada.

## Rollback

Definir `THERMO_FRONTEND_ENABLED=false` ou remover a variável e implantar
novamente. O botão desaparece do legado e `/thermo/` deixa de ser registrado. O
rollback não exige banco de dados, migração reversa nem remoção do frontend.
