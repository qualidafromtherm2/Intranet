# Produção 3D

Cena 3D isolada (Three.js) para acompanhar a **produção**.

- Mesmo tipo de barracão e navegação do **Explorar 3D** (WASD + mouse / touch).
- Em vez de porta-pallet: **esteira com roletes**.
- Fotos dos produtos das OPs em `"Producao"."OP_producao"`.

## Como abrir

1. Intranet → menu lateral **Produção** → **Produção 3D**
2. Ou direto: `/producao-3d/`
3. Neste PC (WebGL): `./producao-3d/abrir-com-gpu.sh`

## API

`GET /api/producao/cena-3d` — lista OPs + `foto_url` (proxy: `/api/prateleiras3d/foto`).

## Remover

Apague a pasta `producao-3d/`, o botão `#menu-producao-3d`, o painel `#producao3dPane` e a rota `/cena-3d` em `routes/producao.js`.
