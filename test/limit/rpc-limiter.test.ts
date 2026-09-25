import { describe, expect, it } from 'vitest';
import { LimiterError, rpcLimiter } from '../../src/limit/index.js';

// Unit tests for rpcLimiter() (task P4; design §5 "Limits"). It adapts any
// (subject) => Promise<unknown> call — such as a Postgres rpc() call to
// feedback_rate_take() — into a Limiter, failing closed on anything but a
// strict boolean.

describe('rpcLimiter', () => {
  it('maps a resolved true to ok', async () => {
    const limiter = rpcLimiter(async () => true);
    expect(await limiter.take('subject')).toBe('ok');
  });

  it('maps a resolved false to limited', async () => {
    const limiter = rpcLimiter(async () => false);
    expect(await limiter.take('subject')).toBe('limited');
  });

  it('throws LimiterError when the call resolves to undefined', async () => {
    const limiter = rpcLimiter(async () => undefined);
    await expect(limiter.take('subject')).rejects.toBeInstanceOf(LimiterError);
  });

  it('throws LimiterError when the call resolves to null', async () => {
    const limiter = rpcLimiter(async () => null);
    await expect(limiter.take('subject')).rejects.toBeInstanceOf(LimiterError);
  });

  it('throws LimiterError when the call resolves to a string', async () => {
    const limiter = rpcLimiter(async () => 'ok');
    await expect(limiter.take('subject')).rejects.toBeInstanceOf(LimiterError);
  });

  it('throws LimiterError when the call resolves to a truthy non-boolean', async () => {
    const limiter = rpcLimiter(async () => 1);
    await expect(limiter.take('subject')).rejects.toBeInstanceOf(LimiterError);
  });

  it('throws LimiterError when the call rejects', async () => {
    const limiter = rpcLimiter(async () => {
      throw new Error('boom');
    });
    await expect(limiter.take('subject')).rejects.toBeInstanceOf(LimiterError);
  });

  it('passes the subject through to the call', async () => {
    const seen: string[] = [];
    const limiter = rpcLimiter(async (subject) => {
      seen.push(subject);
      return true;
    });
    await limiter.take('person-123');
    expect(seen).toEqual(['person-123']);
  });

  it('exposes kind "rpc"', () => {
    const limiter = rpcLimiter(async () => true);
    expect(limiter.kind).toBe('rpc');
  });
});
