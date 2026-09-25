import { describe, expect, it } from 'vitest';
import { describeArg } from '../../dist/doctor/redact.js';

// Gate R finding 1: describeArg() is the single function every message
// doctor prints routes a user-supplied value through before it can
// appear in output — a usage error, a check's PASS/FAIL/WARN reason, an
// unknown top-level command, and the top-level exception handler's
// message all call it now (src/bin/doctor.ts, src/doctor/config.ts,
// src/doctor/checks.ts, src/doctor/github-api.ts). This file tests the
// function directly rather than only through the black-box CLI tests in
// privacy.test.ts, for two reasons: it's the one place all of those
// call sites share, so a regression here would silently reopen every
// one of them at once; and the top-level exception handler
// (src/bin/doctor.ts's `.catch()`) can't practically be driven from the
// outside with attacker-controlled content in a thrown message — every
// foreseeable path that could embed one is already caught, and
// converted to a safe generic message, deeper in the stack (see the
// comment on that handler) — so this is the most direct test available
// for what it relies on.

describe('describeArg()', () => {
  it('echoes a short, plain value verbatim (quoted)', () => {
    expect(describeArg('doctor')).toBe("'doctor'");
    expect(describeArg('acme/intake-repo')).toBe("'acme/intake-repo'");
  });

  it('echoes a value at exactly the 32-character boundary', () => {
    const exactly32 = 'a'.repeat(32);
    expect(describeArg(exactly32)).toBe(`'${exactly32}'`);
  });

  it('redacts a value one character over the boundary, by length only', () => {
    const over32 = 'a'.repeat(33);
    const result = describeArg(over32);
    expect(result).not.toContain(over32);
    expect(result).toContain('33 characters');
    expect(result).toContain('not echoed');
  });

  it('redacts any value containing a newline, regardless of length', () => {
    const withNewline = 'ab\ncd';
    const result = describeArg(withNewline);
    expect(result).not.toContain(withNewline);
    expect(result).not.toContain('\n');
    expect(result).toContain('5 characters');
  });

  it('redacts any value containing a carriage return', () => {
    const withCr = 'ab\rcd';
    expect(describeArg(withCr)).not.toContain(withCr);
  });

  it('redacts any value containing "-----", regardless of length', () => {
    const short = '-----X';
    const result = describeArg(short);
    expect(result).not.toContain(short);
    expect(result).toContain('6 characters');
  });

  it('includes a 1-indexed position when given one, for an unsafe value', () => {
    const result = describeArg('x'.repeat(40), 3);
    expect(result).toContain('at position 3');
    expect(result).not.toContain('x'.repeat(40));
  });

  it('omits any position wording when none is given, for an unsafe value', () => {
    const result = describeArg('x'.repeat(40));
    expect(result).not.toMatch(/position/);
  });

  it('a real PEM (multi-line, well over 32 characters) is never echoed', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\n';
    const result = describeArg(pem);
    expect(result).not.toContain('BEGIN');
    expect(result).not.toContain('MIIEow');
    expect(result).toContain('not echoed');
  });

  it('a base64-of-PEM value well over 32 characters is never echoed', () => {
    const base64 = Buffer.from(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\n',
      'utf8',
    ).toString('base64');
    const result = describeArg(base64);
    expect(result).not.toContain(base64);
    expect(result).toContain('not echoed');
  });
});
