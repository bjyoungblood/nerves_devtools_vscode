import { CancellationTokenSource } from "vscode";

export class TimeoutError extends Error {
  constructor() {
    super("Operation timed out");
    this.name = "TimeoutError";
  }
}

export function awaitTimeout(
  ms: number,
  type: "resolve" | "reject" = "reject",
  token?: CancellationTokenSource,
): Promise<TimeoutError> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => (type === "resolve" ? resolve : reject)(new TimeoutError()),
      ms,
    );

    if (token) {
      token.token.onCancellationRequested(() => {
        clearTimeout(timeoutId);
        reject(new Error("Operation canceled"));
      });
    }
  });
}
