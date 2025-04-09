// updateCSV.js
/*1. updateCSV.js
Contém a lógica para atualizar o CSV (a requisição para gerar o CSV e atualizar a página).*/
export async function updateCSV() {
    try {
      const hostname = window.location.hostname;
      const endpoint =
        (hostname === 'localhost' || hostname === '127.0.0.1')
          ? 'http://localhost:5001/api/produtos/generate-csv'
          : 'https://intranet-fromtherm.onrender.com/api/produtos/generate-csv';
      const response = await fetch(endpoint);
      const result = await response.json();
      if (result.success) {
        window.location.reload();
      } else {
        alert('Erro ao atualizar CSV.');
      }
    } catch (error) {
      console.error(error);
      alert('Erro ao atualizar CSV. Verifique o console.');
    }
  }
  