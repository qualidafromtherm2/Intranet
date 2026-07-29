const FONTE_EJL_PRACAS = 'https://expressoejl.com.br/relacao-de-pracas/';
const FONTE_EJL_PRACAS_CONSULTADA_EM = '2026-07-29';

// A pagina oficial define cobertura. A planilha comercial continua sendo a
// fonte exclusiva dos valores e das formulas de cada regiao tarifaria.
const EJL_PRACAS_OFICIAIS = [
  {
    grupo: 'sao-paulo', uf: 'SP', regiaoTarifaria: 'SAO PAULO', cidades: [
      'Arujá', 'Barueri', 'Carapicuíba', 'Cotia', 'Diadema', 'Embu das Artes',
      'Embu-Guaçu', 'Ferraz de Vasconcelos', 'Guarulhos', 'Itapecerica da Serra',
      'Itapevi', 'Itaquaquecetuba', 'Jandira', 'Mairiporã', 'Mauá',
      'Mogi das Cruzes', 'Osasco', 'Poá', 'Ribeirão Pires', 'Santana de Parnaíba',
      'Santo André', 'São Bernardo do Campo', 'São Caetano do Sul', 'São Paulo',
      'Suzano', 'Taboão da Serra'
    ]
  },
  {
    grupo: 'sao-jose-dos-campos', uf: 'SP', regiaoTarifaria: 'SAO PAULO', cidades: [
      'Aparecida', 'Caçapava', 'Cachoeira Paulista', 'Campos do Jordão', 'Canas',
      'Caraguatatuba', 'Cruzeiro', 'Cunha', 'Guaratinguetá', 'Igaratá', 'Ilhabela',
      'Jacareí', 'Jambeiro', 'Lagoinha', 'Lavrinhas', 'Lorena', 'Monteiro Lobato',
      'Natividade da Serra', 'Paraibuna', 'Pindamonhangaba', 'Piquete', 'Potim',
      'Redenção da Serra', 'Roseira', 'Santa Branca', 'Santo Antônio do Pinhal',
      'São Bento do Sapucaí', 'São José dos Campos', 'São Luiz do Paraitinga',
      'São Sebastião', 'Silveiras', 'Taubaté', 'Tremembé', 'Ubatuba'
    ]
  },
  {
    grupo: 'campinas', uf: 'SP', regiaoTarifaria: 'SAO PAULO', cidades: [
      'Americana', 'Araçariguama', 'Atibaia', 'Bragança Paulista', 'Cabreúva',
      'Caieiras', 'Cajamar', 'Campinas', 'Francisco Morato', 'Franco da Rocha',
      'Hortolândia', 'Indaiatuba', 'Iracemápolis', 'Itapira', 'Itatiba', 'Itu',
      'Itupeva', 'Jarinu', 'Jundiaí', 'Limeira', 'Louveira', 'Nova Odessa',
      'Paulínia', 'Salto', 'Santa Bárbara do Oeste', 'Sorocaba', 'Sumaré',
      'Valinhos', 'Várzea Paulista', 'Vinhedo', 'Votorantim'
    ]
  },
  {
    grupo: 'florianopolis', uf: 'SC', regiaoTarifaria: 'FLORIANOPOLIS', cidades: [
      'Águas Mornas', 'Angelina', 'Anitápolis', 'Antônio Carlos', 'Biguaçu',
      'Canelinha', 'Florianópolis', 'Governador Celso Ramos', 'Major Gercino',
      'Nova Trento', 'Palhoça', 'Rancho Queimado', 'Santo Amaro da Imperatriz',
      'São Bonifácio', 'São João Batista', 'São José', 'São Pedro de Alcântara',
      'Tijucas'
    ]
  },
  {
    grupo: 'joinville', uf: 'SC', regiaoTarifaria: 'JOINVILLE', cidades: [
      'Araquari', 'Balneário Barra do Sul', 'Garuvá', 'Itapoá', 'Joinville',
      'São Francisco do Sul', 'Corupá', 'Guaramirim', 'Jaraguá do Sul',
      'Massaranduba', 'Schroeder'
    ]
  },
  {
    grupo: 'criciuma', uf: 'SC', regiaoTarifaria: 'CRICIUMA', cidades: [
      'Araranguá', 'Balneário Arroio do Silva', 'Balneário Gaivota', 'Cocal do Sul',
      'Criciúma', 'Ermo', 'Forquilhinha', 'Içara', 'Jacinto Machado', 'Lauro Müller',
      'Maracajá', 'Meleiro', 'Morro da Fumaça', 'Morro Grande', 'Nova Veneza',
      'Orleans', 'Passos de Torres', 'Praia Grande', 'Santa Rosa do Sul',
      'São João do Sul', 'Siderópolis', 'Sombrio', 'Timbé do Sul', 'Treviso',
      'Turvo', 'Urussanga'
    ]
  },
  {
    grupo: 'itajai', uf: 'SC', regiaoTarifaria: 'ITAJAI', cidades: [
      'Balneário Camboriú', 'Balneário Piçarras', 'Barra Velha', 'Bombinhas',
      'Camboriú', 'Ilhota', 'Itajaí', 'Itapema', 'Luiz Alves', 'Navegantes',
      'Penha', 'Porto Belo', 'São João do Itaperiú'
    ]
  },
  {
    grupo: 'tubarao', uf: 'SC', regiaoTarifaria: 'TUBARAO', cidades: [
      'Armazém', 'Braço do Norte', 'Capivari de Baixo', 'Garopaba', 'Grão-Pará',
      'Gravatal', 'Imaruí', 'Imbituba', 'Jaguaruna', 'Laguna', 'Paulo Lopes',
      'Pedras Grandes', 'Pescaria Brava', 'Rio Fortuna', 'Sangão',
      'Santa Rosa de Lima', 'São Ludgero', 'São Martinho', 'Treze de Maio', 'Tubarão'
    ]
  },
  {
    grupo: 'blumenau', uf: 'SC', regiaoTarifaria: 'BLUMENAU', cidades: [
      'Blumenau', 'Botuverá', 'Brusque', 'Gaspar', 'Guabiruba', 'Apiúna', 'Ascurra',
      'Benedito Novo', 'Doutor Pedrinho', 'Indaial', 'Pomerode', 'Rio dos Cedros',
      'Rodeio', 'Timbó'
    ]
  },
  {
    grupo: 'bahia', uf: 'BA', regiaoTarifaria: null, coberturaUfCompleta: true, cidades: [
      'Salvador', 'Feira de Santana', 'Barreiras', 'Brumado', 'Correntina',
      'Cruz das Almas', 'Euclides da Cunha', 'Eunápolis', 'Guanambi', 'Irecê',
      'Itaberaba', 'Itabuna', 'Jacobina', 'Jequié', 'Juazeiro',
      'Luís Eduardo Magalhães', 'Paulo Afonso', 'Porto Seguro',
      'Presidente Tancredo Neves', 'Santo Antônio de Jesus', 'Seabra',
      'Senhor do Bonfim', 'Teixeira de Freitas', 'Valença', 'Vitória da Conquista'
    ]
  },
  {
    grupo: 'curitiba', uf: 'PR', regiaoTarifaria: 'CURITIBA', cidades: [
      'Adrianópolis', 'Agudos do Sul', 'Almirante Tamandaré', 'Araucária',
      'Balsa Nova', 'Bocaiúva do Sul', 'Campina Grande do Sul', 'Campo do Tenente',
      'Campo Largo', 'Campo Magro', 'Cerro Azul', 'Colombo', 'Contenda', 'Curitiba',
      'Doutor Ulysses', 'Fazenda Rio Grande', 'Lapa', 'Mandirituba', 'Piên', 'Pinhais',
      'Piraquara', 'Quatro Barras', 'Quitandinha', 'Rio Branco do Sul',
      "São Jorge d'Oeste", 'São José dos Pinhais', 'Tijucas do Sul'
    ]
  }
];

module.exports = {
  EJL_PRACAS_OFICIAIS,
  FONTE_EJL_PRACAS,
  FONTE_EJL_PRACAS_CONSULTADA_EM
};
