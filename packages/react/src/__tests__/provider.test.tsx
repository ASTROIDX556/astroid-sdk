/**
 * Unit tests for the `AstroidProvider` and `useAstroid` hook.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { Astroid, type AstroidClientConfig } from '@astroid/client';
import { AstroidProvider, useAstroid } from '../index.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

const CONFIG: AstroidClientConfig = {
  apiKey: 'sk_test_provider',
  baseUrl: 'https://api.test',
};

function renderWithProviders(
  children: ReactNode,
  options: {
    client?: Astroid;
    config?: AstroidClientConfig;
  } = {},
): { unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const providerProps: { children: ReactNode } & (
    | { client: Astroid }
    | { config: AstroidClientConfig }
  ) = options.client
    ? { client: options.client, children }
    : { config: options.config ?? CONFIG, children };

  act(() => {
    root.render(createElement(AstroidProvider, providerProps));
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

  it('provides the client to useAstroid', () => {
    let receivedVersion: string | undefined;

    function Consumer() {
      useAstroid();
      receivedVersion = Astroid.version;
      return null;
    }

    const { unmount } = renderWithProviders(createElement(Consumer));
    expect(receivedVersion).toBe('0.1.0');
    unmount();
  });

  it('accepts a pre-built client instance', () => {
    const client = new Astroid({
      apiKey: 'sk_test_prebuilt',
      baseUrl: 'https://api.test',
    });

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

  it('does not recreate the client on re-render when config is stable', () => {
    const clients: Astroid[] = [];

    function Consumer() {
      const astroid = useAstroid();
      clients.push(astroid);
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(AstroidProvider, { config: CONFIG, children: createElement(Consumer) }),
      );
    });
    act(() => {
      root.render(
        createElement(AstroidProvider, { config: CONFIG, children: createElement(Consumer) }),
      );
    });

    expect(clients[0]).toBe(clients[1]);
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });
});
