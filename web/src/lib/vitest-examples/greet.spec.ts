import { describe, it, expect } from 'vitest';
import { greet } from './greet';

describe('greet', () => {
	it('devuelve un saludo', () => {
		expect(greet('Svelte')).toBe('Hola, Svelte!');
	});
});
