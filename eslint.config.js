const nodeGlobals = {
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  process: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
};

export default [
  {
    ignores: [
      'dist/**',
      'graphify-out/**',
      'historico-datacrazy/**',
      'node_modules/**',
    ],
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: nodeGlobals,
      sourceType: 'module',
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['apps/edge-web/src/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          message: 'Frontend domain state must not be stored on window.',
          selector: "AssignmentExpression[left.object.name='window']",
        },
        {
          message: 'Frontend domain state must not be stored on window.',
          selector: "UpdateExpression[argument.object.name='window']",
        },
      ],
    },
  },
];
