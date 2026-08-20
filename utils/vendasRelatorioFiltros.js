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

function parseYmd(value) {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function labelYmdBr(ymd) {
  const [y, m, d] = String(ymd).split('-');
  return `${d}/${m}/${y}`;
}

function mesesEntre(inicioYmd, fimInclusiveYmd) {
  const pad = (n) => String(n).padStart(2, '0');
  const [y1, m1] = String(inicioYmd).split('-').map(Number);
  const [y2, m2] = String(fimInclusiveYmd).split('-').map(Number);
  const meses = [];
  let y = y1;
  let m = m1;
  while (y < y2 || (y === y2 && m <= m2)) {
    meses.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (meses.length > 120) break;
  }
  return meses;
}

/**
 * Data início/fim têm prioridade. Depois ano/mês/trimestre, depois o select "Período".
 */
function calcPeriodoComFiltros(filtros = {}, refDate = new Date()) {
  const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const pad = (n) => String(n).padStart(2, '0');
  const fmtYmd = (y, m, d = 1) => `${y}-${pad(m)}-${pad(d)}`;
  const mesLabel = (y, m) => `${nomesMes[m - 1]}/${y}`;

  const dataIni = parseYmd(filtros.data_inicio);
  const dataFim = parseYmd(filtros.data_fim);
  if (dataIni && dataFim) {
    const inicio = dataIni <= dataFim ? dataIni : dataFim;
    const fim = dataIni <= dataFim ? dataFim : dataIni;
    const meses = mesesEntre(inicio, fim);
    return {
      modo: 'filtro',
      mesRef: inicio.slice(0, 7),
      inicio,
      fimExclusive: addDaysYmd(fim, 1),
      label: `${labelYmdBr(inicio)} a ${labelYmdBr(fim)}`,
      meses,
      evolucaoTipo: meses.length > 1 ? 'mes' : 'semana',
    };
  }

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

function parseListaFiltro(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((v) => String(v || '').trim()).filter(Boolean))];
  }
  return [...new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )];
}

function parseFiltrosRelatorio(query = {}) {
  return {
    modo: String(query.modo || 'mes').trim().toLowerCase(),
    etapa: String(query.etapa || 'entregue').trim().toLowerCase(),
    data_inicio: String(query.data_inicio || '').trim(),
    data_fim: String(query.data_fim || '').trim(),
    ano: String(query.ano || '').trim(),
    mes: String(query.mes || '').trim(),
    trimestre: String(query.trimestre || '').trim(),
    vendedor: String(query.vendedor || '').trim(),
    familia: parseListaFiltro(query.familia),
    familia_nome: String(query.familia_nome || '').trim(),
    estado: String(query.estado || '').trim().toUpperCase(),
    tipo: String(query.tipo || '').trim(),
    cliente: String(query.cliente || '').trim(),
    etapa_pedido: String(query.etapa_pedido || '').trim(),
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

  if (filtros.cliente) {
    params.push(filtros.cliente);
    const idx = params.length;
    clausesPedido.push(
      `AND COALESCE(
        NULLIF(TRIM(f.nome_fantasia), ''),
        NULLIF(TRIM(f.razao_social), ''),
        NULLIF(TRIM(nf.payload_ultimo->'nfDestInt'->>'cRazao'), ''),
        '(sem cliente)'
      ) = $${idx}`
    );
  }

  if (filtros.etapa_pedido) {
    params.push(filtros.etapa_pedido);
    const idx = params.length;
    clausesPedido.push(
      `AND (
        CASE
          WHEN p.codigo_pedido IS NULL THEN '70'
          ELSE TRIM(COALESCE(p.etapa::text, ''))
        END
      ) = $${idx}`
    );
  }

  if (Array.isArray(filtros.familia) ? filtros.familia.length : filtros.familia) {
    const familias = Array.isArray(filtros.familia)
      ? filtros.familia.map((v) => String(v || '').trim()).filter(Boolean)
      : [String(filtros.familia).trim()].filter(Boolean);
    if (familias.length) {
      params.push(familias);
      const idx = params.length;
      const exists = `EXISTS (
      SELECT 1
        FROM vendas.pedidos_venda_itens ix
        JOIN produto.produtos_omie pox ON TRIM(pox.codigo) = TRIM(ix.codigo)
       WHERE ix.codigo_pedido = p.codigo_pedido
         AND TRIM(COALESCE(pox.codigo_familia::text, '')) = ANY($${idx}::text[])
    )`;
      clausesPedido.push(`AND ${exists}`);
      clausesItem.push(`AND TRIM(COALESCE(po.codigo_familia::text, '')) = ANY($${idx}::text[])`);
    }
  }

  if (filtros.familia_nome) {
    params.push(filtros.familia_nome);
    const idx = params.length;
    const existsNome = `EXISTS (
      SELECT 1
        FROM vendas.pedidos_venda_itens ix
        JOIN produto.produtos_omie pox ON TRIM(pox.codigo) = TRIM(ix.codigo)
       WHERE ix.codigo_pedido = p.codigo_pedido
         AND COALESCE(NULLIF(TRIM(pox.descricao_familia), ''), '(sem família)') = $${idx}
    )`;
    clausesPedido.push(`AND ${existsNome}`);
    clausesItem.push(`AND COALESCE(NULLIF(TRIM(po.descricao_familia), ''), '(sem família)') = $${idx}`);
  }

  if (filtros.tipo) {
    const tipoNorm = String(filtros.tipo).padStart(2, '0');
    params.push(tipoNorm);
    const idx = params.length;
    const exists = `EXISTS (
      SELECT 1
        FROM vendas.pedidos_venda_itens ix
        JOIN produto.produtos_omie pox ON TRIM(pox.codigo) = TRIM(ix.codigo)
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
