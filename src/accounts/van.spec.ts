import { generateVan, nubanCheckDigit } from './van';

describe('nubanCheckDigit', () => {
  // Known vector from the CBN NUBAN spec: bank 011, serial 000001457 -> check digit 9
  it('computes the documented NUBAN example', () => {
    expect(nubanCheckDigit('011', '000001457')).toBe('9');
  });

  it('maps a computed value of 10 to 0', () => {
    // bank 000, serial 000000000 -> sum 0 -> 10 - 0 % 10 => 10 -> '0'
    expect(nubanCheckDigit('000', '000000000')).toBe('0');
  });

  it('rejects malformed input', () => {
    expect(() => nubanCheckDigit('01', '000001457')).toThrow();
    expect(() => nubanCheckDigit('011', '00000145')).toThrow();
    expect(() => nubanCheckDigit('011', '00000145a')).toThrow();
  });
});

describe('generateVan', () => {
  it('returns 10 digits starting with the prefix', () => {
    const van = generateVan('99');
    expect(van).toMatch(/^\d{10}$/);
    expect(van.startsWith('99')).toBe(true);
  });

  it('is deterministic given a seeded rand and self-consistent on the check digit', () => {
    const van = generateVan('99', () => 0.5);
    expect(van).toBe('99' + '5555555'.slice(0, 7) + nubanCheckDigit('999', van.slice(0, 9)));
    expect(van.slice(9)).toBe(nubanCheckDigit('999', van.slice(0, 9)));
  });

  it('rejects a prefix longer than 8 digits', () => {
    expect(() => generateVan('123456789')).toThrow();
  });
});
