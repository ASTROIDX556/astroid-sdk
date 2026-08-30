import { createContext, createElement, type ReactNode } from 'react';
import { Astroid } from '@astroid/client';

/** The context value shared by Astroid React consumers. */
export const AstroidClientContext = createContext<Astroid | null>(null);

/** Props for {@link AstroidProvider}. */
export interface AstroidProviderProps {
  /** An already initialized Astroid SDK client. */
  client: Astroid;
  /** Descendant components that may consume the client. */
  children: ReactNode;
}

/** Provide an initialized Astroid client to a component subtree. */
export function AstroidProvider({ client, children }: AstroidProviderProps): ReactNode {
  return createElement(AstroidClientContext.Provider, { value: client }, children);
}
