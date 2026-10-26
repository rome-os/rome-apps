/** Repository paths are arbitrary strings, including __proto__, constructor and toString. */
export function dictionary<T>(source?: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null), source);
}
