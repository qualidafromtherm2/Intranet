# Thermo Web Pilot

Piloto local da migração da Lista de Produtos para React + TypeScript + Tailwind + Vite.

## Modos

- `npm run dev` ou `npm run dev:demo`
  - sobe em `http://127.0.0.1:4173`
  - usa fixtures locais, sem `.env` e sem credenciais
- `npm run dev:proxy`
  - sobe em `http://127.0.0.1:4173`
  - faz proxy de `/api/*` para `http://127.0.0.1:3000`
  - depende do backend legado ativo e autenticado

## Validação

- `npm run build`
- `npm run test`
- `npm run lint`
