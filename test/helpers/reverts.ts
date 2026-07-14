import { expect } from "chai";

/// Assert that an async action rejects with an error mentioning `pattern`.
///
/// Prefer `viem.assertions.revertWithCustomError(...)` wherever it works — it decodes the
/// error selector and checks the arguments. This helper exists for the cases it cannot
/// reach: constructor reverts, where there is no deployed contract handle to decode against.
export async function expectRevertWithMessage(action: () => Promise<unknown>, pattern: string | RegExp): Promise<void> {
  let threw = false;
  try {
    await action();
  } catch (err) {
    threw = true;
    const message = serializeError(err);
    if (typeof pattern === "string") {
      expect(message).to.include(pattern);
    } else {
      expect(message).to.match(pattern);
    }
  }
  expect(threw, "expected the action to revert, but it succeeded").to.equal(true);
}

/// viem nests the useful revert data several `cause` levels deep. Flatten the whole chain so
/// a substring match actually sees the custom-error name.
function serializeError(err: unknown): string {
  if (err instanceof Error) {
    const parts: string[] = [err.message];
    let cause: unknown = (err as { cause?: unknown }).cause;
    while (cause !== undefined && cause !== null) {
      if (cause instanceof Error) {
        parts.push(cause.message);
        cause = (cause as { cause?: unknown }).cause;
      } else {
        parts.push(String(cause));
        break;
      }
    }
    return parts.join("\n");
  }
  return String(err);
}
