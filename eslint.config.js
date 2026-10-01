import stylistic from '@stylistic/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';

const controlStatements = ['if', 'for', 'while', 'do', 'switch', 'try'];

export default [
    {
        ignores: ['dist/**', 'node_modules/**', 'projects/**'],
    },
    {
        files: ['**/*.{js,mjs,ts}'],
        languageOptions: {
            ecmaVersion: 'latest',
            parser: typescriptParser,
            sourceType: 'module',
        },
        plugins: {
            '@stylistic': stylistic,
        },
        rules: {
            curly: ['error', 'all'],
            'no-else-return': ['error', { allowElseIf: false }],
            '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],
            '@stylistic/padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: '*', next: controlStatements },
                { blankLine: 'always', prev: controlStatements, next: '*' },
            ],
        },
    },
];
