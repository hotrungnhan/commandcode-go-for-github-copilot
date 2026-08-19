import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: 'module',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'@typescript-eslint/naming-convention': [
				'warn',
				{
					selector: 'default',
					format: ['camelCase'],
					leadingUnderscore: 'allow',
					trailingUnderscore: 'allow',
				},
				{
					selector: ['variable', 'parameter'],
					format: ['camelCase', 'UPPER_CASE'],
					leadingUnderscore: 'allow',
					trailingUnderscore: 'allow',
				},
				{
					selector: ['typeLike'],
					format: ['PascalCase'],
				},
				{
					selector: ['property', 'method', 'objectLiteralProperty', 'objectLiteralMethod'],
					format: null,
					leadingUnderscore: 'allow',
					trailingUnderscore: 'allow',
				},
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			curly: 'warn',
			eqeqeq: ['warn', 'always'],
			'no-throw-literal': 'warn',
			'no-console': 'warn',
			'no-unused-vars': 'off',
			// TypeScript handles undefined-identifier detection more accurately than
			// ESLint's no-undef, which does not know about lib.d.ts globals.
			'no-undef': 'off',
			semi: ['warn', 'always'],
			'prefer-const': 'warn',
			'default-case': 'warn',
			'no-fallthrough': 'warn',
		},
	},
	{
		ignores: ['out/**', 'dist/**', 'node_modules/**'],
	},
];
