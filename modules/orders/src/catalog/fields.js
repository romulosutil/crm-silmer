// modules/orders/src/catalog/fields.js
// The item fields of the ficha (design → Campos do item). The option sheet
// decides which of them a product has and what they are called there; this
// file decides where each one lives in the stored item and on the paper.

// The value the ficha stores when a part does not exist on the garment (PFI-07).
export const NOT_APPLICABLE = 'NAO APLICAVEL';

/**
 * @typedef {{
 *   id: string, label: string, header: string, path: string,
 *   kind: 'text'|'multi'|'composite', list: string, colorList?: string,
 *   placement: 'header'|'grid'|'wide', addLabel?: string,
 * }} FieldDefinition
 */

/** @type {readonly FieldDefinition[]} */
export const FIELDS = Object.freeze(
  /** @type {FieldDefinition[]} */ ([
    {
      id: 'modelagem',
      label: 'Modelagem',
      header: 'Modelagem',
      path: 'modelo',
      kind: 'text',
      list: 'modelagens',
      placement: 'header',
    },
    {
      id: 'gola',
      label: 'Gola/decote',
      header: 'Gola/decote',
      path: 'specs.gola',
      kind: 'text',
      list: 'golas',
      placement: 'header',
    },
    {
      id: 'manga',
      label: 'Manga',
      header: 'Manga',
      path: 'specs.manga',
      kind: 'text',
      list: 'mangas',
      placement: 'header',
    },
    {
      id: 'malha',
      label: 'Malha',
      header: 'Malha/tecido',
      path: 'malhas',
      kind: 'multi',
      list: 'malhas',
      placement: 'grid',
      addLabel: 'Adicionar malha',
    },
    {
      id: 'cor_frente',
      label: 'Cor frente',
      header: 'Cor frente',
      path: 'cor_frente',
      kind: 'text',
      list: 'cores',
      placement: 'grid',
    },
    {
      id: 'cor_costas',
      label: 'Cor costas',
      header: 'Cor costas',
      path: 'cor_costas',
      kind: 'text',
      list: 'cores',
      placement: 'grid',
    },
    {
      id: 'cor_manga_direita',
      label: 'Cor manga direita',
      header: 'Cor manga direita',
      path: 'cor_manga_direita',
      kind: 'text',
      list: 'cores',
      placement: 'grid',
    },
    {
      id: 'cor_manga_esquerda',
      label: 'Cor manga esquerda',
      header: 'Cor manga esquerda',
      path: 'cor_manga_esquerda',
      kind: 'text',
      list: 'cores',
      placement: 'grid',
    },
    {
      id: 'vies_gola',
      label: 'Viés gola',
      header: 'Acabamento gola (viés)',
      path: 'vies_gola',
      kind: 'composite',
      list: 'acabamentos',
      colorList: 'cores',
      placement: 'grid',
    },
    {
      id: 'vies_mangas',
      label: 'Viés mangas',
      header: 'Acabamento mangas/cavas (viés)',
      path: 'vies_mangas',
      kind: 'composite',
      list: 'acabamentos',
      colorList: 'cores',
      placement: 'grid',
    },
    {
      id: 'abertura',
      label: 'Abertura/fechamento',
      header: 'Abertura/fechamento',
      path: 'specs.abertura',
      kind: 'text',
      list: 'aberturas',
      placement: 'grid',
    },
    {
      id: 'bolso',
      label: 'Bolso',
      header: 'Bolso',
      path: 'specs.bolso',
      kind: 'text',
      list: 'bolsos',
      placement: 'grid',
    },
    {
      id: 'cos',
      label: 'Cós/cintura',
      header: 'Cós/cintura',
      path: 'specs.cos',
      kind: 'text',
      list: 'cos',
      placement: 'grid',
    },
    {
      id: 'faces',
      label: 'Faces',
      header: 'Faces',
      path: 'specs.faces',
      kind: 'text',
      list: 'faces',
      placement: 'grid',
    },
    {
      id: 'fixacao',
      label: 'Fixação/borda',
      header: 'Fixação/borda',
      path: 'specs.fixacao',
      kind: 'text',
      list: 'fixacoes',
      placement: 'grid',
    },
    {
      id: 'locais',
      label: 'Locais da aplicação',
      header: 'Locais da aplicação',
      path: 'specs.locais',
      kind: 'multi',
      list: 'locais',
      placement: 'wide',
      addLabel: 'Adicionar local',
    },
  ]).map((field) => Object.freeze(field)),
);
