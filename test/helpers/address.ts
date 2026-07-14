/// viem returns checksummed addresses while contract reads come back lowercase, so a direct `===`
/// between the two is a coin flip. Normalise before comparing.
export function lower(addr: string): `0x${string}` {
  return addr.toLowerCase() as `0x${string}`;
}
