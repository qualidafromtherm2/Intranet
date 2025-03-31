// editCard.js
import { getTextOfField } from './utils.js';
import { collectCharacteristicsEdits } from './editCharacteristics.js';

export function collectEditsFromCard(cardClone) {
  let caracteristicas = collectCharacteristicsEdits(cardClone);
  const codigoH2 = cardClone.querySelector('.card-info h2');
  const codigo = codigoH2 ? codigoH2.innerText.trim() : '';

  const descricao = getTextOfField(cardClone, 'Descrição:');
  const descrDetalhada = getTextOfField(cardClone, 'Descrição detalhada:');
  const unidade = getTextOfField(cardClone, 'Unidade:');
  const ncm = getTextOfField(cardClone, 'NCM:');
  const ean = getTextOfField(cardClone, 'EAN:');
  const valor = getTextOfField(cardClone, 'Valor Unitário:');
  const tipoItem = getTextOfField(cardClone, 'Tipo Item:');
  const familia = getTextOfField(cardClone, 'Descrição da família:');
  const estoque = getTextOfField(cardClone, 'Quantidade no estoque:');
  const bloqueado = getTextOfField(cardClone, 'Bloqueado:');
  const inativo = getTextOfField(cardClone, 'Inativo:');

  return {
    codigo,
    descricao,
    descr_detalhada: descrDetalhada,
    unidade,
    ncm,
    ean,
    valor_unitario: parseFloat(valor) || 0,
    tipoItem,
    descricao_familia: familia,
    quantidade_estoque: parseFloat(estoque) || 0,
    bloqueado: (bloqueado === 'S' ? 'S' : 'N'),
    inativo: (inativo === 'S' ? 'S' : 'N'),
    caracteristicas: caracteristicas
  };
}
