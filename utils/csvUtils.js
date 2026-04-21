// utils/csvUtils.js
function flattenObject(obj, prefix = '') {
    let flattened = {};
    for (let key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        let trimmedKey = key.trim();
        let value = obj[key];
        let newKey = prefix ? `${prefix}_${trimmedKey}` : trimmedKey;
        if (value && typeof value === 'object') {
          if (Array.isArray(value)) {
            flattened[newKey] = JSON.stringify(value);
          } else {
            Object.assign(flattened, flattenObject(value, newKey));
          }
        } else {
          flattened[newKey] = value;
        }
      }
    }
    return flattened;
  }
  
  const fixedHeaders = [
    "codigo",
    "codigo_produto",
    "descr_detalhada",
    "descricao",
    "url_imagem"
  ];
  
  function convertToCSV(data) {
    const flattenedData = data.map(item => {
      const flat = flattenObject(item);
      if (flat.imagens) {
        try {
          let arr = JSON.parse(flat.imagens);
          if (Array.isArray(arr) && arr.length > 0 && arr[0].url_imagem) {
            flat.url_imagem = arr[0].url_imagem;
          } else {
            flat.url_imagem = '';
          }
        } catch (e) {
          console.error("Erro ao parsear o campo imagens:", e);
          flat.url_imagem = '';
        }
      } else {
        flat.url_imagem = '';
      }
      return flat;
    });
    
    const rows = flattenedData.map(item => {
      return fixedHeaders.map(header => {
        let val = item[header] !== undefined ? item[header] : '';
        if (typeof val === 'string' && val.includes(',')) {
          val = `"${val}"`;
        }
        return val;
      }).join(',');
    });
    
    return fixedHeaders.join(',') + '\n' + rows.join('\n');
  }
  
  module.exports = { flattenObject, convertToCSV };
  