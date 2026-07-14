/// viem returns checksummed addresses while contract reads come back lowercase, so any
/// direct `===` between the two is a coin flip. Normalise both sides.
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function lower(addr: string): `0x${string}` {
  return addr.toLowerCase() as `0x${string}`;
}
