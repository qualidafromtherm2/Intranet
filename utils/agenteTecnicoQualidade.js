/**
 * Agente ajudante do técnico (setor Qualidade).
 * Lookups fixos: série/pedido, NF, OS e análise de problema.
 */
'use strict';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsuarioQualidade(req) {
  const setor = normalizeText(req?.session?.user?.setor || req?.session?.user?.sector || '');
  return setor === 'qualidade' || setor.includes('qualidade');
}

function extrairSerieDaPergunta(texto) {
  const raw = String(texto || '');
  const patterns = [
    /\b(?:serie|s[eé]rie|pedido|ns|n[ºo]\s*s[eé]rie)\s*[:=\-]?\s*([A-Za-z0-9\-]{3,30})\b/i,
    /\b(?:analis[ae]|analise|problema|congel\w*|gelo\w*|degelo\w*).*?\b([0-9]{3,8})\b/i,
    /\b([0-9]{3,8})\b.*\b(?:congel\w*|gelo\w*|degelo\w*|problema|nao\s+esquenta|n[aã]o\s+esquenta)\b/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) return String(m[1]).trim();
  }
  // Número isolado no início seguido de texto livre (ex.: "6902 congelando por fora")
  const inicio = raw.match(/^\s*([0-9]{3,8})\b/);
  if (inicio?.[1] && /\b(congel|gelo|degelo|problema|analis|erro|sintoma)/i.test(raw)) {
    return String(inicio[1]).trim();
  }
  return '';
}

function extrairNfDaPergunta(texto) {
  const raw = String(texto || '');
  const m = raw.match(/\b(?:nf\-?e?|nota\s*fiscal|nfe)\s*[:=\-]?\s*([0-9]{3,12})\b/i);
  return m?.[1] ? String(m[1]).trim() : '';
}

function extrairSintomaDaPergunta(texto) {
  const t = normalizeText(texto);
  if (!t) return '';
  const trechos = [];
  if (/\bcongel|\bgelo|\bdegelo/.test(t)) trechos.push('congelando / formação de gelo');
  if (/\bnao\s+esquenta|nao\s+aquece|baixo\s+rendimento|nao\s+rende/.test(t)) trechos.push('baixo rendimento / não esquenta');
  if (/\bwifi|pareamento|internet|conexao/.test(t)) trechos.push('Wi-Fi / pareamento');
  if (/\bbarulho|ruido|vibr/.test(t)) trechos.push('ruído / vibração');
  if (/\bvazamento|vazando/.test(t)) trechos.push('vazamento');
  if (/\berro\s*e?\d+/.test(t)) {
    const em = String(texto).match(/\bE\d{2,3}\b/i);
    if (em) trechos.push(`código ${em[0].toUpperCase()}`);
  }
  return trechos.join('; ') || String(texto || '').trim().slice(0, 200);
}

function detectarIntencaoTecnica(pergunta) {
  const t = normalizeText(pergunta);
  if (!t) return null;

  const nf = extrairNfDaPergunta(pergunta);
  if (nf && /\b(nf|nfe|nota)\b/.test(t)) {
    return { action: 'lookup_nf', data: { nf, pedido: '' } };
  }

  const serie = extrairSerieDaPergunta(pergunta);
  const pareceAnalise = /\b(analis|congel|gelo|degelo|problema|sintoma|diagnost|nao\s+esquenta|baixo\s+rendimento|erro\s*e?\d+)/.test(t);
  if (serie && pareceAnalise) {
    return {
      action: 'analise_problema',
      data: { serie, sintoma: extrairSintomaDaPergunta(pergunta) }
    };
  }

  if (serie && /\b(serie|pedido|modelo|maquina|equipamento|ficha|resumo|localiz|buscar|consulta)\b/.test(t)) {
    return { action: 'lookup_serie', data: { serie } };
  }

  // Número sozinho curto → lookup série (técnico digitando só o NS)
  if (/^\s*[0-9]{3,8}\s*$/.test(String(pergunta || ''))) {
    return { action: 'lookup_serie', data: { serie: String(pergunta).trim() } };
  }

  return null;
}

function extrairLetraComposicao(modelo) {
  const m = String(modelo || '').toUpperCase().replace(/\s+/g, '');
  const match = m.match(/^(?:FTI?|FH)(\d+)([BDFHJL])(\d{2})/i);
  return match ? String(match[2]).toUpperCase() : '';
}

function formatarDataBr(valor) {
  if (!valor) return '—';
  try {
    const d = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor);
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch (_) {
    return String(valor);
  }
}

function formatarMoedaBr(valor) {
  const n = Number(String(valor || '').replace(',', '.'));
  if (!Number.isFinite(n)) return valor ? String(valor) : '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function lookupEquipamentoPorSerie(pool, serieRaw) {
  const serie = String(serieRaw || '').trim();
  if (!serie || serie.length < 2) {
    return { ok: false, error: 'Informe o número de série / pedido (mín. 2 caracteres).' };
  }

  const fontes = [];

  const { rows: cacheRows } = await pool.query(
    `
    SELECT fonte, pedido, ordem_producao, modelo, cliente,
           data_venda, nota_fiscal, chave_nfe, data_entrega, teste_tipo_gas
      FROM sac.at_serie_cache
     WHERE UPPER(TRIM(COALESCE(pedido, ''))) = UPPER($1)
        OR UPPER(TRIM(COALESCE(ordem_producao, ''))) = UPPER($1)
        OR UPPER(TRIM(COALESCE(pedido, ''))) LIKE UPPER($1) || '%'
     ORDER BY
       CASE WHEN UPPER(TRIM(COALESCE(pedido, ''))) = UPPER($1) THEN 0
            WHEN UPPER(TRIM(COALESCE(ordem_producao, ''))) = UPPER($1) THEN 1
            ELSE 2 END
     LIMIT 5
    `,
    [serie]
  );

  for (const r of cacheRows) {
    fontes.push({
      fonte: r.fonte || 'at_serie_cache',
      pedido: r.pedido,
      ordem_producao: r.ordem_producao,
      modelo: r.modelo,
      cliente: r.cliente,
      nota_fiscal: r.nota_fiscal,
      chave_nfe: r.chave_nfe,
      data_entrega: r.data_entrega,
      data_venda: r.data_venda,
      teste_tipo_gas: r.teste_tipo_gas,
      controlador: null,
      situacao: null,
      uf: null,
      representante: null,
      valor: null,
      transportadora: null,
    });
  }

  const { rows: preRows } = await pool.query(
    `
    SELECT *
      FROM public.historico_pre2024
     WHERE TRIM(pedido) = $1
        OR TRIM(COALESCE(numero_op_informacoes, '')) = $1
        OR TRIM(COALESCE(nfe, '')) = $1
     ORDER BY CASE WHEN TRIM(pedido) = $1 THEN 0 ELSE 1 END
     LIMIT 5
    `,
    [serie]
  );

  for (const r of preRows) {
    fontes.push({
      fonte: 'historico_pre2024',
      pedido: r.pedido,
      ordem_producao: r.numero_op_informacoes,
      modelo: r.modelo,
      cliente: r.nome_fantasia_revende || r.razao_social_faturamento,
      cliente_faturamento: r.razao_social_faturamento,
      nota_fiscal: r.nfe,
      chave_nfe: null,
      data_entrega: r.data_entrega,
      data_venda: r.data_aprovacao_pedido || r.data_entrada_pedido,
      data_entrada_pedido: r.data_entrada_pedido,
      data_aprovacao_pedido: r.data_aprovacao_pedido,
      data_op: r.data_op,
      data_prevista_entrega: r.data_prevista_entrega,
      teste_tipo_gas: null,
      controlador: r.control,
      situacao: r.situacao,
      uf: r.uf,
      representante: r.representante,
      valor: r.valor,
      transportadora: r.transportadora,
      forma_pgto: r.forma_pgto,
      cond_pagto: r.cond_pagto,
      tipo_quadro: r.tipo_quadro,
      esq_esf: r.esq_esf,
      quantidade: r.quantidade,
      ano: r.ano,
    });
  }

  if (!fontes.length) {
    return {
      ok: false,
      error: `Não encontrei o pedido/série "${serie}" no cache AT nem no histórico pré-2024.`,
      serie
    };
  }

  // Prefer exact pedido match, then pre2024 if that's the only exact
  const exact = fontes.find((f) => String(f.pedido || '').trim() === serie) || fontes[0];
  return { ok: true, serie, equipamento: exact, alternativas: fontes.slice(0, 5) };
}

async function lookupNf(pool, { nf, pedido } = {}) {
  const nfNorm = String(nf || '').trim().replace(/^0+/, '') || String(nf || '').trim();
  const pedidoNorm = String(pedido || '').trim();
  if (!nfNorm && !pedidoNorm) {
    return { ok: false, error: 'Informe o número da NF ou do pedido.' };
  }

  const resultados = [];

  if (nfNorm || pedidoNorm) {
    const { rows } = await pool.query(
      `
      SELECT numero_nota, chave_nfe, numero_pedido, valor_total, razao_emitente,
             data_emissao, cnpj_emitente, url_danfe, id_nf_omie
        FROM "Vendas".notas_fiscais_omie
       WHERE ($1::text <> '' AND (
               TRIM(COALESCE(numero_nota, '')) = $1
            OR LTRIM(TRIM(COALESCE(numero_nota, '')), '0') = LTRIM($1, '0')
         ))
          OR ($2::text <> '' AND TRIM(COALESCE(numero_pedido, '')) = $2)
       ORDER BY data_emissao DESC NULLS LAST
       LIMIT 10
      `,
      [nfNorm, pedidoNorm]
    );
    for (const r of rows) {
      resultados.push({
        fonte: 'Vendas.notas_fiscais_omie',
        numero_nota: r.numero_nota,
        chave_nfe: r.chave_nfe,
        pedido: r.numero_pedido,
        valor_total: r.valor_total,
        emitente: r.razao_emitente,
        data_emissao: r.data_emissao,
        url_danfe: r.url_danfe,
      });
    }
  }

  if (nfNorm || pedidoNorm) {
    const { rows: pre } = await pool.query(
      `
      SELECT pedido, nfe, modelo, nome_fantasia_revende, razao_social_faturamento,
             valor, data_entrega, uf, representante
        FROM public.historico_pre2024
       WHERE ($1::text <> '' AND (
               TRIM(COALESCE(nfe, '')) = $1
            OR LTRIM(TRIM(COALESCE(nfe, '')), '0') = LTRIM($1, '0')
         ))
          OR ($2::text <> '' AND TRIM(pedido) = $2)
       LIMIT 10
      `,
      [nfNorm, pedidoNorm]
    );
    for (const r of pre) {
      resultados.push({
        fonte: 'historico_pre2024',
        numero_nota: r.nfe,
        chave_nfe: null,
        pedido: r.pedido,
        valor_total: r.valor,
        emitente: r.razao_social_faturamento || r.nome_fantasia_revende,
        data_emissao: r.data_entrega,
        modelo: r.modelo,
        uf: r.uf,
        representante: r.representante,
      });
    }
  }

  if (!resultados.length) {
    return {
      ok: false,
      error: `Não encontrei NF${nfNorm ? ` ${nfNorm}` : ''}${pedidoNorm ? ` / pedido ${pedidoNorm}` : ''}.`
    };
  }

  return { ok: true, notas: resultados };
}

async function lookupOsPorSerie(pool, serieRaw) {
  const serie = String(serieRaw || '').trim();
  if (!serie) return { ok: true, os: [] };

  const { rows: sel } = await pool.query(
    `
    SELECT s.id_at, s.pedido, s.ordem_producao, s.modelo, s.cliente,
           a.data, a.tipo, a.nome_revenda_cliente, a.modelo AS at_modelo,
           a.tag_problema, a.descreva_reclamacao, a.status, a.motivo_solicitacao,
           a.numero_telefone, a.cidade, a.estado
      FROM sac.at_busca_selecionada s
      JOIN sac.at a ON a.id = s.id_at
     WHERE TRIM(COALESCE(s.pedido, '')) = $1
        OR TRIM(COALESCE(s.ordem_producao, '')) = $1
        OR TRIM(COALESCE(s.pedido, '')) LIKE $1 || '%'
     ORDER BY a.data DESC NULLS LAST, s.id_at DESC
     LIMIT 20
    `,
    [serie]
  );

  const { rows: texto } = await pool.query(
    `
    SELECT id, data, tipo, nome_revenda_cliente, modelo, tag_problema, status,
           descreva_reclamacao, motivo_solicitacao, cidade, estado, numero_telefone
      FROM sac.at
     WHERE descreva_reclamacao ILIKE '%' || $1 || '%'
        OR motivo_solicitacao ILIKE '%' || $1 || '%'
        OR atendimento_inicial ILIKE '%' || $1 || '%'
     ORDER BY data DESC NULLS LAST
     LIMIT 15
    `,
    [serie]
  );

  const map = new Map();
  for (const r of [...sel, ...texto]) {
    const id = String(r.id_at || r.id);
    if (!map.has(id)) {
      map.set(id, {
        id,
        data: r.data,
        tipo: r.tipo,
        cliente: r.nome_revenda_cliente || r.cliente,
        modelo: r.at_modelo || r.modelo,
        tag_problema: r.tag_problema,
        status: r.status,
        reclamacao: r.descreva_reclamacao,
        motivo: r.motivo_solicitacao,
        cidade: r.cidade,
        estado: r.estado,
        telefone: r.numero_telefone,
        pedido: r.pedido || null,
        ordem_producao: r.ordem_producao || null,
      });
    }
  }

  return { ok: true, os: Array.from(map.values()) };
}

async function carregarAlimentacaoDegelo(pool, modelo) {
  const letra = extrairLetraComposicao(modelo);
  if (!letra) return { letra: null, alimentacao: null, degelo: null };
  const { rows } = await pool.query(
    `SELECT letra_codigo, alimentacao, degelo
       FROM sac.alimentacao
      WHERE UPPER(TRIM(letra_codigo)) = UPPER($1)
      LIMIT 1`,
    [letra]
  );
  if (!rows.length) return { letra, alimentacao: null, degelo: null };
  return {
    letra,
    alimentacao: rows[0].alimentacao,
    degelo: rows[0].degelo
  };
}

async function buscarTrechosManualPorModelo(pool, modelo, sintoma) {
  const m = String(modelo || '').toUpperCase().replace(/\s+/g, '');
  const familia = m.startsWith('FTI') ? 'FTI' : m.startsWith('FH') ? 'FH' : m.startsWith('FT') ? 'FT' : '';
  const capacidade = (m.match(/(\d+)/) || [])[1] || '';
  const sintNorm = normalizeText(sintoma);
  const termosSintoma = [];
  if (/\bcongel|\bgelo|\bdegelo/.test(sintNorm)) termosSintoma.push('degelo', 'congel');
  if (/\berro|sensor|pressao|fluxo/.test(sintNorm)) termosSintoma.push('erro', 'sensor');
  if (!termosSintoma.length) termosSintoma.push('degelo', 'problema');

  const likeFamilia = familia === 'FTI'
    ? '%fti%'
    : familia === 'FH'
      ? '%fh-%'
      : '%ft-%';

  const { rows } = await pool.query(
    `
    SELECT m.nome_arquivo, c.pagina_inicial, c.pagina_final, left(c.texto, 900) AS trecho
      FROM "Chatbot".manuais_instrucao_chunks c
      JOIN "Chatbot".manuais_instrucao m ON m.id = c.manual_id
     WHERE COALESCE(m.status_indexacao, 'pendente') = 'indexado'
       AND lower(COALESCE(m.nome_arquivo, '')) LIKE $1
       AND (
         lower(COALESCE(c.texto, '')) LIKE '%' || $2 || '%'
         OR lower(COALESCE(c.texto, '')) LIKE '%' || $3 || '%'
       )
     ORDER BY
       CASE WHEN $4 <> '' AND lower(COALESCE(m.nome_arquivo, '')) LIKE '%' || lower($4) || '%' THEN 0 ELSE 1 END,
       c.pagina_inicial ASC NULLS LAST
     LIMIT 4
    `,
    [likeFamilia, termosSintoma[0], termosSintoma[1] || termosSintoma[0], capacidade]
  );

  return rows;
}

async function analisarProblemaEquipamento(pool, { serie, sintoma } = {}) {
  const lookup = await lookupEquipamentoPorSerie(pool, serie);
  if (!lookup.ok) return lookup;

  const eq = lookup.equipamento;
  const [alim, osInfo, manuais] = await Promise.all([
    carregarAlimentacaoDegelo(pool, eq.modelo),
    lookupOsPorSerie(pool, eq.pedido || serie),
    buscarTrechosManualPorModelo(pool, eq.modelo, sintoma)
  ]);

  const observacoes = [];
  const sint = normalizeText(sintoma);
  if (/\bcongel|\bgelo|\bdegelo/.test(sint)) {
    if (normalizeText(alim.degelo || '').includes('sem degelo')) {
      observacoes.push(
        `O modelo ${eq.modelo} tem letra ${alim.letra || '?'} = ${alim.degelo} (${alim.alimentacao || 'tensão n/d'}). ` +
        'Não há ciclo de degelo a gás quente: gelo externo em clima frio/úmido é esperado e não derrete sozinho como nos modelos com degelo.'
      );
      observacoes.push(
        'Orientações: desligar e esperar derreter (não quebrar o gelo); conferir ventilação e limpeza da serpentina; se o gelo volta rápido e o aquecimento fica fraco, avaliar assistência (vazão, instalação ou carga de gás).'
      );
    } else if (normalizeText(alim.degelo || '').includes('com degelo')) {
      observacoes.push(
        `O modelo ${eq.modelo} é ${alim.degelo} (${alim.alimentacao || 'tensão n/d'}). Com ambiente ≤ ~8 °C o equipamento deve entrar em degelo automático.`
      );
      observacoes.push(
        'Se o gelo não some ou volta rápido, checar sensor de evaporador, ventilador e possível baixa de gás (casos similares de qualidade).'
      );
    } else {
      observacoes.push('Não foi possível decodificar degelo pelo modelo; confirme a letra de composição na etiqueta.');
    }
  }

  return {
    ok: true,
    serie: eq.pedido || serie,
    sintoma: sintoma || '',
    equipamento: eq,
    alimentacao: alim,
    os: osInfo.os || [],
    manuais,
    observacoes
  };
}

function formatarEquipamentoTexto(resultado) {
  if (!resultado?.ok) return resultado?.error || 'Equipamento não encontrado.';
  const eq = resultado.equipamento;
  const linhas = [
    `Série / pedido ${eq.pedido || resultado.serie} — fonte: ${eq.fonte}`,
    '',
    'Identificação',
    `• Pedido (nº série): ${eq.pedido || '—'}`,
    `• Modelo: ${eq.modelo || '—'}`,
    `• Controlador: ${eq.controlador || '—'}`,
    `• OP: ${eq.ordem_producao || '—'}`,
    `• Situação: ${eq.situacao || '—'}`,
    '',
    'Cliente / venda',
    `• Revenda/cliente: ${eq.cliente || '—'}`,
    eq.cliente_faturamento ? `• Faturamento: ${eq.cliente_faturamento}` : null,
    `• UF: ${eq.uf || '—'}`,
    `• Representante: ${eq.representante || '—'}`,
    `• NF-e: ${eq.nota_fiscal || '—'}`,
    `• Valor: ${formatarMoedaBr(eq.valor)}`,
    eq.forma_pgto ? `• Pagamento: ${eq.forma_pgto}${eq.cond_pagto ? ` (cond. ${eq.cond_pagto})` : ''}` : null,
    '',
    'Datas',
    `• Entrada/aprovação: ${formatarDataBr(eq.data_aprovacao_pedido || eq.data_entrada_pedido || eq.data_venda)}`,
    `• Abertura OP: ${formatarDataBr(eq.data_op)}`,
    `• Previsão entrega: ${formatarDataBr(eq.data_prevista_entrega)}`,
    `• Entrega/faturamento: ${formatarDataBr(eq.data_entrega)}`,
  ];

  if (eq.transportadora || eq.tipo_quadro || eq.esq_esf) {
    linhas.push('', 'Logística / opções');
    if (eq.transportadora) linhas.push(`• Transportadora: ${eq.transportadora}`);
    if (eq.tipo_quadro) linhas.push(`• Quadro externo: ${eq.tipo_quadro}`);
    if (eq.esq_esf) linhas.push(`• Esq/esférico: ${eq.esq_esf}`);
    if (eq.quantidade) linhas.push(`• Quantidade: ${eq.quantidade}`);
  }

  if (resultado.alternativas?.length > 1) {
    linhas.push('', `Outros registros relacionados: ${resultado.alternativas.length - 1}`);
  }

  return linhas.filter((l) => l !== null).join('\n');
}

function formatarNfTexto(resultado) {
  if (!resultado?.ok) return resultado?.error || 'NF não encontrada.';
  return resultado.notas.map((n, i) => ([
    `${i + 1}) NF ${n.numero_nota || '—'} (fonte: ${n.fonte})`,
    `• Pedido: ${n.pedido || '—'}`,
    `• Valor: ${formatarMoedaBr(n.valor_total)}`,
    `• Emitente/cliente: ${n.emitente || '—'}`,
    `• Data: ${formatarDataBr(n.data_emissao)}`,
    n.modelo ? `• Modelo: ${n.modelo}` : null,
    n.chave_nfe ? `• Chave: ${n.chave_nfe}` : null,
  ].filter(Boolean).join('\n'))).join('\n\n');
}

function formatarAnaliseTexto(resultado) {
  if (!resultado?.ok) return resultado?.error || 'Não foi possível analisar.';
  const base = formatarEquipamentoTexto({
    ok: true,
    serie: resultado.serie,
    equipamento: resultado.equipamento
  });
  const alim = resultado.alimentacao || {};
  const blocos = [
    base,
    '',
    'Codificação elétrica / degelo',
    `• Letra: ${alim.letra || '—'}`,
    `• Alimentação: ${alim.alimentacao || '—'}`,
    `• Degelo: ${alim.degelo || '—'}`,
  ];

  if (resultado.sintoma) {
    blocos.push('', `Sintoma informado: ${resultado.sintoma}`);
  }

  if (resultado.observacoes?.length) {
    blocos.push('', 'Análise');
    for (const obs of resultado.observacoes) blocos.push(`• ${obs}`);
  }

  if (resultado.os?.length) {
    blocos.push('', `OS/AT relacionadas (${resultado.os.length})`);
    for (const o of resultado.os.slice(0, 5)) {
      blocos.push(
        `• #${o.id} ${formatarDataBr(o.data)} — ${o.status || '—'} — ${o.tag_problema || o.tipo || '—'}: ${String(o.reclamacao || o.motivo || '').slice(0, 120)}`
      );
    }
  } else {
    blocos.push('', 'OS/AT: nenhuma registrada para este pedido/série.');
  }

  if (resultado.manuais?.length) {
    blocos.push('', 'Manuais (trechos)');
    for (const m of resultado.manuais.slice(0, 3)) {
      blocos.push(
        `• ${m.nome_arquivo} p.${m.pagina_inicial || '?'}: ${String(m.trecho || '').replace(/\s+/g, ' ').slice(0, 220)}…`
      );
    }
  }

  return blocos.join('\n');
}

async function executarAcaoTecnica(pool, actionObj) {
  const action = String(actionObj?.action || '').trim().toLowerCase();
  const data = actionObj?.data || {};

  if (action === 'lookup_serie') {
    const r = await lookupEquipamentoPorSerie(pool, data.serie || data.pedido);
    return { ok: r.ok !== false, content: formatarEquipamentoTexto(r), raw: r };
  }
  if (action === 'lookup_nf') {
    const r = await lookupNf(pool, { nf: data.nf || data.nota, pedido: data.pedido });
    return { ok: r.ok !== false, content: formatarNfTexto(r), raw: r };
  }
  if (action === 'analise_problema') {
    const r = await analisarProblemaEquipamento(pool, {
      serie: data.serie || data.pedido,
      sintoma: data.sintoma || data.problema || ''
    });
    return { ok: r.ok !== false, content: formatarAnaliseTexto(r), raw: r };
  }
  if (action === 'lookup_os') {
    const r = await lookupOsPorSerie(pool, data.serie || data.pedido);
    if (!r.os?.length) {
      return { ok: true, content: `Nenhuma OS encontrada para a série/pedido ${data.serie || data.pedido || '—'}.`, raw: r };
    }
    const content = r.os.slice(0, 10).map((o) => (
      `#${o.id} ${formatarDataBr(o.data)} | ${o.status || '—'} | ${o.cliente || '—'} | ${o.tag_problema || o.tipo || '—'}\n` +
      `${String(o.reclamacao || o.motivo || '').slice(0, 200)}`
    )).join('\n\n');
    return { ok: true, content, raw: r };
  }

  return null;
}

const TECH_QUALIDADE_TABELAS_PRIORITARIAS = [
  'public.historico_pre2024',
  'sac.at_serie_cache',
  'sac.at',
  'sac.at_busca_selecionada',
  'sac.alimentacao',
  'Vendas.notas_fiscais_omie',
  'Vendas.pedidos_venda',
  'Chatbot.manuais_instrucao',
  'Chatbot.manuais_instrucao_chunks',
];

const TECH_QUALIDADE_PROMPT = `Você é o Assistente Técnico da Qualidade Fromtherm (intranet).
Ajuda o técnico de atendimento a pesquisar equipamentos e analisar reclamações.

<output_contract>
- Responda em português brasileiro, objetivo, para uso em atendimento.
- Nunca invente pedido, modelo, NF, OP ou cliente. Se não tiver dado, diga e peça o número.
- Quando precisar de dado do sistema, responda SOMENTE com JSON de ação (sem texto extra).
</output_contract>

## AÇÕES SUPORTADAS (JSON):
1) Localizar máquina por série/pedido:
{"action":"lookup_serie","data":{"serie":"6902"}}

2) Localizar NF:
{"action":"lookup_nf","data":{"nf":"5559","pedido":""}}

3) Analisar problema (série + sintoma):
{"action":"analise_problema","data":{"serie":"6902","sintoma":"congelando por fora"}}

4) Listar OS da série:
{"action":"lookup_os","data":{"serie":"6902"}}

5) Relatório SQL (somente leitura):
{"action":"sql_report","data":{"question":"PERGUNTA_CLARA"}}

6) Abrir OS na tela:
{"action":"open_os","data":{"tipo":"Qualidade","cliente":"CLIENTE","serie":"SERIE","descricao":"DESCRICAO","telefone":""}}

## REGRAS:
- Se o usuário der só o número de série/pedido, use lookup_serie.
- Se mencionar NF/nota, use lookup_nf.
- Se descrever sintoma (gelo, não esquenta, erro Exx), use analise_problema.
- Prefira as ações lookup_* em vez de sql_report para série/NF/OS.
- sql_report só para pesquisas que as ferramentas fixas não cobrem.
`;

module.exports = {
  isUsuarioQualidade,
  detectarIntencaoTecnica,
  extrairSerieDaPergunta,
  extrairNfDaPergunta,
  lookupEquipamentoPorSerie,
  lookupNf,
  lookupOsPorSerie,
  analisarProblemaEquipamento,
  executarAcaoTecnica,
  formatarEquipamentoTexto,
  formatarNfTexto,
  formatarAnaliseTexto,
  TECH_QUALIDADE_PROMPT,
  TECH_QUALIDADE_TABELAS_PRIORITARIAS,
};
