import { isIP } from "net";
import {
  CancellationTokenSource,
  InputBoxValidationMessage,
  InputBoxValidationSeverity,
} from "vscode";

export class TimeoutError extends Error {
  constructor() {
    super("Operation timed out");
    this.name = "TimeoutError";
  }
}

export function setTimeoutAsync(
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

export const invalidPort = Symbol("invalid port");

const validHostnameRegex =
  /^(([A-Z0-9]|[A-Z0-9][A-Z0-9-]*[A-Z0-9])\.)*([A-Z0-9]|[A-Z0-9][A-Z0-9-]*[A-Z0-9])$/i;

export function validateHostAndPort(
  value: string,
): InputBoxValidationMessage | null {
  const parts = splitHostAndPort(value);

  const host = parts?.host;
  if (!host || !isValidHostnameOrIP(host)) {
    return {
      severity: InputBoxValidationSeverity.Error,
      message: "Invalid hostname or IP address",
    };
  }

  if (parts?.port === invalidPort) {
    return {
      severity: InputBoxValidationSeverity.Error,
      message: "Invalid port",
    };
  }

  return null;
}

export function splitHostAndPort(value: string) {
  const parts: { host?: string; port?: number | symbol } = {
    host: undefined,
    port: undefined,
  };
  const splitAt = value.lastIndexOf(":");
  if (splitAt === -1) {
    parts.host = value;
  } else {
    parts.host = value.slice(0, splitAt);
    const portStr = value.slice(splitAt + 1);
    if (portStr) {
      const port = parseInt(portStr, 10);
      if (isFinite(port) && port >= 1 && port <= 65535) {
        parts.port = port;
      } else {
        parts.port = invalidPort;
      }
    }
  }

  // remove brackets from IPv6 addresses
  if (parts.host.at(0) === "[" && parts.host.at(-1) === "]") {
    parts.host = parts.host.slice(1, -1);
  }
  return parts;
}

export function isValidHostname(v: string) {
  return validHostnameRegex.test(v);
}

export function isValidHostnameOrIP(v: string) {
  return isIP(v) || isValidHostname(v);
}
