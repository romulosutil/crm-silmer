/**
 * The option catalog Silmer is validating in "Validação do catálogo de opções
 * do Pedido" (Google Sheets, 2026-09). Every entry is a suggestion offered in
 * the ficha fields, never a constraint: the fields stay free text so a value
 * the catalog does not know yet is still typed and saved as it is.
 *
 * Only options not marked "Remover" are listed. When the sheet is approved,
 * this file is the one place to update.
 */

export const PIECE_TYPES = Object.freeze([
  'Camiseta',
  'Camisa casual',
  'Camisa polo',
  'Camisa esportiva',
  'Regata tradicional',
  'Regata',
  'Abadá',
  'Baby look',
  'Camiseta de manga longa',
  'Moletom sem capuz',
  'Moletom com capuz',
  'Moletom canguru',
  'Jaqueta/agasalho',
  'Colete',
  'Jaleco',
  'Avental',
  'Short',
  'Bermuda',
  'Calça',
  'Boné',
  'Ecobag/sacola',
  'Kit/conjunto de duas peças',
]);

export const MODELINGS = Object.freeze([
  'Tradicional/unissex',
  'Masculina reta',
  'Feminina acinturada/baby look',
  'Slim',
  'Oversized',
  'Infantil',
  'Plus size',
  'Esportiva',
]);

export const FABRICS = Object.freeze([
  'PP/poliéster liso',
  'PP/poliéster dry',
  'PP/poliéster mescla',
  'Dry fit liso de poliéster',
  'Dry fit ponto de arroz/favinho',
  'Dry fit colmeia',
  'Dry fit furadinho',
  'Dry fit light',
  'Dry fit mescla',
  'Dry/performance de poliamida',
  'Helanca light',
  'Helanca colegial',
  'Helanca peluciada',
  'Helanca dry',
  'Helanquinha',
  'Meia malha de algodão cardada',
  'Meia malha de algodão penteada 24.1',
  'Meia malha de algodão penteada 30.1',
  'Meia malha de algodão com elastano',
  'Cotton — algodão com elastano',
  'PV liso anti-pilling',
  'PV mescla anti-pilling',
  'PV com elastano',
  'Poliéster/algodão',
  'Piquet de algodão',
  'Piquet PV',
  'Piquet poliéster/algodão',
  'Piquet de poliéster',
  'Piquet com elastano',
  'Piquet anti-pilling',
  'Cacharrel',
  'Interlock de algodão',
  'Interlock de poliéster',
  'Interlock misto',
  'Liganete',
  'Viscolycra',
  'Suplex de poliamida com elastano',
  'Suplex de poliéster com elastano',
  'Microfibra',
  'Tactel',
  'Oxford',
  'Oxfordine',
  'Moletom 2 cabos com felpa',
  'Moletom 2 cabos sem felpa',
  'Moletom 3 cabos com felpa',
  'Moletom 3 cabos sem felpa',
  'Moletinho de algodão',
  'Moletinho PV',
  'Moletinho com elastano',
  'Fleece/soft',
  'Plush',
]);

/**
 * `swatch` is an approximation for the screen only, so the seller sees at a
 * glance which colour the text names. It never reaches the printed ficha.
 */
export const COLORS = Object.freeze(
  [
    ['Branco', '#ffffff'],
    ['Off-white/natural', '#f3eee1'],
    ['Preto', '#17151c'],
    ['Cinza claro', '#c9c8cf'],
    ['Cinza mescla', '#9a98a0'],
    ['Grafite/chumbo', '#4a4952'],
    ['Azul-marinho', '#1f2a5a'],
    ['Azul royal', '#1d4fd8'],
    ['Azul-celeste', '#7cc4f0'],
    ['Azul-turquesa', '#1bb5b5'],
    ['Azul-petróleo', '#1d5566'],
    ['Verde-bandeira', '#0f7a3a'],
    ['Verde-militar/musgo', '#4f5a2e'],
    ['Verde-limão', '#9fd11f'],
    ['Verde-menta', '#a6e3c8'],
    ['Amarelo', '#f5c400'],
    ['Amarelo-ouro', '#d9a400'],
    ['Laranja', '#ff6a13'],
    ['Coral', '#ff7f6a'],
    ['Vermelho', '#c8102e'],
    ['Vinho/bordô', '#6d1a2c'],
    ['Rosa-claro', '#f6c1d0'],
    ['Rosa', '#ec7fa9'],
    ['Pink/magenta', '#d6197a'],
    ['Roxo', '#5b2a8c'],
    ['Lilás', '#b79ad8'],
    ['Bege', '#d8c3a0'],
    ['Cáqui', '#b0a178'],
    ['Caramelo', '#b06a2a'],
    ['Marrom', '#5c3a21'],
    // Finishes, not hues: offered by name, with no chip on screen.
    ['Neon', ''],
    ['Fluorescente', ''],
    ['Metálico', ''],
    ['Mescla', ''],
    ['Estampado', ''],
  ].map(([name, swatch]) => Object.freeze({ name, swatch })),
);

export const FINISHES = Object.freeze([
  'Próprio tecido',
  'Viés do próprio tecido',
  'Viés contrastante',
  'Ribana',
  'Ribana lisa',
  'Ribana canelada',
  'Gola pronta',
  'Punho pronto',
  'Galão',
  'Bainha simples',
  'Galoneira',
  'Elástico',
  'Sem acabamento separado',
]);

export const APPLICATIONS = Object.freeze([
  'Sublimação total',
  'Sublimação localizada',
  'Serigrafia/silk screen',
  'DTF',
  'DTG/silk digital',
  'Transfer sublimático',
  'Vinil termotransferível',
  'Bordado direto',
  'Aplique costurado',
  'Refletivo',
  'Sem aplicação',
]);

export const SIZES = Object.freeze([
  'PP',
  'P',
  'M',
  'G',
  'GG',
  'EG',
  'XG',
  'XX',
  'JEGÃO',
  '0–3 meses',
  '3–6 meses',
  '6–9 meses',
  '9–12 meses',
  '12–18 meses',
  '18–24 meses',
]);

/** @param {unknown} text */
function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[-/]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const FOLDED_COLORS = COLORS.map((color) => ({
  key: fold(color.name.split('/')[0]),
  swatch: color.swatch,
}))
  // The longest name wins, so "azul marinho" is not read as a plain "azul".
  .sort((a, b) => b.key.length - a.key.length);

/**
 * The swatch of the first catalog colour named in a free-text value
 * ("AZUL MARINHO", "Olímpica · verde-bandeira"), or '' when none is.
 *
 * @param {unknown} value
 */
export function colorSwatch(value) {
  const text = fold(value);
  if (text === '') return '';
  // A finish without a chip ("MESCLA") still wins its match, so "PRETO
  // MESCLA" is not painted as a plain black.
  return FOLDED_COLORS.find((color) => text.includes(color.key))?.swatch ?? '';
}
