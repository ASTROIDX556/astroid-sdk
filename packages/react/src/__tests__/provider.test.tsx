/**
 * Unit tests for the `AstroidProvider` and `useAstroid` hook.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { Astroid } from '@astroid/client';
import { AstroidProvider, useAstroid, type AstroidProviderProps } from '../index.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function renderWithProviders(
  children: ReactNode,
  options: {
    client: Astroid;
  },
): { unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      createElement(AstroidProvider, { client: options.client, children } as AstroidProviderProps),
    );
  });

  return {
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* AstroidProvider tests                                                       */
/* -------------------------------------------------------------------------- */

describe('AstroidProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const client = new Astroid({
    apiKey: 'sk_test_provider',
    baseUrl: 'https://api.test',
  });

  it('provides the client to useAstroid', () => {
    let receivedVersion: string | undefined;

    function Consumer() {
      useAstroid();
      receivedVersion = Astroid.version;
      return null;
    }

    const { unmount } = renderWithProviders(createElement(Consumer), { client });
    expect(receivedVersion).toBe('0.1.0');
    unmount();
  });

  it('returns the same client instance that was passed', () => {
    let receivedClient: Astroid | undefined;

    function Consumer() {
      const astroid = useAstroid();
      receivedClient = astroid;
      return null;
    }

    const { unmount } = renderWithProviders(createElement(Consumer), { client });
    expect(receivedClient).toBe(client);
    unmount();
  });
});
