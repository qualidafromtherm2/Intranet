// routes/helpers/malhaEstrutura.js
const omieCall = require('../../utils/omieCall');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../../config.server');

async function consultaOmie(codigo) {
  const resultado = await omieCall(
    'https://app.omie.com.br/api/v1/geral/malha/',
    {
      call      : 'ConsultarEstrutura',
      app_key   : OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param     : [{ intProduto: codigo }]
    }
  );
  return resultado;                     // devolve JSON bruto (ident, itens …)
}

module.exports = async (cod) => {
  try {
    return await consultaOmie(cod);
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('Client-103') || msg.includes('Produto não encontrado')) {
      return null;                      // produto sem estrutura
    }
    throw e;
  }
};
