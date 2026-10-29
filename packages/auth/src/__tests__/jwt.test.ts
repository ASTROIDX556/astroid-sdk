import { describe, it, expect } from 'vitest';
import { decodeSessionToken, hasRole } from '../jwt.js';
import {
  decodeSessionToken as decodeSessionTokenFromIndex,
  hasRole as hasRoleFromIndex,
} from '../index.js';

describe('JWT decoding and role verification (Issue #465)', () => {
  function makeJwt(header: Record<string, unknown>, payload: Record<string, unknown>): string {
    const b64 = (obj: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${b64(header)}.${b64(payload)}.mock_signature`;
  }

  it('exports functions from package entry point', () => {
    expect(typeof decodeSessionTokenFromIndex).toBe('function');
    expect(typeof hasRoleFromIndex).toBe('function');
  });

  it('decodes valid JWT session token and returns metadata', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'agent_123', orgId: 'org_abc', roles: ['agent', 'finance'], exp },
    );

    const decoded = decodeSessionToken(token);
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.sub).toBe('agent_123');
    expect(decoded.payload.orgId).toBe('org_abc');
    expect(decoded.signature).toBe('mock_signature');
    expect(decoded.isExpired).toBe(false);
    expect(decoded.expiresInSeconds).toBeGreaterThan(0);
  });

  it('detects expired tokens correctly', () => {
    const exp = Math.floor(Date.now() / 1000) - 100;
    const token = makeJwt({ alg: 'HS256' }, { sub: 'user_1', exp });

    const decoded = decodeSessionToken(token);
    expect(decoded.isExpired).toBe(true);
    expect(decoded.expiresInSeconds).toBeLessThan(0);
  });

  it('throws descriptive error on malformed tokens', () => {
    expect(() => decodeSessionToken('')).toThrow(/Invalid token/);
    expect(() => decodeSessionToken('invalid.format')).toThrow(/Invalid token/);
    expect(() => decodeSessionToken('not_json.not_json.sig')).toThrow(/Failed to decode JWT/);
  });

  it('verifies roles correctly with hasRole', () => {
    const token = makeJwt(
      { alg: 'HS256' },
      { sub: 'agt_x', roles: ['ADMIN', 'settlement_agent'] },
    );

    // Case insensitive matching
    expect(hasRole(token, 'admin')).toBe(true);
    expect(hasRole(token, 'ADMIN')).toBe(true);
    expect(hasRole(token, 'settlement_agent')).toBe(true);
    expect(hasRole(token, 'super_admin')).toBe(false);

    // Also works directly with decoded payload
    const decoded = decodeSessionToken(token);
    expect(hasRole(decoded, 'admin')).toBe(true);
    expect(hasRole(decoded.payload, 'settlement_agent')).toBe(true);

    // Single role field
    expect(hasRole({ role: 'operator' }, 'operator')).toBe(true);

    // Handles null / undefined safely
    expect(hasRole(null, 'admin')).toBe(false);
    expect(hasRole(undefined, 'admin')).toBe(false);
    expect(hasRole('malformed.token', 'admin')).toBe(false);
  });
});
