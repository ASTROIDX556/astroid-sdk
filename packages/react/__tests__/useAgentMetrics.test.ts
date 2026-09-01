import { describe, it, expect } from 'vitest';
import { useAgentMetrics } from '../src/hooks/useAgentMetrics.js';

describe('useAgentMetrics hook (Issue #31)', () => {
  it('is exported as a callable function', () => {
    expect(typeof useAgentMetrics).toBe('function');
  });
});
