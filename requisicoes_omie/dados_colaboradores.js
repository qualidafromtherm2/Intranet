// requisicoes_omie/dados_colaboradores.js
import { injectAnexoControls, listAnexos } from './anexos.js';
// Controle de drag global
let isDragging   = false;
let photoMoved   = false;
let startX = 0, startY = 0;
let initX  = 50, initY  = 50;

const photoPositionCache = {};

export function initDadosColaboradoresUI() {
  const btnColab = document.getElementById('btn-colaboradores');
  if (!btnColab) return;

  /* evita registrar o listener mais de uma vez */
  if (btnColab.dataset.initiated) return;
  btnColab.dataset.initiated = '1';

  btnColab.addEventListener('click', async e => {
    e.preventDefault();

    /* esconde todas as abas de nível superior */
    document.querySelectorAll('.tab-pane').forEach(p => (p.style.display = 'none'));

    /* cria o painel, se ainda não existir */
    let pane = document.getElementById('dadosColaboradores');
    if (!pane) {
      pane = document.createElement('div');
      pane.id = 'dadosColaboradores';
      pane.className = 'tab-pane';
pane.innerHTML = `
  <div class="content-wrapper">
    <div class="content-section">
      <div class="title-wrapper">
        <div class="content-section-title">
          Colaboradores
          <span class="caract-toolbar">
            <i class="fa-solid fa-wrench" id="wrenchIcon"></i>


<ul class="caract-menu" id="caractMenu">
  <li>
    <i class="fa-solid fa-plus" id="btnAdicionar" title="Adicionar"></i>
  </li>
  <li>
    <i class="fa-solid fa-trash" id="btnExcluir" title="Excluir"></i>
  </li>
</ul>



          </span>
        </div>
      </div>
      <ul id="colaboradoresList" class="content-list product-details"></ul>
      <div id="colabDetails" style="display:none;">
        <div id="colabPhotoWrapper">
          <img id="colabPhoto" src="" alt="" />
        </div>
        <div class="title-wrapper">
          <button id="backToList" class="icon-button">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
        </div>
        <ul id="colabDetailsList" class="content-list product-details"></ul>
      </div>
    </div>
  </div>`;

   // 1) referências ao ícone e ao menu
   const wrench = pane.querySelector('#wrenchIcon');
   const menu   = pane.querySelector('#caractMenu');

   // 2) ao clicar na chave, abre/fecha o menu
   wrench.addEventListener('click', e => {
     e.stopPropagation();              // não deixa o document.click fechar na mesma hora
     menu.classList.toggle('show');
   });

   // 3) ao clicar fora, fecha o menu
   document.addEventListener('click', () => {
     menu.classList.remove('show');
   });
   // evita que clicar dentro do menu feche ele
   menu.addEventListener('click', e => e.stopPropagation());

   // 4) handlers dos botões + e lixo (mantém como já está)
pane.querySelector('#btnAdicionar').addEventListener('click', () => {
  // 1) Fecha o menu de opções
  const menu = pane.querySelector('#caractMenu');
  menu.classList.remove('show');

  // 2) Esconde a lista e exibe o painel de detalhes
  pane.querySelector('#colaboradoresList').style.display = 'none';
  const detPane = pane.querySelector('#colabDetails');
  detPane.style.display = 'block';



// 3) Modo Adicionar: limpa wrapper e monta só o campo de upload
// 3) Modo Adicionar: esconde completamente o wrapper de foto
const wrapper = detPane.querySelector('#colabPhotoWrapper');
wrapper.style.display = 'none';



  // 4) Remove botões de anexo/editar que possam ter sido injetados em modo Detalhes
  // remove exatamente o que o injectAnexoControls adiciona
detPane.querySelectorAll('#anexoRow1, #anexoRow2, #anexosList, #editDetails')
       .forEach(el => el.remove());


  // 5) Limpa e monta o formulário com campos obrigatórios
  const list = detPane.querySelector('#colabDetailsList');
  list.innerHTML = '';
  const campos = [
    { key: 'cNome',      label: 'Nome',               type: 'text',  readonly: false, optional: false },
    { key: 'cSobrenome', label: 'Sobrenome',          type: 'text',  readonly: false, optional: false },
    { key: 'cCodInt',    label: 'Login',              type: 'text',  readonly: true,  optional: false },
    { key: 'dDtNasc',    label: 'Data de Nascimento', type: 'date',  readonly: false, optional: false },
    { key: 'cCargo',     label: 'Cargo',              type: 'text',  readonly: false, optional: false },
    { key: 'cCelular',   label: 'Celular',            type: 'tel',   readonly: false, optional: false },
    { key: 'cEmail',     label: 'E-mail',             type: 'email', readonly: false, optional: false },
    { key: 'cCEP',       label: 'CEP',                type: 'text',  readonly: false, optional: false },
    { key: 'cEndereco',  label: 'Endereço',           type: 'text',  readonly: false, optional: false },
    { key: 'cCompl',     label: 'Complemento',        type: 'text',  readonly: false, optional: false },
    { key: 'cBairro',    label: 'Bairro',             type: 'text',  readonly: false, optional: false },
    { key: 'cCidade',    label: 'Cidade',             type: 'text',  readonly: false, optional: false },
    { key: 'cUF',        label: 'Estado (UF)',        type: 'text',  readonly: false, optional: false },
    { key: 'cPais',      label: 'País',               type: 'text',  readonly: false, optional: false },
    { key: 'cObs',       label: 'Observações',        type: 'text',  readonly: false, optional: true  }
  ];

  campos.forEach(({ key, label, type, readonly, optional }) => {
    const li = document.createElement('li');
    li.className = 'detail-row';
    li.innerHTML = `
      <label for="field-${key}" class="detail-label">${label}</label>
      <input
        id="field-${key}"
        name="${key}"
        type="${type}"
        class="detail-input"
        ${readonly ? 'readonly' : ''}
        ${optional ? '' : 'required'}
      />`;
    list.appendChild(li);
  });

  // 6) Geração automática de Login ao preencher Nome + Celular
  const nameInput  = detPane.querySelector('#field-cNome');
  const celInput   = detPane.querySelector('#field-cCelular');
  const loginInput = detPane.querySelector('#field-cCodInt');
  celInput.addEventListener('blur', () => {
    const nome = nameInput.value.trim().toLowerCase().replace(/\s+/g, '');
    const dígitos = celInput.value.replace(/\D/g, '');
    if (nome && dígitos.length >= 4) {
      loginInput.value = `${nome}${dígitos.slice(-4)}`;
    }
  });

  // 7) Botão “Cadastrar” (aparece só no modo adicionar)
  let btnCadastrar = detPane.querySelector('#btnCadastrar');
  if (!btnCadastrar) {
    btnCadastrar = document.createElement('button');
    btnCadastrar.id = 'btnCadastrar';
    btnCadastrar.className = 'content-button';
    btnCadastrar.textContent = 'Cadastrar';
    // adiciona após o back button
    const titleWrapper = detPane.querySelector('.title-wrapper');
    titleWrapper.appendChild(btnCadastrar);
  }
  btnCadastrar.style.display = 'inline-flex';
 btnCadastrar.onclick = async () => {
   // 1) coleta valores dos inputs (payload já existente)
   const detPane = pane.querySelector('#colabDetails');
   const payload = { 
     identificacao: {
       cCodInt:    detPane.querySelector('#field-cCodInt').value.trim(),
       cNome:      detPane.querySelector('#field-cNome').value.trim(),
       cSobrenome: detPane.querySelector('#field-cSobrenome').value.trim(),
       cCargo:     detPane.querySelector('#field-cCargo').value.trim(),
    // converte yyyy-MM-dd → dd/MM/yyyy
    dDtNasc: (() => {
      const raw = detPane.querySelector('#field-dDtNasc').value;   // "2025-05-21"
      const [y, m, d] = raw.split('-');
      return `${d}/${m}/${y}`;                                     // "21/05/2025"
    })(),
       nCodVend:   0,
       nCodConta:  0
     },
     endereco: {
       cCEP:       detPane.querySelector('#field-cCEP').value.replace(/\D/g, ''),
       cEndereco:  detPane.querySelector('#field-cEndereco').value.trim(),
       cCompl:     detPane.querySelector('#field-cCompl').value.trim(),
       cBairro:    detPane.querySelector('#field-cBairro').value.trim(),
       cCidade:    detPane.querySelector('#field-cCidade').value.trim(),
       cUF:        detPane.querySelector('#field-cUF').value.trim(),
       cPais:      detPane.querySelector('#field-cPais').value.trim()
     },
     telefone_email: {
       cDDDCel1: detPane.querySelector('#field-cCelular').value.replace(/\D/g,'').slice(0,2),
       cNumCel1: detPane.querySelector('#field-cCelular').value.replace(/\D/g,'').slice(2),
       cEmail:   detPane.querySelector('#field-cEmail').value.trim(),
       cNumFax:  'N'
     },
     cObs: detPane.querySelector('#field-cObs').value.trim()
   };

   // 2) envia para o seu proxy /api/omie/contatos-incluir
   try {
     const resp = await fetch('/api/omie/contatos-incluir', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify(payload)
     });
     const result = await resp.json();
     if (!resp.ok) throw new Error(result.error || JSON.stringify(result));


    // → volta para lista
    pane.querySelector('#backToList').click();

    // → monta placeholder no topo com spinner
    const ul = pane.querySelector('#colaboradoresList');
    const placeholder = document.createElement('li');
    placeholder.className = 'detail-row placeholder-row';
    placeholder.innerHTML = `
      <span class="products">–</span>
      <span class="status">
        <i class="fa-solid fa-spinner fa-spin"></i>
        Aguardando inclusão…
      </span>`;
    ul.insertBefore(placeholder, ul.firstChild);

    // → prepara retry loop
    const newCode = payload.identificacao.cCodInt;
    let attempts = 0;
    const maxAttempts = 5;

    const tryFetch = async () => {
      attempts++;
      // 10s na 1ª vez, depois 5s
      await new Promise(r => setTimeout(r, attempts === 1 ? 10000 : 5000));

      // busca a lista de colaboradores
      const resp2 = await fetch('/api/omie/login/contatos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pagina: 1,
          registros_por_pagina: 100,
          exibir_obs: 'S'
        })
      });
      const { cadastros = [] } = await resp2.json();

      // tenta encontrar o novo colaborador
      const found = cadastros.find(c => c.identificacao?.cCodInt === newCode);
      if (found) {
        // substitui placeholder por linha real



const li = document.createElement('li');

// ► verifica se o cadastrado veio como Inativo = 'S'
const inativo = (found.telefone_email?.cNumFax || '')
                  .trim().toUpperCase() === 'S';
if (inativo) li.classList.add('inactive-row');

const nome = `${found.identificacao.cNome} ${found.identificacao.cSobrenome}`.trim();
li.innerHTML = `
  <span class="products">${newCode}</span>
  <span class="status">${nome}</span>
  <div class="button-wrapper">
    <button class="content-button status-button btn-det">Detalhes</button>
  </div>`;

li.querySelector('.btn-det')
  .addEventListener('click', () => showColabDetails(found));

ul.replaceChild(li, placeholder);
      } else if (attempts < maxAttempts) {
        // não achou ainda → tenta de novo
        await tryFetch();
      } else {
        // esgotou tentativas
        placeholder.innerHTML = `
          <span class="products">–</span>
          <span class="status">Usuário não cadastrado</span>`;
      }
    };

    // dispara o primeiro ciclo
    tryFetch();

   } catch (err) {
     console.error('❌ Erro ao incluir contato no Omie:', err);
     alert('Erro ao cadastrar: ' + err.message);
   }
 };




});




// dentro de initDadosColaboradoresUI(), depois de montar o painel:
pane.querySelector('#btnExcluir').addEventListener('click', () => {
  const ul = pane.querySelector('#colaboradoresList');
  // para cada linha, troca Detalhes por Lixeira
  ul.querySelectorAll('li').forEach(li => {
    const wrapper = li.querySelector('.button-wrapper');
    // 1) esconde o botão “Detalhes”
    const det = wrapper.querySelector('.btn-det');
    if (det) det.style.display = 'none';
    // 2) injeta o botão “Lixeira”
    const code = li.querySelector('.products').textContent.trim();
    const trash = document.createElement('button');
    trash.className = 'content-button status-button btn-trash';
    trash.innerHTML = '<i class="fa-solid fa-trash"></i>';
    wrapper.appendChild(trash);

    // 3) ao clicar no trash, chama o proxy de exclusão
    trash.addEventListener('click', async () => {
      try {
        const resp = await fetch('/api/omie/contatos-excluir', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ cCodInt: code })
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || JSON.stringify(result));
   // 1) pega título e cria/atualiza span de status
   const title = pane.querySelector('.content-section-title');
   let statusSpan = title.querySelector('#deleteStatusMsg');
   if (!statusSpan) {
     statusSpan = document.createElement('span');
     statusSpan.id = 'deleteStatusMsg';
     statusSpan.style.marginLeft = '12px';
     statusSpan.style.fontSize = '0.9em';
     title.appendChild(statusSpan);
   }
   // 2) mostra código + mensagem de retorno
   statusSpan.textContent = `${result.cCodInt}: ${result.cDesStatus}`;
           // 3) tira a linha removida da lista
        li.remove();
      } catch (err) {
        console.error('Erro ao excluir colaborador', err);
        alert('Erro ao excluir: ' + err.message);
      } finally {
        // 4) sai do modo “Excluir” e restaura todas as linhas
        ul.querySelectorAll('.btn-trash').forEach(b => b.remove());
        ul.querySelectorAll('.btn-det').forEach(b => b.style.display = '');
      }
    });
  });
});




// Por fim, monta o painel no DOM
document
  .querySelector('.main-container .tab-content')
  .appendChild(pane);



      /* voltar para a lista */
      pane.querySelector('#backToList').addEventListener('click', () => {
        pane.querySelector('#colabDetails').style.display = 'none';
        pane.querySelector('#colaboradoresList').style.display = '';
      });
    }
    pane.style.display = 'block';

    /* ------------------------------------------------------------------
       1) BUSCA os colaboradores
    ------------------------------------------------------------------ */
// 1) BUSCA os colaboradores
const ul = pane.querySelector('#colaboradoresList');
ul.innerHTML = '<li>Carregando…</li>';

let registros = [];
try {
  // faz a chamada e guarda em `resp`
  const resp = await fetch('/api/omie/login/contatos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      pagina: 1,
      registros_por_pagina: 100,
      exibir_obs: 'S'
    }),
  });

  // converte em JSON e extrai a lista
  const result = await resp.json();
  registros = result.cadastros || [];

} catch (err) {
  console.error('Falha ao listar colaboradores:', err);
}

if (!registros.length) {
  ul.innerHTML = '<li>Nenhum colaborador encontrado.</li>';
  return;
}

ul.innerHTML = '';
// … restante do seu código que faz registros.forEach(…)


    /* ------------------------------------------------------------------
       2) LISTA resumida com botão Detalhes
    ------------------------------------------------------------------ */
    registros.forEach(col => {
      const id   = col.identificacao?.cCodInt || '';
      const nome = `${col.identificacao?.cNome || ''} ${col.identificacao?.cSobrenome || ''}`.trim();


 // Verifica Inativo = 'S'
 const inativo = (col.telefone_email?.cNumFax || '').trim().toUpperCase() === 'S';

      const li = document.createElement('li');
      li.innerHTML = `
        <span class="products">${id}</span>
        <span class="status">${nome}</span>
        <div class="button-wrapper">
          <button class="content-button status-button btn-det">Detalhes</button>
        </div>`;

        if (inativo) li.classList.add('inactive-row');

      ul.appendChild(li);

      li.querySelector('.btn-det').addEventListener('click', () => showColabDetails(col));
    });

    /* ------------------------------------------------------------------
       3) FUNÇÃO que abre painel de detalhes + injeta botões Anexo
    ------------------------------------------------------------------ */
function showColabDetails(col) {
  // → Remove qualquer input de upload que ficou do modo Adicionar
  pane.querySelector('#colabPhotoInput')?.remove();

  // 1) Guarda o colaborador atual para os controles de anexo
  window.currentColaborador = col;

  // 2) Oculta a lista e exibe o painel de detalhes
  pane.querySelector('#colaboradoresList').style.display = 'none';
  const detPane = pane.querySelector('#colabDetails');
  detPane.style.display = 'block';

  // — Prepara referências aos elementos principais —
 // — Prepara referências aos elementos principais —
 let wrapper   = detPane.querySelector('#colabPhotoWrapper');
 const photo   = detPane.querySelector('#colabPhoto');
 const wrap    = detPane.querySelector('.title-wrapper');

 // botão-ícone "salvar posição"
 const savePosBtn          = document.createElement('button');
 savePosBtn.id             = 'savePhotoPos';
 savePosBtn.className      = 'icon-button';
 savePosBtn.title          = 'Salvar posição da foto';
 savePosBtn.style.display  = 'none';
 savePosBtn.innerHTML      = '<i class="fa-solid fa-floppy-disk"></i>';
 wrapper.after(savePosBtn);          // insere logo ao lado da foto


 // ── handler do disquete: salva somente a posição ──
savePosBtn.addEventListener('click', async () => {
  if (!photoMoved) return;

  const novoPos = detPane
        .querySelector('#photoPositionValue').textContent.trim();
  try {
    await fetch('/api/omie/contatos-alterar', {
      method:  'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identificacao:  { nCod: Number(col.identificacao.nCod) },
        telefone_email: { cNumCel2: novoPos }
      })
    });

    alert('Posição da foto salva com sucesso!');
    photoPositionCache[col.identificacao.cCodInt] = novoPos;
    photoMoved             = false;
    savePosBtn.style.display = 'none';  // esconde o ícone
  } catch (err) {
    console.error(err);
    alert('Erro ao salvar posição: ' + err.message);
  }
});

  // 3) Restaura o preview de foto (oculto no Adicionar)
  wrapper.style.display = 'block';
  photo.style.display   = 'block';
  wrapper.style.cursor  = 'grab';
  photo.src             = '';
  const pos             = col.telefone_email?.cNumCel2 || '50% 50%';
  photo.style.objectPosition = pos;

  // Se tiver posição salva, aplica e atualiza o campo
const cachedPos = photoPositionCache[col.identificacao.cCodInt];
if (cachedPos) {
  photo.style.objectPosition = cachedPos;
  const posSpan = detPane.querySelector('#photoPositionValue');
  if (posSpan) posSpan.textContent = cachedPos;
}


  // 4) Preenche os campos fixos
  const list     = detPane.querySelector('#colabDetailsList');
  list.innerHTML = '';
  const fullName = `${col.identificacao?.cNome || ''} ${col.identificacao?.cSobrenome || ''}`.trim();
  const campos = [
    ['Nome',               fullName],
    ['Login',              col.identificacao?.cCodInt  || ''],
    ['Cargo',              col.identificacao?.cCargo   || ''],
    ['Data de Nascimento', col.identificacao?.dDtNasc  || ''],
    ['Celular',            formatCel(col.telefone_email)|| ''],
    ['CEP',                col.endereco?.cCEP          || ''],
    ['Bairro',             col.endereco?.cBairro       || ''],
    ['Cidade',             col.endereco?.cCidade       || ''],
    ['Endereço',           col.endereco?.cEndereco     || ''],
    ['País',               col.endereco?.cPais         || 'Brasil'],
    ['Estado',             col.endereco?.cUF           || ''],
    ['Email',              col.telefone_email?.cEmail  || ''],
    ['Inativo', ((col.telefone_email?.cNumFax || '').trim().toUpperCase()) || 'N'],
    ['Observações',        col.cObs                    || ''],
    ['Código Omie',        col.identificacao?.nCod     || '']
  ];
  campos.forEach(([label, valor]) => {
    const li = document.createElement('li');
    li.className = 'detail-row';
    li.innerHTML = `
      <span class="detail-label">${label}</span>
      <span class="detail-value">${valor}</span>`;
    list.appendChild(li);
  });

  // 5) Linha extra: “Posição da Foto”
  const posLi = document.createElement('li');
  posLi.className = 'detail-row';
  posLi.innerHTML = `
    <span class="detail-label">Posição da Foto</span>
    <span class="detail-value" id="photoPositionValue">${pos}</span>`;
  list.appendChild(posLi);

  // 6) Injeta controles de anexo e o botão Editar

  injectAnexoControls(wrap);
const row1 = wrap.querySelector('#anexoRow1');
if (!row1) {
  console.error('⚠️  #anexoRow1 não encontrado; verifique injectAnexoControls');
  return;            // ou crie manualmente, se preferir
}
  const editBtn = document.createElement('button');
  editBtn.id        = 'editDetails';
  editBtn.className = 'content-button';
  editBtn.textContent = 'Editar';
  wrap.querySelector('#anexoRow1').appendChild(editBtn);


const newWrapper = detPane.querySelector('#colabPhotoWrapper');

  // — Controle do drag da foto —
wrapper.addEventListener('mousedown', e => {
  e.preventDefault();
  isDragging = true;
  startX = e.clientX;
  startY = e.clientY;
  [initX, initY] = photo.style.objectPosition.split(' ').map(parseFloat);
  wrapper.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', e => {
  if (!isDragging) return;

  const { width, height } = wrapper.getBoundingClientRect();
  const dx = (e.clientX - startX) / width  * 100;
  const dy = (e.clientY - startY) / height * 100;
  const newX = Math.min(100, Math.max(0, initX + dx));
  const newY = Math.min(100, Math.max(0, initY - dy));

  photo.style.objectPosition = `${newX}% ${newY}%`;

  const posSpan = detPane.querySelector('#photoPositionValue');
  if (posSpan) posSpan.textContent = `${newX.toFixed(2)}% ${newY.toFixed(2)}%`;
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  wrapper.style.cursor = 'grab';

  // habilita fluxo de salvar posição
  photoMoved = true;
  savePosBtn.style.display = 'inline-flex';      // NOVO – mostra ícone
});

  // — fim drag —

  // 7) Handler do botão Editar/Salvar
  editBtn.addEventListener('click', async () => {

// 7.1) Se o usuário quiser salvar a posição da foto,
    if (editBtn.textContent === 'Editar') {
      editBtn.textContent = 'Salvar';
      list.querySelectorAll('li.detail-row').forEach(li => {
        const label = li.querySelector('.detail-label').textContent.trim();
        if (['Login','Código Omie','Posição da Foto'].includes(label)) return;
        const span = li.querySelector('.detail-value');
        const val  = span.textContent.trim();
        span.remove();
        let inp;
 if (label === 'Inativo') {
   inp = document.createElement('select');
   ['S','N'].forEach(opt=>{
     const o=document.createElement('option');
     o.value=o.textContent=opt;
     if(opt===val) o.selected=true;
     inp.appendChild(o);
   });
 } else if (label === 'Observações') {
          inp = document.createElement('textarea'); inp.rows = 4;
        } else if (label === 'Data de Nascimento') {
          inp = document.createElement('input'); inp.type = 'date';
          const [d,m,y] = val.split('/'); inp.value = `${y}-${m}-${d}`;
        } else {
          inp = document.createElement('input'); inp.type = 'text'; inp.value = val;
        }
        inp.className = 'detail-input';
        li.appendChild(inp);
      });
      return;
    }

    // 7.3) Salva todos os campos editados
    const body = {
      identificacao: { nCod: Number(col.identificacao.nCod), cNome:'', cSobrenome:'', cCargo:'', dDtNasc:'', nCodVend:col.identificacao.nCodVend, nCodConta:col.identificacao.nCodConta },
      endereco:       { cEndereco:'', cCompl:'', cCEP:'', cBairro:'', cCidade:'', cUF:'', cPais:'' },
      telefone_email: { cDDDCel1:'', cNumCel1:'', cEmail:'', cNumFax:'', cNumCel2:'' },
      cObs: ''
    };

    
    list.querySelectorAll('li.detail-row').forEach(li => {
  const label = li.querySelector('.detail-label').textContent.trim();
  const inp   = li.querySelector('input,textarea,select');
  if (!inp) return;

  // valor normalizado
  const newVal = inp.tagName === 'SELECT' ? inp.value : inp.value.trim();

  switch (label) {
    case 'Nome': {
      const [first, ...rest] = newVal.split(' ');
      body.identificacao.cNome      = first;
      body.identificacao.cSobrenome = rest.join(' ');
    } break;

    case 'Cargo':
      body.identificacao.cCargo = newVal;
      break;

    case 'Data de Nascimento': {
      // vem yyyy-MM-dd → precisa dd/MM/yyyy
      const [y, m, d] = newVal.split('-');
      body.identificacao.dDtNasc = `${d}/${m}/${y}`;
    } break;

    /* -------- Endereço -------- */
    case 'Endereço':    body.endereco.cEndereco = newVal; break;
    case 'Complemento': body.endereco.cCompl    = newVal; break;
    case 'CEP':         body.endereco.cCEP      = newVal.replace(/\D/g, ''); break;
    case 'Bairro':      body.endereco.cBairro   = newVal; break;
    case 'Cidade':      body.endereco.cCidade   = newVal; break;
    case 'Estado (UF)': body.endereco.cUF       = newVal; break;
    case 'País':        body.endereco.cPais     = newVal; break;

    /* -------- Contato -------- */
    case 'Celular': {
      const d = newVal.replace(/\D/g, '');
      body.telefone_email.cDDDCel1 = d.slice(0, 2);
      body.telefone_email.cNumCel1 = d.slice(2);
    } break;
    case 'E-mail':
      body.telefone_email.cEmail = newVal;
      break;

    /* -------- Inativo e Foto -------- */
    case 'Inativo':
      body.telefone_email.cNumFax = newVal.toUpperCase();   // S ou N
      break;
    case 'Posição da Foto':
      body.telefone_email.cNumCel2 = newVal;
      break;

    /* -------- Observações -------- */
    case 'Observações':
      body.cObs = newVal;
      break;
  }
});

    try {
      const resp = await fetch('/api/omie/contatos-alterar', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error||json);
      alert('Dados salvos com sucesso!');

// --- ajusta cor da linha na lista principal ---
const ulList   = pane.querySelector('#colaboradoresList');
const codigo   = col.identificacao.cCodInt;
const listItem = [...ulList.querySelectorAll('li')].find(li =>
  li.querySelector('.products')?.textContent.trim() === codigo);

if (listItem) {
  const inativoNow = body.telefone_email.cNumFax === 'S';
  listItem.classList.toggle('inactive-row', inativoNow);
}

      // ---- volta ao modo visual ----
list.querySelectorAll('li.detail-row').forEach(li => {
  const inp = li.querySelector('input,textarea,select');
  if (!inp) return;
  const span = document.createElement('span');
  span.className = 'detail-value';
  span.textContent = (inp.tagName === 'SELECT' ? inp.value : inp.value.trim()) || '–';

  inp.remove();
  li.appendChild(span);
});
photoMoved       = false;
editBtn.disabled = true;   // só habilita de novo se arrastar foto
editBtn.textContent = 'Editar';

      // atualiza só Observações na tela
      const obsLi = Array.from(list.children).find(li => li.querySelector('.detail-label').textContent.trim() === 'Observações');
      if (obsLi) obsLi.querySelector('.detail-value').textContent = body.cObs;
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar dados: ' + err.message);
    }
    editBtn.textContent = 'Editar';
  });

  // 8) Carrega a foto via OMIE “ObterAnexo”
  (async () => {
    try {
      const { listaAnexos = [] } = await listAnexos('crm-contatos', Number(col.identificacao.nCod));
      const imageAnexos = listaAnexos.filter(a => ['png','jpg','jpeg'].includes(a.cTipoArquivo.toLowerCase()));
      if (!imageAnexos.length) return;
      const imgMeta = imageAnexos.reduce((p, c) => c.nIdAnexo>p.nIdAnexo?c:p);
      const resp = await fetch('/api/omie/anexo-obter', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ cTabela:'crm-contatos', nId:Number(col.identificacao.nCod), cCodIntAnexo:imgMeta.cCodIntAnexo })
      });
      const { cLinkDownload } = await resp.json();
      photo.src = cLinkDownload;
    } catch (err) {
      console.error('Erro ao carregar foto via ObterAnexo:', err);
    }
  })();
}



    function formatCel(tel) {
      if (!tel?.cNumCel1) return '';
      const ddd = tel.cDDDCel1 ? `(${tel.cDDDCel1}) ` : '';
      return ddd + tel.cNumCel1;
    } 
  });
}
