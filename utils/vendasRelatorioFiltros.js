'use strict';

const TIPO_ITEM_LABEL = {
  '00': 'Mercadoria para Revenda',
  '01': 'Matéria-Prima',
  '02': 'Embalagem',
  '03': 'Embalagem',
  '04': 'Produto Acabado',
  '05': 'Subproduto',
  '06': 'Produto Intermediário',
  '07': 'Material de Uso e Consumo',
  '08': 'Ativo Imobilizado',
  '09': 'Serviços',
  '10': 'Outros insumos',
  '99': 'Outras',
};

function labelTipoItem(codigo) {
  const c = String(codigo || '').trim().padStart(2, '0');
  if (!c || c === '0') return '(sem tipo)';
  return TIPO_ITEM_LABEL[c] || `Tipo ${c}`;
}

function mesAtualReferencia(refDate = new Date()) {
  const ano = refDate.getFullYear();
  const mesNum = refDate.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, '0');
  return { ano, mesNum, mesRaw: `${ano}-${pad(mesNum)}` };
}

function calcPeriodo(modoRaw, refDate = new Date()) {
  const modosValidos = new Set(['mes', '3m', '6m', 'anual']);
  const modo = modosValidos.has(modoRaw) ? modoRaw : 'mes';
  const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const { ano, mesNum, mesRaw } = mesAtualReferencia(refDate);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtYmd = (y, m, d = 1) => `${y}-${pad(m)}-${pad(d)}`;
  const mesLabel = (y, m) => (m >= 1 && m <= 12 ? `${nomesMes[m - 1]}/${y}` : `${y}-${pad(m)}`);

  if (modo === 'mes') {
    const nextM = mesNum === 12 ? 1 : mesNum + 1;
    const nextY = mesNum === 12 ? ano + 1 : ano;
    return {
      modo,
      mesRef: mesRaw,
      inicio: fmtYmd(ano, mesNum),
      fimExclusive: fmtYmd(nextY, nextM),
      label: mesLabel(ano, mesNum),
      meses: [mesRaw],
      evolucaoTipo: 'semana',
    };
  }

  const qtd = modo === '3m' ? 3 : (modo === '6m' ? 6 : 12);
  const inicioDate = new Date(ano, mesNum - 1 - qtd, 1);
  const meses = [];
  for (let i = 0; i < qtd; i += 1) {
    const d = new Date(inicioDate.getFullYear(), inicioDate.getMonth() + i, 1);
    meses.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  const fimY = mesNum === 1 ? ano - 1 : ano;
  const fimM = mesNum === 1 ? 12 : mesNum - 1;

  return {
    modo,
    mesRef: mesRaw,
    inicio: fmtYmd(inicioDate.getFullYear(), inicioDate.getMonth() + 1),
    fimExclusive: fmtYmd(ano, mesNum),
    label: `${mesLabel(inicioDate.getFullYear(), inicioDate.getMonth() + 1)} a ${mesLabel(fimY, fimM)}`,
    meses,
    evolucaoTipo: 'mes',
  };
}

/**
 * Ano / mês / trimestre têm prioridade sobre o select "Período".
 */
function calcPeriodoComFiltros(filtros = {}, refDate = new Date()) {
  const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const pad = (n) => String(n).padStart(2, '0');
  const fmtYmd = (y, m, d = 1) => `${y}-${pad(m)}-${pad(d)}`;
  const mesLabel = (y, m) => `${nomesMes[m - 1]}/${y}`;

  const ano = Number.parseInt(String(filtros.ano || '').trim(), 10);
  const mes = Number.parseInt(String(filtros.mes || '').trim(), 10);
  const tri = Number.parseInt(String(filtros.trimestre || '').trim(), 10);
  const { mesRaw } = mesAtualReferencia(refDate);

  if (Number.isFinite(ano) && ano >= 2000 && ano <= 2100 && Number.isFinite(mes) && mes >= 1 && mes <= 12) {
    const nextM = mes === 12 ? 1 : mes + 1;
    const nextY = mes === 12 ? ano + 1 : ano;
    return {
      modo: 'filtro',
      mesRef: mesRaw,
      inicio: fmtYmd(ano, mes),
      fimExclusive: fmtYmd(nextY, nextM),
      label: mesLabel(ano, mes),
      meses: [`${ano}-${pad(mes)}`],
      evolucaoTipo: 'semana',
    };
  }

  if (Number.isFinite(ano) && ano >= 2000 && ano <= 2100 && Number.isFinite(tri) && tri >= 1 && tri <= 4) {
    const mesIni = (tri - 1) * 3 + 1;
    const mesFim = mesIni + 2;
    const nextM = mesFim === 12 ? 1 : mesFim + 1;
    const nextY = mesFim === 12 ? ano + 1 : ano;
    const meses = [];
    for (let m = mesIni; m <= mesFim; m += 1) meses.push(`${ano}-${pad(m)}`);
    return {
      modo: 'filtro',
      mesRef: mesRaw,
      inicio: fmtYmd(ano, mesIni),
      fimExclusive: fmtYmd(nextY, nextM),
      label: `${tri}º trimestre/${ano}`,
      meses,
      evolucaoTipo: 'mes',
    };
  }

  if (Number.isFinite(ano) && ano >= 2000 && ano <= 2100) {
    return {
      modo: 'filtro',
      mesRef: mesRaw,
      inicio: fmtYmd(ano, 1),
      fimExclusive: fmtYmd(ano + 1, 1),
      label: `Ano ${ano}`,
      meses: Array.from({ length: 12 }, (_, i) => `${ano}-${pad(i + 1)}`),
      evolucaoTipo: 'mes',
    };
  }

  return calcPeriodo(filtros.modo || 'mes', refDate);
}

function parseFiltrosRelatorio(query = {}) {
  return {
    modo: String(query.modo || 'mes').trim().toLowerCase(),
    etapa: String(query.etapa || 'entregue').trim().toLowerCase(),
    ano: String(query.ano || '').trim(),
    mes: String(query.mes || '').trim(),
    trimestre: String(query.trimestre || '').trim(),
    vendedor: String(query.vendedor || '').trim(),
    familia: String(query.familia || '').trim(),
    estado: String(query.estado || '').trim().toUpperCase(),
    tipo: String(query.tipo || '').trim(),
  };
}

/**
 * Cláusulas extras ($3+) para filtros de pedido/item.
 * params já deve conter [inicio, fimExclusive].
 */
function appendFiltrosSql(filtros, params) {
  const clausesPedido = [];
  const clausesItem = [];

  if (filtros.vendedor) {
    params.push(filtros.vendedor);
    const idx = params.length;
    clausesPedido.push(
      `AND TRIM(COALESCE(p.informacoes_adicionais->>'codVend', '')) = $${idx}`
    );
  }

  if (filtros.estado) {
    params.push(filtros.estado);
    const idx = params.length;
    clausesPedido.push(
      `AND UPPER(TRIM(COALESCE(f.estado, ''))) = $${idx}`
    );
  }

  if (filtros.familia) {
    params.push(filtros.familia);
    const idx = params.length;
    const exists = `EXISTS (
      SELECT 1
        FROM "Vendas".pedidos_venda_itens ix
        JOIN public.produtos_omie pox ON TRIM(pox.codigo) = TRIM(ix.codigo)
       WHERE ix.codigo_pedido = p.codigo_pedido
         AND TRIM(COALESCE(pox.codigo_familia::text, '')) = $${idx}
    )`;
    clausesPedido.push(`AND ${exists}`);
    clausesItem.push(`AND TRIM(COALESCE(po.codigo_familia::text, '')) = $${idx}`);
  }

  if (filtros.tipo) {
    const tipoNorm = String(filtros.tipo).padStart(2, '0');
    params.push(tipoNorm);
    const idx = params.length;
    const exists = `EXISTS (
      SELECT 1
        FROM "Vendas".pedidos_venda_itens ix
        JOIN public.produtos_omie pox ON TRIM(pox.codigo) = TRIM(ix.codigo)
       WHERE ix.codigo_pedido = p.codigo_pedido
         AND LPAD(TRIM(COALESCE(pox.tipoitem, '')), 2, '0') = $${idx}
    )`;
    clausesPedido.push(`AND ${exists}`);
    clausesItem.push(`AND LPAD(TRIM(COALESCE(po.tipoitem, '')), 2, '0') = $${idx}`);
  }

  return {
    pedidoSql: clausesPedido.join('\n        '),
    itemSql: clausesItem.join('\n      '),
  };
}

module.exports = {
  TIPO_ITEM_LABEL,
  labelTipoItem,
  mesAtualReferencia,
  calcPeriodo,
  calcPeriodoComFiltros,
  parseFiltrosRelatorio,
  appendFiltrosSql,
};
