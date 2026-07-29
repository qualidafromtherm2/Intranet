const SAO_MIGUEL_CONTRATO = {
  numero: '136588/2026',
  referencia: '03/2026',
  emitido_em: '2026-03-17',
  vigencia_inicio: '2026-03-17',
  vigencia_fim: '2027-03-16',
  origem_cidade: 'Biguaçu',
  origem_uf: 'SC',
  origem_cep: 88164275,
  arquivo: 'TABELA EXPRESSO SAO MIGUEL.pdf',
  sha256: '129e37f10f66b4790a5117977957b072bfcba52b484831cf599b6b1e261c6e7a'
};

// Taxa = frete minimo; quilo = valor por kg; percentual_nf = ad valorem.
const SAO_MIGUEL_TARIFAS = [
  { uf: 'SP', regiao: 'SP1', siglas: 'EK/EL/FQ/ET', taxa: 65.57, quilo: 1.052, percentual_nf: 0.0045 },
  { uf: 'SP', regiao: 'SP3', siglas: 'GG/FX/FJ', taxa: 91.84, quilo: 1.471, percentual_nf: 0.0045 },
  { uf: 'SP', regiao: 'SP4', siglas: 'EJ/FR', taxa: 65.57, quilo: 1.052, percentual_nf: 0.0045 },
  { uf: 'PR', regiao: 'PR1', siglas: 'P/XX/Q/EV/R/EG/CV/EI/AW', taxa: 58.45, quilo: 0.944, percentual_nf: 0.0045 },
  { uf: 'PR', regiao: 'PR2', siglas: 'T/U/FA/BN/EB/DA/O', taxa: 64.48, quilo: 1.032, percentual_nf: 0.0045 },
  { uf: 'PR', regiao: 'PR3', siglas: 'CC/AS/EX/BX/AZ/DR', taxa: 60.94, quilo: 0.981, percentual_nf: 0.0045 },
  { uf: 'PR', regiao: 'PR4', siglas: 'EF/DZ/DO/CQ/DS/ED', taxa: 48.13, quilo: 0.784, percentual_nf: 0.0045 },
  { uf: 'PR', regiao: 'PR5', siglas: 'DD/FG/FK/CY/EN/CR', taxa: 55.42, quilo: 0.893, percentual_nf: 0.0045 },
  { uf: 'PR', regiao: 'PR6', siglas: 'FV/DU/FW/DV/BF/DY/DJ/DM/EC', taxa: 42.95, quilo: 0.713, percentual_nf: 0.0045 },
  { uf: 'SC', regiao: 'SC1', siglas: 'BI/G/H/I/BL/DQ/N/BR/DT/EW/BU/BZ/BA', taxa: 43.14, quilo: 0.713, percentual_nf: 0.0045 },
  { uf: 'SC', regiao: 'SC2', siglas: 'AR/CH/AG/V/AH/DK/FN/Y/DN/AL/L', taxa: 36.17, quilo: 0.605, percentual_nf: 0.0045 },
  { uf: 'SC', regiao: 'SC3', siglas: 'FF/DE/DI/FM/EP/DP/BO/BW/GB/EA/FC/CB', taxa: 27.80, quilo: 0.481, percentual_nf: 0.0045 },
  { uf: 'SC', regiao: 'SC4', siglas: 'EE/CD/BT/EY/BY/CA', taxa: 32.08, quilo: 0.535, percentual_nf: 0.0045 },
  { uf: 'SC', regiao: 'SC5', siglas: 'CS/DH/EZ', taxa: 29.58, quilo: 0.500, percentual_nf: 0.0045 },
  { uf: 'SC', regiao: 'SC6', siglas: 'EU/DF/DG/GE/DC/FE/GF', taxa: 29.58, quilo: 0.500, percentual_nf: 0.0045 },
  { uf: 'RS', regiao: 'RS1', siglas: 'A/GI/B/AT/CX/FL/CZ/CO/CP', taxa: 45.25, quilo: 0.748, percentual_nf: 0.0045 },
  { uf: 'RS', regiao: 'RS2', siglas: 'BS/FH/S/EH/DX/AF/X/EO', taxa: 43.47, quilo: 0.713, percentual_nf: 0.0045 },
  { uf: 'RS', regiao: 'RS3', siglas: 'C/CF/AE/D/E/BK/J/BP/AU/BV/CW/AV/AX/GC/GD', taxa: 42.60, quilo: 0.697, percentual_nf: 0.0045 },
  { uf: 'RS', regiao: 'RS4', siglas: 'AA/AB/AC/BH/W/AK/Z/GA/K/M/AO', taxa: 51.84, quilo: 0.837, percentual_nf: 0.0045 },
  { uf: 'RS', regiao: 'RS5', siglas: 'AD/CK/CL/AM/AN/FD', taxa: 51.15, quilo: 0.837, percentual_nf: 0.0045 },
  { uf: 'RS', regiao: 'RS6', siglas: 'AQ/BB/BC/BD/BE/BG/AY/BJ', taxa: 63.97, quilo: 1.032, percentual_nf: 0.0045 },
  { uf: 'RS', regiao: 'RS7', siglas: 'AI/AJ/BQ', taxa: 55.61, quilo: 0.893, percentual_nf: 0.0045 },
  { uf: 'RS', regiao: 'RS8', siglas: 'DL/CN/BM/FS/AP', taxa: 42.60, quilo: 0.697, percentual_nf: 0.0045 }
];

module.exports = { SAO_MIGUEL_CONTRATO, SAO_MIGUEL_TARIFAS };
