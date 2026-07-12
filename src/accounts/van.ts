const NUBAN_WEIGHTS = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
const PSEUDO_BANK_CODE = '999';

export function nubanCheckDigit(bankCode: string, serial: string): string {
  if (!/^\d{3}$/.test(bankCode)) throw new Error('bankCode must be exactly 3 digits');
  if (!/^\d{9}$/.test(serial)) throw new Error('serial must be exactly 9 digits');
  const digits = (bankCode + serial).split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * NUBAN_WEIGHTS[i], 0);
  const check = 10 - (sum % 10);
  return String(check === 10 ? 0 : check);
}

export function generateVan(prefix: string, rand: () => number = Math.random): string {
  if (!/^\d{0,8}$/.test(prefix)) throw new Error('prefix must be 0-8 digits');
  let serial = prefix;
  while (serial.length < 9) serial += Math.floor(rand() * 10);
  return serial + nubanCheckDigit(PSEUDO_BANK_CODE, serial);
}
