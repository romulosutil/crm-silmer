// GERADO por scripts/import-order-catalog.mjs a partir de 005-lista-de-opcoes-para-aprovacao.xlsx.
// Não editar: mude a planilha e rode `npm run catalog:import -- --from <arquivo.xlsx>`.

/** @type {import('./types.js').OrderCatalog} */
export default {
  schemaVersion: 1,
  source: {
    file: '005-lista-de-opcoes-para-aprovacao.xlsx',
    sha256: '1606d0b75361a3b36b6147bc74256901c4b797690048c0aae7f619eb5a341afe',
  },
  products: [
    {
      id: 'camiseta',
      label: 'Camiseta',
      print: 'CAMISETA',
      family: 'Vestuário superior',
      scales: ['adulto', 'infantil', 'plus-size', 'bebe'],
      fields: {
        modelagem: {
          rule: 'required',
        },
        gola: {
          rule: 'required',
        },
        manga: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        cor_manga_direita: {
          rule: 'required',
        },
        cor_manga_esquerda: {
          rule: 'required',
        },
        vies_gola: {
          rule: 'required',
        },
        vies_mangas: {
          rule: 'optional',
        },
        bolso: {
          rule: 'optional',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'camisa-polo',
      label: 'Camisa polo',
      print: 'CAMISA POLO',
      family: 'Vestuário superior',
      scales: ['adulto', 'infantil', 'plus-size'],
      fields: {
        modelagem: {
          rule: 'required',
        },
        gola: {
          rule: 'required',
        },
        manga: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        cor_manga_direita: {
          rule: 'required',
        },
        cor_manga_esquerda: {
          rule: 'required',
        },
        vies_gola: {
          rule: 'required',
          label: 'Gola/punho (ribana)',
        },
        vies_mangas: {
          rule: 'optional',
        },
        abertura: {
          rule: 'required',
        },
        bolso: {
          rule: 'optional',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'camisa-esportiva',
      label: 'Camisa esportiva',
      print: 'CAMISA ESPORTIVA',
      family: 'Vestuário superior',
      scales: ['adulto', 'infantil', 'plus-size'],
      fields: {
        modelagem: {
          rule: 'required',
        },
        gola: {
          rule: 'required',
        },
        manga: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        cor_manga_direita: {
          rule: 'required',
        },
        cor_manga_esquerda: {
          rule: 'required',
        },
        vies_gola: {
          rule: 'required',
        },
        vies_mangas: {
          rule: 'optional',
        },
        bolso: {
          rule: 'optional',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'regata-tradicional',
      label: 'Regata tradicional',
      print: 'REGATA TRADICIONAL',
      family: 'Vestuário superior',
      scales: ['adulto', 'infantil', 'plus-size'],
      fields: {
        modelagem: {
          rule: 'required',
        },
        gola: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        vies_gola: {
          rule: 'required',
        },
        vies_mangas: {
          rule: 'required',
          label: 'Viés cavas',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'regata',
      label: 'Regata',
      print: 'REGATA',
      family: 'Vestuário superior',
      scales: ['adulto', 'infantil', 'plus-size'],
      fields: {
        modelagem: {
          rule: 'required',
        },
        gola: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        vies_gola: {
          rule: 'required',
        },
        vies_mangas: {
          rule: 'required',
          label: 'Viés cavas',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'abada',
      label: 'Abadá',
      print: 'ABADÁ',
      family: 'Vestuário superior',
      scales: ['adulto'],
      fields: {
        modelagem: {
          rule: 'optional',
        },
        gola: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        vies_gola: {
          rule: 'optional',
        },
        vies_mangas: {
          rule: 'optional',
          label: 'Viés cavas',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'baby-look',
      label: 'Baby look',
      print: 'BABY LOOK',
      family: 'Vestuário superior',
      scales: ['adulto', 'plus-size'],
      fields: {
        modelagem: {
          rule: 'required',
        },
        gola: {
          rule: 'required',
        },
        manga: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        cor_manga_direita: {
          rule: 'required',
        },
        cor_manga_esquerda: {
          rule: 'required',
        },
        vies_gola: {
          rule: 'required',
        },
        vies_mangas: {
          rule: 'optional',
        },
        bolso: {
          rule: 'optional',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'camiseta-de-manga-longa',
      label: 'Camiseta de manga longa',
      print: 'CAMISETA MANGA LONGA',
      family: 'Vestuário superior',
      scales: ['adulto', 'infantil', 'plus-size'],
      fields: {
        modelagem: {
          rule: 'required',
        },
        gola: {
          rule: 'required',
        },
        manga: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        cor_manga_direita: {
          rule: 'required',
        },
        cor_manga_esquerda: {
          rule: 'required',
        },
        vies_gola: {
          rule: 'required',
        },
        vies_mangas: {
          rule: 'optional',
        },
        bolso: {
          rule: 'optional',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'colete',
      label: 'Colete',
      print: 'COLETE',
      family: 'Profissional',
      scales: ['adulto', 'plus-size'],
      fields: {
        modelagem: {
          rule: 'optional',
        },
        gola: {
          rule: 'optional',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        vies_gola: {
          rule: 'optional',
        },
        vies_mangas: {
          rule: 'optional',
          label: 'Viés cavas',
        },
        abertura: {
          rule: 'required',
        },
        bolso: {
          rule: 'optional',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'avental',
      label: 'Avental',
      print: 'AVENTAL',
      family: 'Profissional',
      scales: [],
      fields: {
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
          label: 'Cor do corpo',
        },
        vies_mangas: {
          rule: 'optional',
          label: 'Viés borda',
        },
        bolso: {
          rule: 'optional',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'bermuda',
      label: 'Bermuda',
      print: 'BERMUDA',
      family: 'Vestuário inferior',
      scales: ['adulto', 'infantil', 'plus-size'],
      fields: {
        modelagem: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        vies_mangas: {
          rule: 'optional',
          label: 'Viés barra/lateral',
        },
        bolso: {
          rule: 'optional',
        },
        cos: {
          rule: 'required',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'calca',
      label: 'Calça',
      print: 'CALÇA',
      family: 'Vestuário inferior',
      scales: ['adulto', 'infantil', 'plus-size'],
      fields: {
        modelagem: {
          rule: 'required',
        },
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
        },
        cor_costas: {
          rule: 'required',
        },
        vies_mangas: {
          rule: 'optional',
          label: 'Viés barra/lateral',
        },
        abertura: {
          rule: 'optional',
        },
        bolso: {
          rule: 'optional',
        },
        cos: {
          rule: 'required',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'bone',
      label: 'Boné',
      print: 'BONÉ',
      family: 'Acessório',
      scales: ['infantil'],
      fields: {
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
          label: 'Painel frontal',
        },
        cor_costas: {
          rule: 'required',
          label: 'Copa/tela',
        },
        abertura: {
          rule: 'required',
          label: 'Regulagem',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
    {
      id: 'ecobag-sacola',
      label: 'Ecobag/sacola',
      print: 'ECOBAG',
      family: 'Acessório',
      scales: [],
      fields: {
        malha: {
          rule: 'required',
        },
        cor_frente: {
          rule: 'required',
          label: 'Cor do corpo',
        },
        cor_costas: {
          rule: 'optional',
          label: 'Cor do verso',
        },
        abertura: {
          rule: 'optional',
        },
        bolso: {
          rule: 'optional',
        },
        locais: {
          rule: 'optional',
        },
      },
    },
  ],
  lists: {
    modelagens: [
      {
        value: 'TRADICIONAL',
        label: 'Tradicional/unissex',
        group: 'Modelagem',
        products: [],
      },
      {
        value: 'FEMININA',
        label: 'Feminina acinturada/baby look',
        group: 'Modelagem',
        products: [],
      },
      {
        value: 'INFANTIL',
        label: 'Infantil',
        group: 'Modelagem',
        products: [],
      },
      {
        value: 'PLUS SIZE',
        label: 'Plus size',
        group: 'Modelagem',
        products: [],
      },
      {
        value: 'ESPORTIVA',
        label: 'Esportiva',
        group: 'Modelagem',
        products: [],
      },
    ],
    golas: [
      {
        value: 'CARECA',
        label: 'Careca/redonda',
        group: 'Gola/decote',
        products: [],
      },
      {
        value: 'GOLA V',
        label: 'Gola V',
        group: 'Gola/decote',
        products: [],
      },
      {
        value: 'GOLA POLO',
        label: 'Gola polo',
        group: 'Gola/decote',
        products: ['camisa-polo'],
      },
      {
        value: 'OLÍMPICA',
        label: 'Gola olímpica',
        group: '',
        products: [],
        note: 'Confirmar o significado usado pela Silmer.',
      },
    ],
    mangas: [
      {
        value: 'CURTA',
        label: 'Curta',
        group: 'Manga',
        products: [],
      },
      {
        value: 'LONGA',
        label: 'Longa',
        group: 'Manga',
        products: [],
      },
      {
        value: 'RAGLAN CURTA',
        label: 'Raglan curta',
        group: 'Manga',
        products: [],
      },
      {
        value: 'RAGLAN LONGA',
        label: 'Raglan longa',
        group: 'Manga',
        products: [],
      },
      {
        value: 'COM PUNHO',
        label: 'Com punho',
        group: 'Manga',
        products: [],
      },
    ],
    malhas: [
      {
        value: 'PP LISO',
        label: 'PP/poliéster liso',
        group: 'Algodão e mistos leves',
        products: [],
      },
      {
        value: 'PP DRY',
        label: 'PP/poliéster dry',
        group: 'Algodão e mistos leves',
        products: [],
      },
      {
        value: 'PP MESCLA',
        label: 'PP/poliéster mescla',
        group: 'Algodão e mistos leves',
        products: [],
      },
    ],
    cores: [
      {
        value: 'BRANCO',
        label: 'Branco',
        group: 'Neutros',
        products: [],
        swatch: '#ffffff',
      },
      {
        value: 'OFF WHITE',
        label: 'Off-white/natural',
        group: 'Neutros',
        products: [],
        swatch: '#f3eee1',
      },
      {
        value: 'PRETO',
        label: 'Preto',
        group: 'Neutros',
        products: [],
        swatch: '#17151c',
      },
      {
        value: 'CINZA CLARO',
        label: 'Cinza claro',
        group: 'Neutros',
        products: [],
        swatch: '#c9c8cf',
      },
      {
        value: 'CINZA MESCLA',
        label: 'Cinza mescla',
        group: 'Neutros',
        products: [],
        swatch: '#9a98a0',
      },
      {
        value: 'GRAFITE',
        label: 'Grafite/chumbo',
        group: 'Neutros',
        products: [],
        swatch: '#4a4952',
      },
      {
        value: 'AZUL MARINHO',
        label: 'Azul-marinho',
        group: 'Azuis',
        products: [],
        swatch: '#1f2a5a',
      },
      {
        value: 'AZUL ROYAL',
        label: 'Azul royal',
        group: 'Azuis',
        products: [],
        swatch: '#1d4fd8',
      },
      {
        value: 'AZUL CELESTE',
        label: 'Azul-celeste',
        group: 'Azuis',
        products: [],
        swatch: '#7cc4f0',
      },
      {
        value: 'AZUL TURQUESA',
        label: 'Azul-turquesa',
        group: 'Azuis',
        products: [],
        swatch: '#1bb5b5',
      },
      {
        value: 'AZUL PETRÓLEO',
        label: 'Azul-petróleo',
        group: 'Azuis',
        products: [],
        swatch: '#1d5566',
      },
      {
        value: 'VERDE BANDEIRA',
        label: 'Verde-bandeira',
        group: 'Verdes',
        products: [],
        swatch: '#0f7a3a',
      },
      {
        value: 'VERDE MILITAR',
        label: 'Verde-militar/musgo',
        group: 'Verdes',
        products: [],
        swatch: '#4f5a2e',
      },
      {
        value: 'VERDE LIMÃO',
        label: 'Verde-limão',
        group: 'Verdes',
        products: [],
        swatch: '#9fd11f',
      },
      {
        value: 'AMARELO',
        label: 'Amarelo',
        group: 'Amarelos',
        products: [],
        swatch: '#f5c400',
      },
      {
        value: 'AMARELO OURO',
        label: 'Amarelo-ouro',
        group: 'Amarelos',
        products: [],
        swatch: '#d9a400',
      },
      {
        value: 'LARANJA',
        label: 'Laranja',
        group: 'Laranjas',
        products: [],
        swatch: '#ff6a13',
      },
      {
        value: 'CORAL',
        label: 'Coral',
        group: 'Laranjas',
        products: [],
        swatch: '#ff7f6a',
      },
      {
        value: 'VERMELHO',
        label: 'Vermelho',
        group: 'Vermelhos',
        products: [],
        swatch: '#c8102e',
      },
      {
        value: 'VINHO',
        label: 'Vinho/bordô',
        group: 'Vermelhos',
        products: [],
        swatch: '#6d1a2c',
      },
      {
        value: 'ROSA CLARO',
        label: 'Rosa-claro',
        group: 'Rosas',
        products: [],
        swatch: '#f6c1d0',
      },
      {
        value: 'ROSA',
        label: 'Rosa',
        group: 'Rosas',
        products: [],
        swatch: '#ec7fa9',
      },
      {
        value: 'PINK',
        label: 'Pink/magenta',
        group: 'Rosas',
        products: [],
        swatch: '#d6197a',
      },
      {
        value: 'ROXO',
        label: 'Roxo',
        group: 'Roxos',
        products: [],
        swatch: '#5b2a8c',
      },
      {
        value: 'LILÁS',
        label: 'Lilás',
        group: 'Roxos',
        products: [],
        swatch: '#b79ad8',
      },
      {
        value: 'BEGE',
        label: 'Bege',
        group: 'Terrosos',
        products: [],
        swatch: '#d8c3a0',
      },
      {
        value: 'CÁQUI',
        label: 'Cáqui',
        group: 'Terrosos',
        products: [],
        swatch: '#b0a178',
      },
      {
        value: 'CARAMELO',
        label: 'Caramelo',
        group: 'Terrosos',
        products: [],
        swatch: '#b06a2a',
      },
      {
        value: 'MARROM',
        label: 'Marrom',
        group: 'Terrosos',
        products: [],
        swatch: '#5c3a21',
      },
      {
        value: 'NEON',
        label: 'Neon',
        group: 'Especiais',
        products: [],
      },
      {
        value: 'FLUORESCENTE',
        label: 'Fluorescente',
        group: 'Especiais',
        products: [],
      },
      {
        value: 'MESCLA',
        label: 'Mescla',
        group: 'Especiais',
        products: [],
      },
      {
        value: 'ESTAMPADO',
        label: 'Estampado',
        group: 'Especiais',
        products: [],
      },
    ],
    acabamentos: [
      {
        value: 'PRÓPRIO TECIDO',
        label: 'Próprio tecido',
        group: 'Tipo',
        products: [],
      },
      {
        value: 'VIÉS PRÓPRIO TECIDO',
        label: 'Viés do próprio tecido',
        group: 'Tipo',
        products: [],
      },
      {
        value: 'RIBANA',
        label: 'Ribana',
        group: 'Tipo',
        products: [],
      },
    ],
    aberturas: [],
    bolsos: [],
    cos: [],
    faces: [],
    fixacoes: [],
    locais: [
      {
        value: 'BOLSO',
        label: 'Bolso',
        group: 'Frente',
        products: [],
      },
      {
        value: 'COSTAS TOTAL',
        label: 'Total',
        group: 'Costas',
        products: [],
      },
      {
        value: 'COSTAS CENTRO',
        label: 'Centro',
        group: 'Costas',
        products: [],
      },
      {
        value: 'COSTAS BARRA',
        label: 'Inferior/barra',
        group: 'Costas',
        products: [],
      },
      {
        value: 'MANGA DIREITA',
        label: 'Direita',
        group: 'Mangas',
        products: [],
      },
      {
        value: 'MANGA ESQUERDA',
        label: 'Esquerda',
        group: 'Mangas',
        products: [],
      },
      {
        value: 'MANGAS',
        label: 'Ambas',
        group: 'Mangas',
        products: [],
      },
      {
        value: 'OMBRO DIREITO',
        label: 'Ombro direito',
        group: 'Mangas',
        products: [],
      },
      {
        value: 'OMBRO ESQUERDO',
        label: 'Ombro esquerdo',
        group: 'Mangas',
        products: [],
      },
    ],
  },
  scales: [
    {
      id: 'bebe',
      label: 'Bebê',
      sizes: ['GG'],
      freeText: false,
    },
    {
      id: 'infantil',
      label: 'Infantil',
      sizes: ['PP', 'P', 'M', 'G', 'GG'],
      freeText: false,
    },
    {
      id: 'adulto',
      label: 'Adulto',
      sizes: ['PP', 'P', 'M', 'G', 'GG', 'EG', 'XG'],
      freeText: false,
    },
    {
      id: 'plus-size',
      label: 'Plus size',
      sizes: ['XX', 'JEGÃO'],
      freeText: false,
    },
  ],
  applications: [
    {
      value: 'SUBLIMAÇÃO TOTAL',
      label: 'Sublimação total/full print',
      group: 'Sublimação',
      products: [],
    },
    {
      value: 'SUBLIMAÇÃO LOCALIZADA',
      label: 'Sublimação localizada',
      group: 'Sublimação',
      products: [],
    },
    {
      value: 'SERIGRAFIA',
      label: 'Serigrafia/silk screen',
      group: 'Impressão',
      products: [],
    },
    {
      value: 'DTF',
      label: 'DTF — direto no filme',
      group: 'Impressão',
      products: [],
    },
    {
      value: 'DTG',
      label: 'DTG/silk digital — direto na peça',
      group: 'Impressão',
      products: [],
    },
    {
      value: 'BORDADO DIRETO',
      label: 'Bordado direto',
      group: 'Bordado/aplique',
      products: [],
    },
    {
      value: 'REFLETIVO',
      label: 'Refletivo',
      group: 'Efeito especial',
      products: [],
    },
  ],
};
