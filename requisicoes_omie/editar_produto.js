// requisicoes_omie/editar_produto.js
import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : window.location.origin;      // Render ou outro domínio
    
// guarda o código atual do produto
export let currentCodigo = null;

// chamado por Dados_produto.js — mantenha apenas esta função
export function setCurrentCodigo(codigo) {
  currentCodigo = codigo;
}

// — estado compartilhado entre funções —
export const editedFields = {};
let   saveAllBtn   = null;
let   familyCache  = [];
let   retryCountdownInterval = null;
let   retryCountdownSpan     = null;


/**
 * Garante existência e configura o botão “Salvar alterações”
 */
/**
 * Garante existência e configura o botão “Salvar alterações”
 */
export function ensureSaveAllBtn() {
    if (!saveAllBtn) {
      saveAllBtn = document.createElement('button');
      saveAllBtn.id = 'save-all-btn';
      saveAllBtn.textContent = 'Salvar alterações';
      saveAllBtn.style.cssText = `
        margin:0 10px;
        display:none;
        float:right;
        background-color:#28a745;
        color:#fff;
        border:none;
        padding:6px 12px;
        border-radius:4px;
      `;
      const subTabsContainer = document
        .querySelector('a.main-header-link[data-subtarget]')
        .parentNode;
      subTabsContainer.appendChild(saveAllBtn);
  
      saveAllBtn.addEventListener('click', async () => {
        // cancela qualquer retry pendente
        if (retryCountdownInterval) {
          clearInterval(retryCountdownInterval);
          retryCountdownInterval = null;
          if (retryCountdownSpan) retryCountdownSpan.remove();
        }
  
        const payload = { codigo: currentCodigo, ...editedFields };
        const bodyRaw = JSON.stringify({ produto_servico_cadastro: payload });
        console.log('[SalvarTudo] payload →', bodyRaw);
  
        try {
          const resp   = await fetch(`${API_BASE}/api/produtos/alterar`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    bodyRaw
          });
          const result = await resp.json();
          console.log('[SalvarTudo]', resp.status, result);
  
          // extrai faultcode, até mesmo dentro de result.error
          let faultcode = result.faultcode;
          if (!faultcode && result.error) {
            try {
              const errObj = JSON.parse(result.error);
              faultcode = errObj.faultcode;
            } catch {}
          }
  
          // se for throttle SOAP-ENV:Client-8020, faz retry em 60s
          if (faultcode === 'SOAP-ENV:Client-8020') {
            let seconds = 60;
            if (!retryCountdownSpan) {
              retryCountdownSpan = document.createElement('span');
              retryCountdownSpan.className = 'status-msg countdown';
              saveAllBtn.parentNode.insertBefore(retryCountdownSpan, saveAllBtn.nextSibling);
            }
            retryCountdownSpan.textContent = `Reenviando em ${seconds}s`;
            retryCountdownInterval = setInterval(() => {
              seconds--;
              if (seconds > 0) {
                retryCountdownSpan.textContent = `Reenviando em ${seconds}s`;
              } else {
                clearInterval(retryCountdownInterval);
                retryCountdownInterval = null;
                retryCountdownSpan.remove();
                retryCountdownSpan = null;
                saveAllBtn.click();
              }
            }, 1000);
            return;
          }
  
          // extrai mensagem de sucesso ou faultstring
          let msg;
          if (result.faultstring) {
            msg = result.faultstring;
          } else if (result.error) {
            try {
              msg = JSON.parse(result.error).faultstring;
            } catch {
              msg = result.error;
            }
          } else {
            msg = result.descricao_status || 'Alterações salvas com sucesso';
            // limpa destaques
            document.querySelectorAll('.edited').forEach(el => el.classList.remove('edited'));
            Object.keys(editedFields).forEach(k => delete editedFields[k]);
          }
  
          // feedback ao lado do botão
          const feedback = document.createElement('span');
          feedback.className   = 'status-msg';
          feedback.textContent = `descricao_status: ${msg}`;
          saveAllBtn.parentNode.insertBefore(feedback, saveAllBtn.nextSibling);
          setTimeout(() => feedback.remove(), 5000);
  
        } catch (err) {
          console.error('[SalvarTudo] erro', err);
          alert('Erro ao salvar todas as alterações');
        } finally {
          // reavalia visibilidade: só se há edits E nenhum btn “Concluído”
          const hasEdits   = Object.keys(editedFields).length > 0;
          const anyEditing = Array.from(
            document.querySelectorAll('.content-button.edit-button')
          ).some(b => b.textContent.trim() === 'Concluído');
  
          saveAllBtn.style.display = (hasEdits && !anyEditing)
            ? 'inline-block'
            : 'none';
        }
      });
    }
  
    // toda vez que chamamos, reavalia:
    const hasEdits   = Object.keys(editedFields).length > 0;
    const anyEditing = Array.from(
      document.querySelectorAll('.content-button.edit-button')
    ).some(b => b.textContent.trim() === 'Concluído');
  
    saveAllBtn.style.display = (hasEdits && !anyEditing)
      ? 'inline-block'
      : 'none';
  }
  
  


  export function attachEditor(li, f) {
    const btn = li.querySelector('.edit-button');
    let originalValue;
  
    btn.addEventListener('click', async () => {
      const statusOrInput = li.querySelector('.status-text, input.detail-input');
      const isEditing = btn.textContent.trim() === 'Editar';
  
      if (isEditing) {
        // entra em modo edição
        originalValue = statusOrInput.textContent.trim();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'detail-input';
        input.value = originalValue;
        statusOrInput.replaceWith(input);
        btn.textContent = 'Concluído';
        input.focus();
        if (saveAllBtn) saveAllBtn.style.display = 'none';
        return;
      }
  
      // conclui edição
      const input = li.querySelector('input.detail-input');
      const novoValor = input.value.trim();
  
      // sem mudança
      if (novoValor === originalValue) {
        const newDiv = document.createElement('div');
        newDiv.className = 'status-text';
        newDiv.textContent = originalValue;
        input.replaceWith(newDiv);
        btn.textContent = 'Editar';
        ensureSaveAllBtn();
        return;
      }
  
      // se for Estoque mínimo, chama AlterarEstoqueMinimo imediatamente
      if (f.key === 'estoque_minimo') {
        const newDiv = document.createElement('div');
        newDiv.className = 'status-text';
        newDiv.textContent = novoValor;
        input.replaceWith(newDiv);
        btn.textContent = 'Editar';
  
        try {
// dentro do if (f.key === 'estoque_minimo') { ... }
await fetch(`${API_BASE}/api/omie/estoque/ajuste/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    call:      'AlterarEstoqueMinimo',
    app_key:   OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      cod_int:  currentCodigo,
      quan_min: novoValor
    }]
  })
});
          // sucesso: limpa qualquer marcação de “editado”
          newDiv.classList.remove('edited');
        } catch (err) {
          console.error('✖ Falha ao alterar Estoque mínimo:', err);
          // sinaliza erro
          newDiv.classList.add('edited');
        }
  
        ensureSaveAllBtn();
        return;
      }
  
      // caso normal, marca para salvar tudo depois
      const newDiv = document.createElement('div');
      newDiv.className = 'status-text edited';
      newDiv.textContent = novoValor;
      input.replaceWith(newDiv);
      btn.textContent = 'Editar';
      editedFields[f.key] = novoValor;
      ensureSaveAllBtn();
    });
  }
/**
 * Anexa edição para Descrição Família, gravando código correto em editedFields
 */
export function attachSelectEditor(li, f, currentValue) {
    const btn = li.querySelector('.edit-button');
    let originalValue;  // vai guardar o nome antes da edição
  
    btn.addEventListener('click', async () => {
      const isEditing = btn.textContent.trim() === 'Editar';
  
      if (isEditing) {
        // === entra em modo edição e carrega lista ===
        const famRes = await fetch(`${API_BASE}/api/omie/familias`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call: 'PesquisarFamilias',
            param: [{ pagina:1, registros_por_pagina:50 }],
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET
          })
        });
        const { famCadastro = [] } = await famRes.json();
        familyCache = famCadastro;
  
        originalValue = currentValue;
  
        const select = document.createElement('select');
        select.className = 'detail-input';
        famCadastro.forEach(fam => {
          const opt = document.createElement('option');
          opt.value       = fam.nomeFamilia;
          opt.textContent = fam.nomeFamilia;
          if (fam.nomeFamilia === currentValue) opt.selected = true;
          select.appendChild(opt);
        });
  
        li.querySelector('.status-text').replaceWith(select);
        btn.textContent = 'Concluído';
        select.focus();
        if (saveAllBtn) saveAllBtn.style.display = 'none';
        return;
      }
  
      // === conclui edição ===
      const select  = li.querySelector('select.detail-input');
      const nomeSel = select.value;
  
      // se não mudou, volta ao normal sem marcar
      if (nomeSel === originalValue) {
        const newDiv = document.createElement('div');
        newDiv.className   = 'status-text';
        newDiv.textContent = originalValue;
        select.replaceWith(newDiv);
        btn.textContent = 'Editar';
        ensureSaveAllBtn();
        return;
      }
  
      // se mudou, captura código e marca editado
      const fam       = familyCache.find(x => x.nomeFamilia === nomeSel);
      const codigoFam = fam ? fam.codigo : null;
  
      const newDiv = document.createElement('div');
      newDiv.className   = 'status-text edited';
      newDiv.textContent = nomeSel;
      select.replaceWith(newDiv);
      btn.textContent = 'Editar';
  
      if (codigoFam != null) {
        editedFields['codigo_familia']    = codigoFam;
        editedFields['descricao_familia'] = nomeSel;
      }
  
      ensureSaveAllBtn();
    });
  }


  /**
 * Anexa edição para Tipo item baseado em csv/Tipo.csv
 */
export function attachTipoItemEditor(li, f, currentValue) {
    const btn = li.querySelector('.edit-button');
    let originalValue;
  
    btn.addEventListener('click', async () => {
      const isEditing = btn.textContent.trim() === 'Editar';
      if (isEditing) {
        // --- modo edição: carrega CSV e monta <select> ---
        if (!familyCache.tipoList) {
          const resp = await fetch('/csv/Tipo.csv');
          const text = await resp.text();
          const [, ...lines] = text.split(/\r?\n/);
          familyCache.tipoList = lines
            .filter(l => l.trim())
            .map(line => {
              const [grupo, descricao] = line.split(',');
              // padStart pra garantir dois dígitos
              const code = grupo.trim().padStart(2, '0');
              return { code, label: `${code}-${descricao.trim()}` };
            });
        }
        originalValue = currentValue;
  
        const select = document.createElement('select');
        select.className = 'detail-input';
        familyCache.tipoList.forEach(optData => {
          const opt = document.createElement('option');
          opt.value       = optData.code;
          opt.textContent = optData.label;
          if (optData.code === currentValue) opt.selected = true;
          select.appendChild(opt);
        });
  
        li.querySelector('.status-text').replaceWith(select);
        btn.textContent = 'Concluído';
        select.focus();
        if (saveAllBtn) saveAllBtn.style.display = 'none';
        return;
      }
  
      // --- modo concluído ---
      const select   = li.querySelector('select.detail-input');
      const newValue = select.value;
  
      // se não mudou, apenas reverte sem marcar
      if (newValue === originalValue) {
        const newDiv = document.createElement('div');
        newDiv.className   = 'status-text';
        newDiv.textContent = originalValue;
        select.replaceWith(newDiv);
        btn.textContent = 'Editar';
        ensureSaveAllBtn();
        return;
      }
  
      // se mudou, marca como editado
      const newDiv = document.createElement('div');
      newDiv.className   = 'status-text edited';
      newDiv.textContent = newValue;
      select.replaceWith(newDiv);
      btn.textContent     = 'Editar';
  
      editedFields[f.key] = newValue;
      ensureSaveAllBtn();
    });
  }

// Editor para campo booleano visivel_principal (salva apenas no Postgres)
export function attachVisivelPrincipalEditor(li, f, currentValue) {
  const btn = li.querySelector('.edit-button');
  let originalValue = (String(currentValue || '').trim().toUpperCase() === 'S') ? 'S' : 'N';

  btn.addEventListener('click', async () => {
    const isEditing = btn.textContent.trim() === 'Editar';
    const container = li.querySelector('.status-text') || li.querySelector('input.detail-input') || li.querySelector('select.detail-select');

    if (isEditing) {
      const select = document.createElement('select');
      select.className = 'detail-select';
      ['S','N'].forEach(val => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val === 'S' ? 'Sim' : 'Não';
        if (val === originalValue) opt.selected = true;
        select.appendChild(opt);
      });
      container.replaceWith(select);
      btn.textContent = 'Concluído';
      select.focus();
      if (saveAllBtn) saveAllBtn.style.display = 'none';
      return;
    }

    const select = li.querySelector('select.detail-select');
    const novoValor = select?.value || 'N';

    try {
      const resp = await fetch(`${API_BASE}/api/produtos/locais`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: currentCodigo, visivel_principal: novoValor })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const newDiv = document.createElement('div');
      newDiv.className = 'status-text';
      newDiv.textContent = novoValor === 'S' ? 'Sim' : 'Não';
      select.replaceWith(newDiv);
      btn.textContent = 'Editar';
      originalValue = novoValor;
    } catch (err) {
      console.error('✖ Falha ao salvar visivel_principal:', err);
      const newDiv = document.createElement('div');
      newDiv.className = 'status-text edited';
      newDiv.textContent = '(erro ao salvar)';
      select.replaceWith(newDiv);
      btn.textContent = 'Editar';
    }
    ensureSaveAllBtn();
  });
}

// Editor para campo tipo_compra (Automatica / Semiautomatica / Manual)
export function attachTipoCompraEditor(li, f, currentValue) {
  const btn = li.querySelector('.edit-button');
  const options = [
    { value: 'AUTOMATICA', label: 'Automática' },
    { value: 'SEMIAUTOMATICA', label: 'Semiautomática' },
    { value: 'MANUAL', label: 'Manual' }
  ];
  let originalValue = String(currentValue || '').trim().toUpperCase();

  btn.addEventListener('click', async () => {
    const isEditing = btn.textContent.trim() === 'Editar';
    const container = li.querySelector('.status-text') || li.querySelector('input.detail-input') || li.querySelector('select.detail-select');

    if (isEditing) {
      const select = document.createElement('select');
      select.className = 'detail-select';
      options.forEach(optCfg => {
        const opt = document.createElement('option');
        opt.value = optCfg.value;
        opt.textContent = optCfg.label;
        if (optCfg.value === originalValue) opt.selected = true;
        select.appendChild(opt);
      });
      container.replaceWith(select);
      btn.textContent = 'Concluído';
      select.focus();
      if (saveAllBtn) saveAllBtn.style.display = 'none';
      return;
    }

    const select = li.querySelector('select.detail-select');
    const novoValor = select?.value || '';

    try {
      const resp = await fetch(`${API_BASE}/api/produtos/locais`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: currentCodigo, tipo_compra: novoValor })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const chosen = options.find(o => o.value === novoValor);
      const newDiv = document.createElement('div');
      newDiv.className = 'status-text';
      newDiv.textContent = chosen?.label || novoValor || '';
      select.replaceWith(newDiv);
      btn.textContent = 'Editar';
      originalValue = novoValor;
    } catch (err) {
      console.error('✖ Falha ao salvar tipo_compra:', err);
      const newDiv = document.createElement('div');
      newDiv.className = 'status-text edited';
      newDiv.textContent = '(erro ao salvar)';
      select.replaceWith(newDiv);
      btn.textContent = 'Editar';
    }
    ensureSaveAllBtn();
  });
}

// Editor para campo preco_definido (salva apenas no Postgres)
export function attachPrecoDefinidoEditor(li, f, currentValue) {
  const btn = li.querySelector('.edit-button');
  let originalValue = currentValue ?? '';

  btn.addEventListener('click', async () => {
    const isEditing = btn.textContent.trim() === 'Editar';
    const container = li.querySelector('.status-text') || li.querySelector('input.detail-input') || li.querySelector('select.detail-select');

    if (isEditing) {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.className = 'detail-input';
      input.value = originalValue || '';
      container.replaceWith(input);
      btn.textContent = 'Concluído';
      input.focus();
      if (saveAllBtn) saveAllBtn.style.display = 'none';
      return;
    }

    const input = li.querySelector('input.detail-input');
    const novoValor = input?.value ?? '';
    const num = Number(String(novoValor).replace(',', '.'));
    const bodyVal = Number.isFinite(num) ? num : null;

    try {
      const resp = await fetch(`${API_BASE}/api/produtos/locais`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: currentCodigo, preco_definido: bodyVal })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const numVal = Number.isFinite(num) ? num : null;
      const newDiv = document.createElement('div');
      newDiv.className = 'status-text';
      newDiv.textContent = numVal != null
        ? numVal.toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
        : '';
      input.replaceWith(newDiv);
      btn.textContent = 'Editar';
      originalValue = numVal != null ? numVal : '';
    } catch (err) {
      console.error('✖ Falha ao salvar preco_definido:', err);
      const newDiv = document.createElement('div');
      newDiv.className = 'status-text edited';
      newDiv.textContent = '(erro ao salvar)';
      input.replaceWith(newDiv);
      btn.textContent = 'Editar';
    }
    ensureSaveAllBtn();
  });
}