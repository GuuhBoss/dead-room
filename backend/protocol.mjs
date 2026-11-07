// Strict allowlists: values from the network never become world state or code.
export const neutralInput = () => ({ dx: 0, dy: 0, fire: false, prev: false, next: false, select: -1, tap: false });
export const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function validInput(input, weaponCount) {
  const keys = ['dx', 'dy', 'fire', 'prev', 'next', 'select'];
  if (input && Object.hasOwn(input, 'tap')) keys.push('tap');
  return exact(input, keys)
    && (!Object.hasOwn(input, 'tap') || typeof input.tap === 'boolean')
    && [-1, 0, 1].includes(input.dx) && [-1, 0, 1].includes(input.dy)
    && ['fire', 'prev', 'next'].every(key => typeof input[key] === 'boolean')
    && Number.isInteger(input.select) && input.select >= -1 && input.select < weaponCount;
}
export function playerName(value) {
  if (typeof value !== 'string' || value.length > 48) return null;
  const name = value.normalize('NFKC').trim().replace(/ +/g, ' ');
  return name.length >= 1 && [...name].length <= 24 && /^[\p{L}\p{N} ._'\-]+$/u.test(name) ? name : null;
}
export function bucket(capacity, rate, now) { return { capacity, rate, tokens: capacity, at: now }; }
export function consume(bucket, now) {
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + Math.max(0, now - bucket.at) * bucket.rate / 1000);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens--;
  return true;
}
