

// utils.js
export async function fetchCaracteristicas() {
    try {
      const response = await fetch('/api/caracteristicas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error('Erro ao buscar características');
      }
      const data = await response.json();
      // Verifica as propriedades para retornar a lista
      if (data.listaCaracteristicas) {
        return data.listaCaracteristicas;
      } else if (data.caracteristicas) {
        return data.caracteristicas;
      } else if (Array.isArray(data)) {
        return data;
      } else {
        return [];
      }
    } catch (error) {
      console.error(error);
      return [];
    }
  }
  

  // utils.js
export async function loadTipoCSV() {
  try {
    const response = await fetch('./Tipo.csv'); // Ajuste o caminho se necessário
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      trim: true
    });
    if (parsed.errors.length) return [];
    return parsed.data;
  } catch (error) {
    console.error('Erro ao carregar CSV de tipos:', error);
    return [];
  }
}
  
  
  



export function getTextOfField(cardClone, label) {
  const allPs = cardClone.querySelectorAll('.card-info p');
  for (const p of allPs) {
    const text = p.innerText.trim();
    if (text.startsWith(label)) {
      let fieldValue = text.slice(label.length).trim();
      if (label === "Unidade:" && fieldValue.includes('\n')) {
        fieldValue = fieldValue.split('\n')[0].trim();
      }
      return fieldValue;
    }
  }
  return '';
}

export async function loadCSV() {
  try {
    const response = await fetch('./produtos.csv');
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      trim: true
    });
    if (parsed.errors.length) return [];
    return parsed.data;
  } catch (error) {
    console.error('Erro ao carregar CSV:', error);
    return [];
  }
}

export function searchInCSV(produtos, term) {
  const tokens = term.toLowerCase().split(/\s+/);
  return produtos.filter(produto => {
    const campos = [
      produto.codigo || "",
      produto.codigo_produto || "",
      produto.descr_detalhada || "",
      produto.descricao || ""
    ].map(c => c.toLowerCase());
    return tokens.every(token => campos.some(campo => campo.includes(token)));
  });
}

export async function fetchPosicaoEstoque(codigo, dataRef) {
  try {
    const response = await fetch('/api/produtos/estoque', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, data: dataRef })
    });
    if (!response.ok) {
      throw new Error('Erro ao consultar posição de estoque');
    }
    return await response.json();
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function fetchDetalhes(codigo) {
  try {
    const response = await fetch(`/api/produtos/detalhes/${encodeURIComponent(codigo)}`);
    if (!response.ok) {
      throw new Error('Erro ao consultar detalhes do produto');
    }
    const data = await response.json();
    return data;
  } catch (err) {
    console.error(err);
    return null;
  }
}
