import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AstroidProvider } from './provider.js';
import { useAstroidClient } from './hooks.js';
import { Astroid } from '@astroid/client';

describe('AstroidProvider', () => {
  it('provides the initialized client', () => {
    const client = new Astroid({ apiKey: 'test', fetch: async () => new Response('{}') });
    const result = renderHook(() => useAstroidClient(), {
      wrapper: ({ children }) => <AstroidProvider client={client}>{children}</AstroidProvider>,
    });
    expect(result.result.current).toBe(client);
  });

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useAstroidClient())).toThrow(/within an <AstroidProvider>/);
  });
});
