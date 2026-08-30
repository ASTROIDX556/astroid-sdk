import { useContext } from 'react';
import { Astroid } from '@astroid/client';
import { AstroidClientContext } from './provider.js';

/** Return the active Astroid client from the nearest provider. */
export function useAstroidClient(): Astroid {
  const client = useContext(AstroidClientContext);
  if (!client) {
    throw new Error(
      'useAstroidClient must be used within an <AstroidProvider>. Wrap your component tree with <AstroidProvider client={client}>.',
    );
  }
  return client;
}

/** Backwards-compatible alias for the client hook. */
export const useAstroid = useAstroidClient;
