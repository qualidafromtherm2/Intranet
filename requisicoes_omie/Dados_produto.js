// requisicoes_omie/Dados_produto.js
import config from '../config.client.js';
import { renderListaPecas } from '../produtos/lista_Pecas.js';
import {
  setCurrentCodigo,
  attachEditor,
  attachSelectEditor,
  attachTipoItemEditor,
  ensureSaveAllBtn
} from './editar_produto.js';

// --- base para as chamadas ao backend --------------------------
const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : window.location.origin;         // produção (Render)

    
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

// --- Controle de permissões de produto ---
let userPermissoes = [];
let camposObrigatoriosVazios = []; // Armazena campos obrigatórios não preenchidos

async function loadUserPermissoes() {
  try {
    const resp = await fetch(`${API_BASE}/api/auth/permissoes`, { credentials: 'include' });
    if (resp.ok) {
      const data = await resp.json();
      userPermissoes = data.permissoes || [];
    }
  } catch (e) {
    console.warn('[Dados_produto] Erro ao carregar permissões:', e);
  }
}
function hasPermissao(codigo) {
  return userPermissoes.includes(codigo);
}

// — campos da aba PDV —
const camposPDV = [
  { key: 'valor_unitario', label: 'Valor unitário' },
  { key: 'peso_liq',       label: 'Peso líquido'   },
  { key: 'peso_bruto',     label: 'Peso bruto'     },
  { key: 'altura',         label: 'Altura'         },
  { key: 'largura',        label: 'Largura'        },
  { key: 'profundidade',   label: 'Profundidade'   },
  { key: 'dias_garantia',  label: 'Dias garantia'  },
  { key: 'dias_crossdocking', label: 'Dias crossdocking' },
  { key: 'lead_time',      label: 'Lead time'      }
];

// — campos da aba Compras —
const camposCompras = [
  { key: 'estoque_minimo',     label: 'Estoque mínimo' },
  { key: 'nCMC',               label: 'CMC'            },
  { key: 'nPrecoUltComp',      label: 'Última compra'  }  // novo campo
];

/* ----------------- Cálculo de completude do produto ----------------- */
async function calcularCompletude(dados) {
  // Busca o CÓDIGO da família do produto (não o nome!)
  const familiaCodigo = dados.codigo_familia;
  
  if (!familiaCodigo) {
    console.warn('[Completude] Produto sem código de família definido');
    return { porcentagem: 0, camposPreenchidos: 0, totalCampos: 0, camposObrigatoriosVazios: [] };
  }
  
  try {
    // Busca campos obrigatórios da família
    const res = await fetch(`${API_BASE}/api/config/familia-campos/${encodeURIComponent(familiaCodigo)}`);
    if (!res.ok) {
      throw new Error('Erro ao buscar campos obrigatórios da família');
    }
    
    const camposConfig = await res.json();
    
    // Filtra apenas os campos marcados como obrigatórios
    const camposObrigatorios = camposConfig.filter(c => c.obrigatorio === true);
    
    if (camposObrigatorios.length === 0) {
      console.warn('[Completude] Nenhum campo obrigatório configurado para a família:', dados.descricao_familia || familiaCodigo);
      return { porcentagem: 0, camposPreenchidos: 0, totalCampos: 0, camposObrigatoriosVazios: [] };
    }
    
    let totalCampos = camposObrigatorios.length;
    let camposPreenchidos = 0;
    let camposObrigatoriosVazios = [];
    
    // Verifica cada campo obrigatório
    camposObrigatorios.forEach(campo => {
      const chave = campo.chave;
      
      // Busca o valor no objeto dados (suporta chaves aninhadas como 'info.caracteristicas')
      const valor = chave.split('.').reduce((o, k) => o?.[k], dados);
      
      // Considera preenchido se não for null, undefined, string vazia ou apenas espaços
      if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
        camposPreenchidos++;
      } else {
        // Armazena campos vazios para marcar em vermelho
        camposObrigatoriosVazios.push(chave);
      }
    });
    
    const porcentagem = totalCampos > 0 ? Math.round((camposPreenchidos / totalCampos) * 100) : 0;
    
    console.log(`[Completude] Família: ${dados.descricao_familia} (${familiaCodigo}) | ${camposPreenchidos}/${totalCampos} campos obrigatórios (${porcentagem}%)`);
    if (camposObrigatoriosVazios.length > 0) {
      console.log(`[Completude] Campos obrigatórios vazios:`, camposObrigatoriosVazios);
    }
    
    return {
      porcentagem,
      camposPreenchidos,
      totalCampos,
      camposObrigatoriosVazios
    };
    
  } catch (error) {
    console.error('[Completude] Erro ao calcular completude:', error);
    return { porcentagem: 0, camposPreenchidos: 0, totalCampos: 0, camposObrigatoriosVazios: [] };
  }
}


function atualizarCirculoCompletude(porcentagem) {
  const circulo = document.getElementById('completudeProgress');
  const texto = document.getElementById('completudeText');
  
  if (!circulo || !texto) return;
  
  // Circunferência do círculo: 2 * PI * raio = 2 * 3.14159 * 20 ≈ 125.6
  const circunferencia = 125.6;
  const offset = circunferencia - (porcentagem / 100) * circunferencia;
  
  circulo.style.strokeDashoffset = offset;
  texto.textContent = `${porcentagem}%`;
  
  // Muda cor baseado na porcentagem
  if (porcentagem >= 80) {
    circulo.setAttribute('stroke', '#10b981'); // verde
  } else if (porcentagem >= 50) {
    circulo.setAttribute('stroke', '#f59e0b'); // amarelo
  } else {
    circulo.setAttribute('stroke', '#ef4444'); // vermelho
  }
}

// Marca guias que possuem campos obrigatórios vazios
function marcarGuiasComCamposObrigatorios(camposVazios) {
  // Mapeia campos para suas guias
  const camposPorGuia = {
    detalhesTab: ['descricao_familia', 'unidade', 'tipoItem', 'marca', 'modelo', 'descr_detalhada', 'obs_internas'],
    cadastroTab: ['bloqueado', 'bloquear_exclusao', 'inativo'],
    financeiroTab: ['ncm', 'cfop', 'origem_imposto', 'cest', 'aliquota_ibpt'],
    logisticaTab: ['ean'],
    pdv: ['valor_unitario', 'peso_liq', 'peso_bruto', 'altura', 'largura', 'profundidade', 'dias_garantia', 'dias_crossdocking', 'lead_time'],
    compras: ['estoque_minimo', 'nCMC', 'nPrecoUltComp']
  };
  
  // Limpa marcações anteriores
  const allLinks = document.querySelectorAll('#produtoTabs .main-header-link');
  allLinks.forEach(link => {
    link.style.color = '';
    link.style.fontWeight = '';
    const badge = link.querySelector('.badge-obrigatorio');
    if (badge) badge.remove();
  });
  
  // Verifica cada guia
  Object.keys(camposPorGuia).forEach(guiaId => {
    const camposDaGuia = camposPorGuia[guiaId];
    const temCampoVazio = camposVazios.some(campo => camposDaGuia.includes(campo));
    
    if (temCampoVazio) {
      const link = document.querySelector(`#produtoTabs .main-header-link[data-subtarget="${guiaId}"]`);
      if (link) {
        link.style.color = '#ef4444';
        link.style.fontWeight = '600';
        
        // Adiciona badge de alerta
        if (!link.querySelector('.badge-obrigatorio')) {
          const badge = document.createElement('span');
          badge.className = 'badge-obrigatorio';
          badge.innerHTML = ' ⚠️';
          badge.style.fontSize = '12px';
          link.appendChild(badge);
        }
      }
    }
  });
}

/* ----------------- 1) Carrega mapa de categorias (CSV) -------------- */
let tipoList = [];
async function loadTipoMap() {
  if (tipoList.length) return;
  const resp = await fetch('/csv/Tipo.csv');
  const text = await resp.text();
  const [, ...lines] = text.split(/\r?\n/);

 tipoList = lines
    .filter(l => l.trim())
    .map(line => {

      const cols       = line.split(',');
      const grupo      = cols[0];
      const descricao  = cols[1];
      const tipo       = cols[2];
      const tipoProd   = cols[3];
      const listaPecas = cols[4];
      // joga tudo depois da 5ª vírgula num só campo, e retira aspas externas
      let naoListar    = cols.slice(5).join(',');
      naoListar        = naoListar.replace(/^"|"$/g, '');
      
     return {
       groupId:           parseInt(grupo, 10),
       descricao:         descricao.trim(),
       tipo:              tipo.trim(),
       tipoProd:          tipoProd.trim(),
       listaPecas:        listaPecas.trim() === 'S',
       prefixesToExclude: naoListar
                           .split(',')
                           .map(s=>s.trim())
                           .filter(s=>s)
     };
    });
}

/* ----------------- 2) Agrupa + ordena por grupo --------------------- */
function groupAndSortByGroupId(items, codeField) {
  const map = new Map();
  tipoList.forEach(r => map.set(r.groupId, { name: r.descricao, items: [] }));
  map.set(null, { name: 'Sem categoria', items: [] });
  items.forEach(item => {
    const gid = parseInt(item[codeField].split('.')[0], 10);
    (map.get(gid) || map.get(null)).items.push(item);
  });
  const result = [];
  for (const [gid, { name, items }] of map.entries()) {
    if (!items.length) continue;
    items.sort((a, b) =>
      a[codeField].localeCompare(b[codeField], undefined, { numeric: true })
    );
    result.push({
      category: name,
      groupId : gid,     //  ←  devolve o nº do grupo
      items
    });
  }
  return result;
  
}
// guarda os itens que a API retornou, para usarmos no filtro
let malhaItens = [];
// também precisamos desta variável para a aba Estrutura de produto
let itens = [];

/* ----------------- 3) Função principal ------------------------------ */
export async function loadDadosProduto(codigo) {
  setCurrentCodigo(codigo);
  // Expõe referência global do código do produto atual para outras abas (ex.: Check-Proj)
  window.currentProdutoCodigo = codigo;
  
  // Carrega permissões do usuário logado antes de renderizar
  await loadUserPermissoes();
  
  const nonEditableKeys = new Set([
    'info.uAlt','info.dAlt','info.hAlt',
    'info.uInc','info.dInc','info.hInc',
    'codigo_produto','codigo_familia',
    'codInt_familia','quantidade_estoque'
  ]);

  // 3.1) Título e categorias
  document.getElementById('productTitle').textContent = codigo;
  
  // Armazena código globalmente para facilitar acesso
  window.codigoSelecionado = codigo;
  
  await loadTipoMap();

// [SQL] Busca dados do produto direto do Postgres
const resProd = await fetch(`${API_BASE}/api/produtos/detalhe?codigo=${encodeURIComponent(codigo)}`);
if (!resProd.ok) {
  console.error('Falha ao buscar produto no Postgres', resProd.status);
  return;
}
const dados = await resProd.json();

// Armazena Código OMIE e descrição globalmente
window.codigoOmieSelecionado = dados?.codigo_produto || null;
window.descricaoSelecionada = dados?.descricao || '';

// Atualiza o cabeçalho com as informações do produto
const headerInfo = document.getElementById('productHeaderInfo');
const headerCodigo = document.getElementById('headerCodigo');
const headerCodigoOmie = document.getElementById('headerCodigoOmie');
const headerDescricao = document.getElementById('headerDescricao');

if (headerInfo && headerCodigo && headerCodigoOmie && headerDescricao) {
  headerCodigo.textContent = codigo;
  headerCodigoOmie.textContent = window.codigoOmieSelecionado || 'N/A';
  headerDescricao.textContent = window.descricaoSelecionada || '';
  headerDescricao.title = window.descricaoSelecionada || ''; // Tooltip com descrição completa
  headerInfo.style.display = 'flex';
}

// Disponibiliza metadados globais úteis a outras guias
try {
  window.currentProdutoFamilia = dados?.codigo_familia || '';
  // Caso o backend comece a retornar o ID OMIE, já deixamos preparado
  window.currentProdutoIdOmie = dados?.id_produto || null;
} catch(_) { /* noop */ }


  // 3.3) Buscar e normalizar resumo de estoque
  const hoje = new Date();
  const dDia = [
    String(hoje.getDate()).padStart(2,'0'),
    String(hoje.getMonth()+1).padStart(2,'0'),
    hoje.getFullYear()
  ].join('/');
  let resumoEstoque = {};
  try {
    const respResumo = await fetch(`${API_BASE}/api/omie/estoque/resumo`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        call:       'ObterEstoqueProduto',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      [{ cCodigo: codigo, dDia }]
      })
    });
    const jsonResumo = await respResumo.json();
    // Suporta array puro, json.resumo ou json.listaEstoque
    const lista = Array.isArray(jsonResumo)
      ? jsonResumo
      : Array.isArray(jsonResumo.resumo)
        ? jsonResumo.resumo
        : Array.isArray(jsonResumo.listaEstoque)
          ? jsonResumo.listaEstoque
          : [];
    resumoEstoque = lista[0] || {};
  } catch (err) {
    console.error('Erro ao obter resumo de estoque:', err);
  }

  // 3.4) Popula Compras (inclui CMC vindo de resumoEstoque)
// 3.4) Popula Compras (todos os valores agora vêm de `resumoEstoque` quando disponíveis)
const ulCompras = document.getElementById('comprasList');
ulCompras.innerHTML = '';
camposCompras.forEach(f => {
  // prioriza valores vindos de resumoEstoque
  let raw;
  if (f.key === 'estoque_minimo') {
    raw = resumoEstoque.nEstoqueMinimo ?? '';
  } else if (f.key === 'nCMC') {
    raw = resumoEstoque.nCMC ?? '';
  } else if (f.key === 'nPrecoUltComp') {
    raw = resumoEstoque.nPrecoUltComp ?? '';
  } else {
    raw = f.key.split('.').reduce((o, k) => o?.[k], dados) ?? '';
  }

  // formata moeda para CMC e Última compra, mantém nEstoqueMinimo puro
  const display =
    (f.key === 'nCMC' || f.key === 'nPrecoUltComp')
      ? (raw !== '' ? Number(raw).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '')
      : raw;

  const canEdit = hasPermissao('alterar_dados') && !nonEditableKeys.has(f.key);
  const isObrigatorioVazio = camposObrigatoriosVazios.includes(f.key);
  const li = document.createElement('li');
  li.innerHTML = `
    <div class="products" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${f.label}${isObrigatorioVazio ? ' ⚠️' : ''}</div>
    <div class="status-text" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${display || (isObrigatorioVazio ? '(Obrigatório)' : '')}</div>
    ${canEdit
      ? `<div class="button-wrapper"><button class="content-button edit-button">Editar</button></div>`
      : ''
    }
  `;
  ulCompras.appendChild(li);
  if (canEdit) attachEditor(li, f);
});


  // 3.5) Popula PDV
  const ulPDV = document.getElementById('pdvList');
  ulPDV.innerHTML = '';
  camposPDV.forEach(f => {
    const raw = f.key.split('.').reduce((o,k)=>o?.[k], dados) ?? '';
    const display = (f.key === 'valor_unitario' && raw !== '')
      ? Number(raw).toLocaleString('pt-BR',{ style:'currency',currency:'BRL' })
      : raw;
    const canEdit = hasPermissao('alterar_dados') && !nonEditableKeys.has(f.key);
    const isObrigatorioVazio = camposObrigatoriosVazios.includes(f.key);
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="products" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${f.label}${isObrigatorioVazio ? ' ⚠️' : ''}</div>
      <div class="status-text" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${display || (isObrigatorioVazio ? '(Obrigatório)' : '')}</div>
      ${canEdit
        ? `<div class="button-wrapper"><button class="content-button edit-button">Editar</button></div>`
        : ''
      }
    `;
    ulPDV.appendChild(li);
    if (canEdit) attachEditor(li, f);
  });

  // 3.6) Banner
  const descEl = document.getElementById('productDesc');
  descEl.textContent = dados.descricao || '';
  
  // Torna descrição editável se usuário tem permissão alterar_nome
  if (hasPermissao('alterar_nome')) {
    descEl.style.cursor = 'pointer';
    descEl.title = 'Clique para editar a descrição';
    
    descEl.addEventListener('click', async function enableEdit() {
      const oldText = descEl.textContent;
      descEl.contentEditable = 'true';
      descEl.style.outline = '2px solid #10b981';
      descEl.style.padding = '4px';
      descEl.focus();
      
      // Seleciona todo o texto
      const range = document.createRange();
      range.selectNodeContents(descEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      
      async function saveEdit() {
        const newText = descEl.textContent.trim();
        descEl.contentEditable = 'false';
        descEl.style.outline = '';
        descEl.style.padding = '';
        
        if (newText && newText !== oldText) {
          try {
            const resp = await fetch(`${API_BASE}/api/produtos/editar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                codigo: codigo,
                campo: 'descricao',
                valor: newText
              })
            });
            
            if (resp.ok) {
              descEl.textContent = newText;
              console.log('[productDesc] Descrição atualizada com sucesso');
            } else {
              descEl.textContent = oldText;
              alert('Erro ao salvar descrição');
            }
          } catch (e) {
            console.error('[productDesc] Erro:', e);
            descEl.textContent = oldText;
            alert('Erro ao salvar descrição');
          }
        } else if (!newText) {
          descEl.textContent = oldText;
        }
      }
      
      function cancelEdit(e) {
        if (e.key === 'Escape') {
          descEl.textContent = oldText;
          descEl.contentEditable = 'false';
          descEl.style.outline = '';
          descEl.style.padding = '';
          descEl.removeEventListener('keydown', cancelEdit);
          descEl.removeEventListener('blur', saveEdit);
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          saveEdit();
          descEl.removeEventListener('keydown', cancelEdit);
          descEl.removeEventListener('blur', saveEdit);
        }
      }
      
      descEl.addEventListener('keydown', cancelEdit);
      descEl.addEventListener('blur', saveEdit, { once: true });
      descEl.removeEventListener('click', enableEdit);
    }, { once: true });
  }
  
  const imgEl = document.getElementById('productImg');
  imgEl.src = Array.isArray(dados.imagens) && dados.imagens[0]?.url_imagem
    ? dados.imagens[0].url_imagem
    : '../img/logo.png';
  imgEl.alt = dados.descricao || 'Produto';

  // Calcular e atualizar círculo de completude
  const completude = await calcularCompletude(dados);
  camposObrigatoriosVazios = completude.camposObrigatoriosVazios || []; // Armazena globalmente
  atualizarCirculoCompletude(completude.porcentagem);
  console.log(`[Completude] ${completude.camposPreenchidos}/${completude.totalCampos} campos (${completude.porcentagem}%)`);
  
  // Debug: Log dos campos vazios
  if (camposObrigatoriosVazios.length > 0) {
    console.log('[Debug] Campos obrigatórios vazios:', camposObrigatoriosVazios);
  }
  
  // Marcar guias com campos obrigatórios vazios
  marcarGuiasComCamposObrigatorios(camposObrigatoriosVazios);

  // Re-renderizar a guia Compras para aplicar marcação dos obrigatórios
  try {
    const ulComprasRerender = document.getElementById('comprasList');
    if (ulComprasRerender) {
      ulComprasRerender.innerHTML = '';
      camposCompras.forEach(f => {
        let raw;
        if (f.key === 'estoque_minimo') {
          raw = resumoEstoque.nEstoqueMinimo ?? '';
        } else if (f.key === 'nCMC') {
          raw = resumoEstoque.nCMC ?? '';
        } else if (f.key === 'nPrecoUltComp') {
          raw = resumoEstoque.nPrecoUltComp ?? '';
        } else {
          raw = f.key.split('.').reduce((o, k) => o?.[k], dados) ?? '';
        }

        const display =
          (f.key === 'nCMC' || f.key === 'nPrecoUltComp')
            ? (raw !== '' ? Number(raw).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '')
            : raw;

        const canEdit = hasPermissao('alterar_dados') && !nonEditableKeys.has(f.key);
        const isObrigatorioVazio = camposObrigatoriosVazios.includes(f.key);
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="products" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${f.label}${isObrigatorioVazio ? ' ⚠️' : ''}</div>
          <div class="status-text" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${display || (isObrigatorioVazio ? '(Obrigatório)' : '')}</div>
          ${canEdit
            ? `<div class=\"button-wrapper\"><button class=\"content-button edit-button\">Editar</button></div>`
            : ''
          }
        `;
        ulComprasRerender.appendChild(li);
        if (canEdit) attachEditor(li, f);
      });
    }
  } catch(e) {
    console.warn('[Compras] Falha ao re-renderizar com marcação obrigatória:', e);
  }

  // 3.7) Popula Detalhes do produto
  const camposDetalhes = [
    { key: 'descricao_familia', label: 'Descrição família' },
    { key: 'unidade',           label: 'Unidade'           },
    { key: 'tipoItem',          label: 'Tipo item'         },
    { key: 'marca',             label: 'Marca'             },
    { key: 'modelo',            label: 'Modelo'            },
    { key: 'descr_detalhada',   label: 'Descrição detalhada'},
    { key: 'obs_internas',      label: 'Obs internas'      }
  ];

  // === garante que o carrossel use SEMPRE o código numérico ===
try {
  const hid = document.getElementById('codigo_produto');
  // ajuste o campo abaixo conforme como sua API retorna (ex.: dados.codigo_produto)
  const codNum = String(dados.codigo_produto || dados.codigo || '').trim();
  if (hid && codNum) hid.value = codNum;
} catch {}


  const ulDetalhes = document.getElementById('detalhesList');
  ulDetalhes.innerHTML = '';
  camposDetalhes.forEach(f => {
    const raw = f.key.split('.').reduce((o,k)=>o?.[k], dados) ?? '';
    const val = (f.key === 'valor_unitario' && raw !== '')
      ? Number(raw).toLocaleString('pt-BR',{ style:'currency',currency:'BRL' })
      : raw;
    const canEdit = hasPermissao('alterar_dados') && !nonEditableKeys.has(f.key);
    const isObrigatorioVazio = camposObrigatoriosVazios.includes(f.key);
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="products" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${f.label}${isObrigatorioVazio ? ' ⚠️' : ''}</div>
      <div class="status-text" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${val || (isObrigatorioVazio ? '(Obrigatório)' : '')}</div>
      ${canEdit
        ? `<div class="button-wrapper"><button class="content-button edit-button">Editar</button></div>`
        : ''
      }
    `;
    ulDetalhes.appendChild(li);
    if (canEdit) {
      if (f.key === 'descricao_familia') attachSelectEditor(li, f, raw);
      else if (f.key === 'tipoItem') attachTipoItemEditor(li, f, raw);
      else attachEditor(li, f);
    }
  });


  // 3.8) Popula Dados de cadastro
  const camposCadastro = [
    { key: 'bloqueado',          label: 'Bloqueado'         },
    { key: 'bloquear_exclusao',  label: 'Bloquear exclusão' },
    { key: 'inativo',            label: 'Inativo'           },
    { key: 'info.uAlt',          label: 'Usuário alteração' },
    { key: 'info.dAlt',          label: 'Data alteração'    },
    { key: 'info.hAlt',          label: 'Hora alteração'    },
    { key: 'info.uInc',          label: 'Usuário inclusão'  },
    { key: 'info.dInc',          label: 'Data inclusão'     },
    { key: 'info.hInc',          label: 'Hora inclusão'     },
    { key: 'codigo_produto',     label: 'Código OMIE'       },
    { key: 'codigo_familia',     label: 'Código família'    },
    { key: 'codInt_familia',     label: 'CodInt família'    }
  ];
  const ulCadastro = document.getElementById('cadastroList');
  ulCadastro.innerHTML = '';
  camposCadastro.forEach(f => {
    const raw = f.key.split('.').reduce((o,k) => o?.[k], dados) ?? '';
    const canEdit = hasPermissao('alterar_dados') && !nonEditableKeys.has(f.key);
    const isObrigatorioVazio = camposObrigatoriosVazios.includes(f.key);
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="products" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${f.label}${isObrigatorioVazio ? ' ⚠️' : ''}</div>
      <div class="status-text" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${raw || (isObrigatorioVazio ? '(Obrigatório)' : '')}</div>
      ${canEdit
        ? `<div class="button-wrapper"><button class="content-button edit-button">Editar</button></div>`
        : ''
      }
    `;
    ulCadastro.appendChild(li);
    if (canEdit) attachEditor(li, f);
  });

  // 3.9) Popula Financeiro
  const camposFinanceiro = [
    { key: 'ncm',           label: 'NCM'           },
    { key: 'cfop',          label: 'CFOP'          },
    { key: 'origem_imposto',label: 'Origem imposto'},
    { key: 'cest',          label: 'CEST'          },
    { key: 'aliquota_ibpt', label: 'Alíquota IBPT' }
  ];
  const ulFin = document.getElementById('financeiroList');
  ulFin.innerHTML = '';
  camposFinanceiro.forEach(f => {
    const raw = f.key.split('.').reduce((o,k) => o?.[k], dados) ?? '';
    const canEdit = hasPermissao('alterar_dados') && !nonEditableKeys.has(f.key);
    const isObrigatorioVazio = camposObrigatoriosVazios.includes(f.key);
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="products" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${f.label}${isObrigatorioVazio ? ' ⚠️' : ''}</div>
      <div class="status-text" style="${isObrigatorioVazio ? 'color: #ef4444; font-weight: 600;' : ''}">${raw || (isObrigatorioVazio ? '(Obrigatório)' : '')}</div>
      ${canEdit
        ? `<div class="button-wrapper"><button class="content-button edit-button">Editar</button></div>`
        : ''
      }
    `;
    ulFin.appendChild(li);
    if (canEdit) attachEditor(li, f);
  });

    // 3.10) Popula Logística
    const ulLog = document.getElementById('logisticaList');
    ulLog.innerHTML = '';
    const camposLogistica = [
      { label: 'EAN',       dynamic: false, key: 'ean'      },
      { label: 'Físico',    dynamic: true,  apiKey: 'fisico' },
      { label: 'Saldo',     dynamic: true,  apiKey: 'nSaldo' },
      { label: 'Reservado', dynamic: true,  apiKey: 'reservado' }
    ];
    camposLogistica.forEach(f => {
      const raw = f.dynamic
        ? (resumoEstoque[f.apiKey] ?? '')
        : (f.key.split('.').reduce((o,k)=>o?.[k], dados) ?? '');
      const li = document.createElement('li');
      li.className = 'adobe-product';
      li.innerHTML = `
        <div class="products">${f.label}</div>
        <div class="status-text">${raw}</div>
      `;
      ulLog.appendChild(li);
    });
  

  // Salvar alterações
  ensureSaveAllBtn();


/* ----------------- 4) Características ----------------------------- */
// 1) Insere a ferramenta **dentro** do título, para ficar lado a lado
const caractTitleEl = document.querySelector('#listaCaracteristica .content-section-title');
if (!caractTitleEl.querySelector('#caract-toggle')) {
  // torne o título um inline-flex para alinhar ícone e texto
  caractTitleEl.style.display    = 'inline-flex';
  caractTitleEl.style.alignItems = 'center';

  // adiciona o toolbar dentro do próprio title
  caractTitleEl.insertAdjacentHTML('beforeend', `
    <span class="caract-toolbar" style="position:relative; display:inline-flex; align-items:center; margin-left:8px;">
      <i id="caract-toggle" class="fas fa-wrench" style="cursor:pointer;"></i>
      <div id="caract-menu" style="
          display:none;
          position:absolute;
          top:100%;
          left:0;
          background:var(--content-bg);
          border:1px solid var(--border-color);
          padding:4px;
          border-radius:4px;
          box-shadow:0 2px 6px rgba(0,0,0,0.2);
          gap:8px;
        ">
        <i class="fas fa-plus tool-item"    data-action="add"     title="Adicionar característica" style="cursor:pointer;"></i>
        <i class="fas fa-edit tool-item"    data-action="edit"    title="Editar característica"    style="cursor:pointer;"></i>
        <i class="fas fa-align-left tool-item" data-action="content" title="Incluir conteúdo"       style="cursor:pointer;"></i>
      </div>
    </span>
  `);

  const toggleBtn = caractTitleEl.querySelector('#caract-toggle');
  const menu      = caractTitleEl.querySelector('#caract-menu');

  toggleBtn.addEventListener('click', e => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
  });
  document.addEventListener('click', () => menu.style.display = 'none');
  menu.addEventListener('click', e => e.stopPropagation());
}





// 1) Garanta que você já tenha carregado a lista completa de características do OMIE:
if (!window.__allCaracteristicas) {
  const respCarat = await fetch(`${API_BASE}/api/omie/caracteristicas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call:       'ListarCaracteristicas',
      param:      [{ nPagina:1, nRegPorPagina:50 }],
      app_key:    OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    })
  });
  const jsonCarat = await respCarat.json();
  window.__allCaracteristicas = jsonCarat.listaCaracteristicas || [];
}
const allCaracteristicas = window.__allCaracteristicas;


// 2) Substitua seu listener “add” por este:
const addToolBtn = caractTitleEl.querySelector('.tool-item[data-action="add"]');
if (!addToolBtn._addListenerAttached) {
  addToolBtn.addEventListener('click', e => {
    e.stopPropagation();
  // fecha o menu
  const menu = caractTitleEl.querySelector('#caract-menu');
  if (menu) menu.style.display = 'none';







  
  // cria nova linha no topo
  const li = document.createElement('li');
  li.className = 'adobe-product';
  li.dataset.codintprod = dados.codigo;        // integração do produto
  li.dataset.codprod    = dados.codigo_produto;

  // monta os campos com selects e display de código interno
  li.innerHTML = `
    <div class="products">


<input list="datalist-nome-caract"
       class="new-caract-nome-input"
       placeholder="Selecione ou digite">
<datalist id="datalist-nome-caract">
  ${allCaracteristicas.map(c =>
    `<option value="${c.cNomeCaract}">`
  ).join('')}
</datalist>





    </div>
    <span class="status">
      <span class="status-circle"></span>
      <span class="status-text"></span>
    </span>
    <div class="button-wrapper">
      <button class="content-button status-button" disabled>Salvar</button>
    </div>
    <div class="submenu" style="display:block; padding:0 18px;">
      <ul>
        <li>Código interno: <span class="cod-int-display"></span></li>
        <li>Conteúdo:
<input list="datalist-conteudo"
       class="detail-input conteudo-input"
       placeholder="Selecione ou digite"
       disabled>
<datalist id="datalist-conteudo"></datalist>

        </li>
        <li>
          <label>Exibir NF?</label>
          <select class="sn-toggle exibir-nf">
            <option value="S">S</option>
            <option value="N">N</option>
          </select>
        </li>
        <li>
          <label>Exibir Pedido?</label>
          <select class="sn-toggle exibir-pedido">
            <option value="S">S</option>
            <option value="N">N</option>
          </select>
        </li>
        <li>
          <label>Exibir OP?</label>
          <select class="sn-toggle exibir-op">
            <option value="S">S</option>
            <option value="N">N</option>
          </select>
        </li>
      </ul>
    </div>
  `;

  document.getElementById('listacaracteristica').prepend(li);

 // ─── Atualização dos listeners para input livre + sugestões ───
 const nomeInput     = li.querySelector('.new-caract-nome-input');
 const codDisplay    = li.querySelector('.cod-int-display');
 const conteudoInput = li.querySelector('.conteudo-input');
 const datalistCont  = li.querySelector('#datalist-conteudo');
 const saveBtn       = li.querySelector('button.status-button');

 // ao digitar ou selecionar Nome da característica
 nomeInput.addEventListener('input', () => {
   const sel = allCaracteristicas.find(c => c.cNomeCaract === nomeInput.value);
   // replica o valor em Código interno
   codDisplay.textContent = nomeInput.value;
   // popula as sugestões de Conteúdo
   datalistCont.innerHTML = sel?.conteudosPermitidos
     .map(ct => `<option value="${ct.cConteudo}">`)
     .join('') || '';
   // libera sempre o campo Conteúdo e habilita Salvar
   conteudoInput.disabled = false;
   saveBtn.disabled       = !nomeInput.value;
 });

 // ao digitar livremente no Conteúdo mantém o botão Salvar ativo
 conteudoInput.addEventListener('input', () => {
   if (nomeInput.value) saveBtn.disabled = false;
 });
 // ────────────────────────────────────────────────────────────────

});
addToolBtn._addListenerAttached = true;
}

// 2) Agora limpa e popula o UL normalmente, sem afetar o toolbar
const caracUl = document.getElementById('listacaracteristica');
caracUl.innerHTML = '';

// helper para mensagens no submenu
function showCaractMsg(li, text, ok) {
  let msgEl = li.querySelector('.caract-msg');
  if (!msgEl) {
    msgEl = document.createElement('div');
    msgEl.className = 'caract-msg';
    msgEl.style.cssText = 'margin-top:8px;font-size:0.9rem;';
    li.querySelector('.submenu').appendChild(msgEl);
  }
  msgEl.textContent = text;
  msgEl.style.color = ok ? 'green' : 'red';
}

// registra o click UMA vez
if (!caracUl._caracListenerAttached) {
  caracUl.addEventListener('click', async ev => {
    const li = ev.target.closest('li.adobe-product');
    if (!li) return;
    const btn = ev.target.closest('button.status-button');
    if (!btn) return;
    const submenu = li.querySelector('.submenu');

    // SALVAR
    if (btn.textContent === 'Salvar') {
      // 1) detecta item novo
      const nomeInput = li.querySelector('.new-caract-nome-select, .new-caract-nome-input');
      if (nomeInput) {
        const valorNome = nomeInput.value.trim();
        if (!valorNome) {
          showCaractMsg(li, 'Preencha o nome da característica', false);
          return;
        }
    
        // ─── 1ª requisição: cria a característica ────────────────────────
        const payload1 = {
          call:       'IncluirCaracteristica',
          param:      [{ cCodIntCaract: valorNome, cNomeCaract: valorNome }],
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET
        };
        console.log('▶️ IncluirCaracteristica →', payload1);
        let json1;
        try {
          const resp1 = await fetch(`${API_BASE}/api/omie/caracteristicas`, {
            method:  'POST',
            headers: { 'Content-Type':'application/json' },
            body:    JSON.stringify(payload1)
          });
          json1 = await resp1.json();
          if (!resp1.ok) {
            showCaractMsg(li, json1.error || json1.faultstring || 'Erro ao incluir', false);
            return;
          }
          showCaractMsg(li, json1.cDesStatus || 'Característica criada', true);
        } catch (e) {
          showCaractMsg(li, e.message || 'Erro de rede', false);
          return;
        }
    
        // guarda o código gerado
        const novoCod = json1.nCodCaract;
        li.dataset.codcar = novoCod;
    
           // prepara botão com spinner
           btn.disabled    = true;
           btn.innerHTML   = '<i class="fa fa-spinner fa-spin"></i>';
        
           // espera 5 segundos antes de associar ao produto
           setTimeout(async () => {
             // coleta os demais campos
             const conteudo      = li.querySelector('.conteudo-input').value;
             const cExibirNF     = li.querySelector('.exibir-nf').value;
             const cExibirPedido = li.querySelector('.exibir-pedido').value;
             const cExibirOrdem  = li.querySelector('.exibir-op').value;
        
             const payload2 = {
               call:       'IncluirCaractProduto',
               param: [{
                 cCodIntProd:       li.dataset.codintprod,
                 nCodCaract:        novoCod,
                 cConteudo:         conteudo,
                 cExibirItemNF:     cExibirNF,
                 cExibirItemPedido: cExibirPedido,
                 cExibirOrdemProd:  cExibirOrdem
               }],
               app_key:    OMIE_APP_KEY,
               app_secret: OMIE_APP_SECRET
             };
             console.log('▶️ IncluirCaractProduto →', payload2);
             try {
               const resp2 = await fetch(`${API_BASE}/api/omie/prodcaract`, {
                 method:  'POST',
                 headers: { 'Content-Type':'application/json' },
                 body:    JSON.stringify(payload2)
               });
               const json2 = await resp2.json();
               if (!resp2.ok) {
                 showCaractMsg(li, json2.error||json2.faultstring||'Erro ao associar', false);
               } else {
                 showCaractMsg(li, json2.cDesStatus||'Vinculado com sucesso!', true);
                 // atualiza status e fecha
                 li.querySelector('.status-text').textContent = conteudo;
                 btn.textContent = 'Fechar';
               }
             } catch (e) {
               showCaractMsg(li, e.message||'Erro de rede', false);
             } finally {
               // restaura botão
               btn.disabled = false;
               if (btn.textContent === '<i class="fa fa-spinner fa-spin"></i>') {
                 btn.textContent = 'Salvar';
               }
             }
           }, 5000);
            return;
        Explicação
      }

    
      // ─── Existente: Alterar característica (seu código antigo) ───────
      const payload = {
        param:[{
          cCodIntProd: li.dataset.codintprod,
          nCodCaract:  +li.dataset.codcar,
          cConteudo:   li.querySelector('.conteudo-input').value,
          cExibirItemNF:     li.querySelector('.exibir-nf').value,
          cExibirItemPedido: li.querySelector('.exibir-pedido').value,
          cExibirOrdemProd:  li.querySelector('.exibir-op').value
        }]
      };
      console.log('▶️ AlterarCaracteristica →', payload);
      try {
        const resp = await fetch(`${API_BASE}/api/prodcaract/alterar`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        });
        const json = await resp.json();
        if (!resp.ok) {
          showCaractMsg(li, json.error||json.faultstring||'Erro ao salvar', false);
          return;
        }
        const msg = json.produtoCaractStatus?.[0]?.descrStatus||'Sucesso!';
        showCaractMsg(li, msg, true);
        li.querySelector('.status-text').textContent = payload.param[0].cConteudo;
        btn.textContent = 'Fechar';
      } catch (e) {
        console.error(e);
        showCaractMsg(li, e.message||'Erro de rede', false);
      }
      return;
    }
    

  // EDITAR / FECHAR
  const open = submenu.style.display === 'block';
  submenu.style.display = open ? 'none' : 'block';
  btn.textContent = open ? 'Editar' : 'Fechar';

  });

  
  caracUl.addEventListener('input', ev => {
    if (!ev.target.closest('.submenu')) return;
    const li = ev.target.closest('li.adobe-product');
    li.querySelector('button.status-button').textContent = 'Salvar';
  });

  caracUl._caracListenerAttached = true;
}

// 3) Agora popula cada <li>…
(Array.isArray(dados.caracteristicas)?dados.caracteristicas:[])
  .forEach(item => {
    const li = document.createElement('li');
    li.className = 'adobe-product';
    li.dataset.codintcar  = item.cCodIntCaract;
    li.dataset.codintprod = dados.codigo;
    li.dataset.codcar     = item.nCodCaract;
    li.dataset.codprod    = dados.codigo_produto;
    li.innerHTML = `
      <div class="products">${item.cNomeCaract}</div>
      <span class="status">
        <span class="status-circle"></span>
        <span class="status-text">${item.cConteudo}</span>
      </span>



      <div class="button-wrapper">
       <button type="button" class="content-button status-button open">Editar</button>
      </div>
     <div class="submenu" style="display:none; padding:0 18px;">
       <ul>




          <li>Código interno: ${item.cCodIntCaract}</li>
          <li>Conteúdo: <input class="detail-input conteudo-input" value="${item.cConteudo}"></li>
          <li><label>Exibir NF?</label>
            <select class="sn-toggle exibir-nf">
              <option value="S"${item.cExibirItemNF==='S'?' selected':''}>S</option>
              <option value="N"${item.cExibirItemNF==='N'?' selected':''}>N</option>
            </select>
          </li>
          <li><label>Exibir Pedido?</label>
            <select class="sn-toggle exibir-pedido">
              <option value="S"${item.cExibirItemPedido==='S'?' selected':''}>S</option>
              <option value="N"${item.cExibirItemPedido==='N'?' selected':''}>N</option>
            </select>
          </li>
          <li><label>Exibir OP?</label>
            <select class="sn-toggle exibir-op">
              <option value="S"${item.cExibirOrdemProd==='S'?' selected':''}>S</option>
              <option value="N"${item.cExibirOrdemProd==='N'?' selected':''}>N</option>
            </select>
          </li>
          <li>Código OMIE: ${item.nCodCaract}</li>
        </ul>
      </div>


             </ul>
       <div class="submenu-footer" style="margin-top:8px; text-align:right;">
         <i class="fa fa-trash delete-icon"
            title="Excluir característica"
            style="cursor:pointer; color:#c00; font-size:1.2em;"></i>
       </div>
     </div>
    `;
    caracUl.appendChild(li);



    
  });


  /**  
 * Exibe mensagem ao lado do título "Características"  
 * text: string da mensagem  
 * ok: boolean — se true exibe em verde, se false em vermelho  
 */
function showProxyMsg(text, ok) {
  // encontra o título da seção
  const titleEl = document.querySelector('#listaCaracteristica .content-section-title');
  if (!titleEl) return;

  // procura ou cria um <span> para a mensagem
  let span = titleEl.querySelector('.proxy-msg');
  if (!span) {
    span = document.createElement('span');
    span.className = 'proxy-msg';
    span.style.cssText = 'margin-left:8px; font-size:0.9em;';
    titleEl.appendChild(span);
  }

  // ajusta texto e cor
  span.textContent = text;
  span.style.color = ok ? 'green' : 'red';

  // remove após 5 segundos
  clearTimeout(span._timer);
  span._timer = setTimeout(() => span.remove(), 5000);
}

// ————————————————————————————————
// 4.x) Listener de clique no ícone de lixeira (registra só uma vez)
if (!caracUl._deleteListenerAttached) {
  caracUl.addEventListener('click', async e => {
    const del = e.target.closest('.delete-icon');
    if (!del) return;
  
    const li = del.closest('li.adobe-product');
    const nCodProd   = Number(li.dataset.codprod);
    const nCodCaract = Number(li.dataset.codcar);
  
    if (!confirm('Deseja realmente excluir esta característica?')) return;
  
    try {
      const resp = await fetch(`${API_BASE}/api/omie/prodcaract`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          call:  'ExcluirCaractProduto',
          param: [{ nCodProd, nCodCaract }],
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET
        })
      });
      const json = await resp.json();
  
      if (!resp.ok || json.faultstring) {
        showProxyMsg(json.faultstring || 'Erro ao excluir', false);
        return;
      }
  
      li.remove();
      showProxyMsg('Característica excluída!', true);
  
    } catch (err) {
      showProxyMsg('Erro: ' + err.message, false);
    }
  });
  caracUl._deleteListenerAttached = true;
}

// ————————————————————————————————




  

/* ----------------- 5) Estrutura de produto (malha) ---------------- */
try {
// agora usamos a rota que você já colocou no SQL
const r = await fetch(`${API_BASE}/api/omie/malha`, {
  method : 'POST',
  headers: { 'Content-Type':'application/json' },
  body   : JSON.stringify({
    // o handler SQL que você criou aceita `param[0].cCodigo`
    param: [{ cCodigo: codigo }]
  })
});


  const j = await r.json();

  // 1) Se j for objeto e j.itens for array, usa; senão, deixa vazio
  if (j && Array.isArray(j.itens)) {
    malhaItens = j.itens;
  } else {
    malhaItens = [];
  }

} catch (e) {
  console.error('Erro /api/malha', e);
  // em caso de erro de rede ou resposta inválida, limpa também
  malhaItens = [];
}

// 2) Atualiza a variável global de itens
itens = malhaItens;

// 3) Inicializa e renderiza o filtro/painel (como antes)
if (!document.getElementById('pecasFilterBtn')) {
  initPecasFilter();
}
applyPecasFilter();


/* ------- mapa de rótulos (true = campo editável) ------- */
const MAP_DETALHE = [
  ['codFamMalha',        'Cod família'],
  ['dAltProdMalha',      'D alt'],
  ['dIncProdMalha',      'D inc'],
  ['descrFamMalha',      'Família'],

  ['quantProdMalha',     'QTD',        true],
  ['percPerdaProdMalha', '% de perda', true],
  ['obsProdMalha',       'Observação', true],

  ['tipoProdMalha',      'Tipo']
];

/* ------- monta tabela principal ------- */
const ulMalha = document.getElementById('malha');
ulMalha.innerHTML = `
  <li class="adobe-product header-row">
    <div class="products">Código</div>
    <div class="status">Descrição</div>
    <div class="qtd">QTD</div>
    <div class="unidade">Unidade</div>
    <div class="custo-real">Custo real</div>
    <div class="editar-col"></div>
  </li>
`;

// Atualiza contador na aba Estrutura de produto
// Atualiza contador na aba Estrutura de produto
const structTitle = document.querySelector(
  '#estruturaProduto .title-wrapper .content-section-title'
);
if (structTitle) {
  structTitle.textContent = `Estrutura de produto (${itens.length})`;
}



if (!itens.length) {
  ulMalha.innerHTML += '<li>Nenhuma peça encontrada.</li>';
} else {
  groupAndSortByGroupId(
    itens.map(i => ({ codigo: i.codProdMalha, descr: i.descrProdMalha, __raw: i })),
    'codigo'
  ).forEach(group => {

/* ---------- cabeçalho da categoria ---------- */
const isGab = (group.groupId === 3);          // 3 = GABINETES

// se for GABINETES, extrai o N00.0
let gabCodigo = '';
if (isGab) {
  const m = group.items.find(it => /(N\d{2}\.\d)/.test(it.descr))
                       ?.descr.match(/N\d{2}\.\d/);
  if (m) gabCodigo = ' ' + m[0];              // acrescenta “ N07.1” etc.
}

ulMalha.insertAdjacentHTML('beforeend', `
  <li class="adobe-product category-header"
      data-category="${group.category}"
      data-expanded="true">          
    <strong>${group.category}${gabCodigo}</strong>
  </li>
`);


/* --------------------------------------------------------------- */


    group.items.forEach(({ __raw: item }) => {
      ulMalha.insertAdjacentHTML('beforeend', `
        <li class="adobe-product"
            data-int-produto="${item.intMalha || item.codProdMalha}">
          <div class="products">${item.codProdMalha}</div>
          <span class="status">
            <span class="status-circle green"></span>
            <span class="status-text">${item.descrProdMalha}</span>
          </span>
 <div class="qtd">${
   item.quantProdMalha != null
     ? Number(item.quantProdMalha)
         .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
     : ''
 }</div>

          <div class="unidade">${item.unidProdMalha || ''}</div>
          <div class="custo-real">${
  (item.custoReal != null && item.quantProdMalha != null)
    ? (Number(item.custoReal) * Number(item.quantProdMalha)).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL'
      })
    : ''
}</div>

          <div class="button-wrapper">
            <button type="button" class="content-button status-button open">Abrir</button>
          </div>
          <div class="submenu" style="display:none;"></div>
        </li>
      `);
      
      /* cache do objeto para edição */
      ulMalha.lastElementChild._detalhe = item;
    });
  });
}


/* ------- listener Abrir ⇆ Salvar ------- */
ulMalha.addEventListener('click', async ev => {
  const btn = ev.target.closest('button.open');
  if (!btn) return;

  const li      = btn.closest('li.adobe-product');
  const det     = li._detalhe;
  const submenu = li.querySelector('.submenu');


    /* ----------------------  recolher ---------------------- */
  if (btn.textContent === 'Fechar') {
    submenu.style.display = 'none';
    btn.textContent = 'Abrir';
    return;
  }

  /* --- salvar --- */
  if (btn.textContent === 'Salvar') {
    const payload = {
      call : 'AlterarEstrutura',
      param: [{
        intProduto      : codigo,
        itemMalhaAlterar: [{
          intMalha          : li.dataset.intProduto,
          intProdMalha      : det.intProdMalha,
          quantProdMalha    : +submenu.querySelector('[data-key="quantProdMalha"]').value,
          percPerdaProdMalha: +submenu.querySelector('[data-key="percPerdaProdMalha"]').value,
          obsProdMalha      :  submenu.querySelector('[data-key="obsProdMalha"]').value
        }]
      }],
      app_key   : OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };
  
    btn.disabled  = true;
    btn.textContent = '...';
  
    try {
      /* chama /api/omie/malha (proxy criado no server.js) */
      const r = await fetch(`${API_BASE}/api/omie/malha`, {
        method : 'POST',
        headers: { 'Content-Type':'application/json' },
        body   : JSON.stringify(payload)
      });
      const j = await r.json();           // <-- sempre parseia o JSON
  
      /* ---------- interpreta retorno do Omie ---------- */
      if (r.ok && j.itemMalhaStatus?.[0]) {
        const msg = j.itemMalhaStatus[0].descrStatus || 'Alterado com sucesso!';
        showLineMsg(li, msg, true);
      } else if (j.faultstring) {
        showLineMsg(li, j.faultstring, false);
        throw new Error(j.faultstring);   // força cair no catch
      } else {
        throw new Error('Resposta inesperada do Omie');
      }
  
      /* atualiza cache + UI */
      Object.assign(det, payload.param[0].itemMalhaAlterar[0]);
      li.querySelector('.qtd').textContent = det.quantProdMalha;
  
      btn.textContent       = 'Fechar';
      btn.textContent       = 'Abrir';   // ← volta ao estado normal
      submenu.style.display = 'none';
    } catch (e) {
      console.error('Erro salvar malha', e);
      showLineMsg(li, e.message || 'Erro ao salvar', false);
      btn.textContent = 'Salvar';
    } finally {
      btn.disabled = false;
    }
    return;          // não continue para o fluxo “Abrir”
  }
  

  /* --- abrir / recolher --- */
  const aberto = submenu.style.display === 'block';
  if (aberto) { submenu.style.display = 'none'; return; }

  submenu.innerHTML = `<ul>${
    MAP_DETALHE
      .filter(([k]) => det[k] !== undefined && det[k] !== null)
      .map(([k, label, edit]) =>
        `<li><strong>${label}</strong>:
           ${edit
               ? `<input class="edit-field" data-key="${k}" value="${det[k]}">`
               : det[k]}
         </li>`).join('')
  }</ul>`;
  submenu.style.display = 'block';
  btn.textContent = 'Fechar';          // ⬅️  agora mostra “Fechar”
  submenu.querySelectorAll('.edit-field').forEach(inp => {
    inp.addEventListener('input', () => btn.textContent = 'Salvar', { once:true });
  });
});

function showLineMsg(li, text, ok = true) {
    let span = li.querySelector('.line-msg');
    if (!span) {
      span = document.createElement('span');
      span.className = 'line-msg';
      span.style.marginLeft = '6px';
      span.style.whiteSpace = 'nowrap';
      span.style.display    = 'inline-block';
      span.style.fontSize   = '0.8rem';
      /* coloca logo depois da descrição ─ fica visível em qualquer largura */
      li.querySelector('.status-text').appendChild(span);
    }
     span.textContent = text;
     span.style.color = ok ? 'green' : 'red';
     clearTimeout(span._timer);
     span._timer = setTimeout(() => span.remove(), 6000);
   }


   // atualiza a aba Fotos, se o script de fotos já tiver sido carregado
if (typeof window.loadFotos === 'function') {
  window.loadFotos(codigo);
}

  // atualiza a aba RI com os dados do produto
  if (dados.codigo_produto) {
    window.produtoRIAtual = {
      codigo: codigo,
      id_omie: dados.codigo_produto
    };
    // Se a função de carregar RI estiver disponível, chama
    if (typeof window.carregarItensRI === 'function') {
      window.carregarItensRI(dados.codigo_produto);
    }

    // atualiza a aba PIR com os dados do produto
    window.produtoPIRAtual = {
      codigo: codigo,
      id_omie: dados.codigo_produto
    };
    if (typeof window.carregarItensPIR === 'function') {
      window.carregarItensPIR(dados.codigo_produto);
    }
  }

  // Dispara evento global indicando que o produto foi carregado (usado por outras abas)
  try {
    window.dispatchEvent(new CustomEvent('produto-carregado', {
      detail: {
        codigo,
        familia: window.currentProdutoFamilia || ''
      }
    }));
  } catch(_) { /* noop */ }

}

// 1.1) Helper que chama o seu endpoint de atualização
async function updateTipoCSV(groupId, newFlag) {
  await fetch(`${API_BASE}/api/omie/updateTipo`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ groupId, listaPecas: newFlag })  // 'S' ou 'N'
  });
}

/** Adiciona no container uma tag com prefixo e botão de remoção */
function addTagToDOM(prefix, container) {
  const span = document.createElement('span');
  span.className = 'tag';
  span.innerHTML = `
    ${prefix}
    <button type="button" class="remove-tag" data-prefix="${prefix}">&times;</button>
  `;
  container.appendChild(span);
}

// 1.2) Dentro do initPecasFilter, gere **todos** os grupos presentes,
//     mas marque o checkbox conforme t.listaPecas:
function initPecasFilter() {
  const titleWrap = document.querySelector('#listaPecasTab .title-wrapper');
  if (!titleWrap) return;
  // pega só os grupos que aparecem em malhaItens
  const presentes = new Set(
    malhaItens.map(i => parseInt(i.codProdMalha.split('.')[0], 10))
  );
  // pego todas as linhas do CSV, mesmo as N, desde que o grupo esteja presente
  const tiposVisiveis = tipoList.filter(t => presentes.has(t.groupId));

  // 3) botão
  const btn = document.createElement('button');
  btn.id = 'pecasFilterBtn';
  btn.className = 'filter-button';
  btn.innerHTML = '<i class="fa fa-filter"></i>';
  titleWrap.appendChild(btn);

  // 4) painel
  const panel = document.createElement('div');
  panel.id = 'pecasFilterPanel';
  panel.className = 'filter-panel';
  panel.style.display = 'none';
   document.querySelector('#listaPecasTab .content-section')
           .prepend(panel);

  btn.addEventListener('click', ()=>{
    panel.classList.toggle('show');   // adiciona / remove a classe
  });
  


  
  // 5) monta form com checkboxes
// depois de const tiposVisiveis = …
panel.innerHTML = `
  <form id="pecasFilterForm">
    <strong>Filtrar Categoria:</strong><br>
    ${tiposVisiveis.map(t => `
      <div class="category-filter" data-group-id="${t.groupId}">
        <label>
          <input type="checkbox"
                 name="grupo"
                 value="${t.groupId}"
                 ${t.listaPecas ? 'checked' : ''}>
          ${t.descricao}
        </label>
        <div class="tag-input">
          <input type="text" placeholder="Digite e Enter para tag"/>
        </div>
        <div class="tags">
          ${t.prefixesToExclude.map(pref => `
            <span class="tag">
              ${pref}
              <button type="button" class="remove-tag" data-prefix="${pref}">&times;</button>
            </span>
          `).join('')}
        </div>
      </div>
    `).join('')}
  </form>`;

  // para cada categoria…
  panel.querySelectorAll('.category-filter').forEach(catEl => {
    const gid           = +catEl.dataset.groupId;
    const tipo          = tipoList.find(t => t.groupId === gid);
    const input         = catEl.querySelector('.tag-input input');
    const tagsContainer = catEl.querySelector('.tags');
 
    // ao digitar e pressionar Enter
    input.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const raw = input.value.trim();
      if (!raw) return;
      input.value = '';
      const prefix = raw.toUpperCase();
// evita duplicar
if (tipo.prefixesToExclude.includes(prefix)) return;

// chama o endpoint correto
await fetch(`${API_BASE}/api/omie/updateNaoListar`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ groupId: gid, prefix })
});

// atualiza front-end

      tipo.prefixesToExclude.push(prefix);
      addTagToDOM(prefix, tagsContainer);
      applyPecasFilter();

    });

  // remove tag quando clicar no “×”
  tagsContainer.addEventListener('click', async e => {
    if (!e.target.classList.contains('remove-tag')) return;
    const pref = e.target.dataset.prefix;

    // dispara remoção no CSV
    await fetch(`${API_BASE}/api/omie/removeNaoListar`, {
      method: 'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ groupId: gid, prefix: pref })
    });
    const tipo = tipoList.find(t => t.groupId === gid);

    // remove da memória e do DOM
    tipo.prefixesToExclude = tipo.prefixesToExclude.filter(p => p !== pref);
    e.target.closest('.tag').remove();
    applyPecasFilter();
  });

});


  // 1.3) **ao mudar** um checkbox:
  panel.querySelectorAll('input[name="grupo"]').forEach(cb => {
    cb.addEventListener('change', async e => {
      const gid     = parseInt(e.target.value, 10);
      const checked = e.target.checked;
      // 1) atualiza no servidor o CSV
      await updateTipoCSV(gid, checked ? 'S' : 'N');
      // 2) atualiza na memória (para não precisar recarregar p/ efeito imediato)
      const tipo = tipoList.find(t => t.groupId === gid);
      if (tipo) tipo.listaPecas = checked;
      // 3) reaplica o filtro
      applyPecasFilter();
    });
  });
}

/**
 * Lê os groupId marcados e filtra malhaItens por eles.
 */
function applyPecasFilter() {
  // lê os grupos marcados (string → int)
  const checkedGrupos = Array.from(
    document.querySelectorAll('#pecasFilterForm input[name="grupo"]:checked')
  ).map(el => parseInt(el.value, 10));



  // filtra malhaItens por groupId e prefixesToExclude vindos do CSV
const filtrados = malhaItens.filter(item => {
  const gid = parseInt(item.codProdMalha.split('.')[0], 10);
  if (!checkedGrupos.includes(gid)) return false;
  const info = tipoList.find(t => t.groupId === gid);
  const desc = item.descrProdMalha.toLowerCase();
  return !info.prefixesToExclude
    .some(pref =>
      // compara em lower-case para garantir case-insensitive
      desc.startsWith(pref.toLowerCase())
    );
});


  // re-renderiza
  renderListaPecas(filtrados);
  document.querySelector('#listaPecasTab .content-section-title')
          .textContent = `Lista de peças (${filtrados.length})`;
}



/* ----------------- 7) Controle de abas internas -------------------- */
document.addEventListener('DOMContentLoaded', () => {
  // Abas principais
  document.querySelectorAll('a.main-header-link[data-target]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('a.main-header-link[data-target]')
              .forEach(l => l.classList.remove('is-active'));
      link.classList.add('is-active');
      document.querySelectorAll('.tab-pane')
              .forEach(p => p.style.display = 'none');
      document.getElementById(link.dataset.target).style.display = 'block';
    });
  });

  // Sub-abas dentro de Dados do produto
  document.querySelectorAll('a.main-header-link[data-subtarget]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('a.main-header-link[data-subtarget]')
              .forEach(l => l.classList.remove('is-active'));
      link.classList.add('is-active');
      document.querySelectorAll('.sub-content')
              .forEach(sec => sec.style.display = 'none');
      document.getElementById(link.dataset.subtarget).style.display = 'block';
    });
  });

  const primeiraSub = document.querySelector('a.main-header-link[data-subtarget]');
  if (primeiraSub) primeiraSub.click();
});

// expõe global para o menu_produto.js
window.loadDadosProduto = loadDadosProduto;