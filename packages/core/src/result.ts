export const outputVersion = 1;

export type ResultStatus = "ok" | "failed" | "inconclusive" | "error";
export type ErrorCode =
  | "invalid-input"
  | "authentication"
  | "permission"
  | "service"
  | "unsupported";

export interface EnvironmentEvidence {
  readonly name: string;
  readonly url: string;
}

export interface IdentityEvidence {
  readonly id: string;
  readonly name?: string;
  readonly kind: string;
}

export interface Coverage {
  readonly complete: boolean;
  readonly limitations: readonly string[];
}

export interface ResultError {
  readonly code: ErrorCode;
  readonly message: string;
}

export interface Result<T> {
  readonly outputVersion: typeof outputVersion;
  readonly command: string;
  readonly timestamp: string;
  readonly environment?: EnvironmentEvidence;
  readonly caller?: IdentityEvidence;
  readonly subject?: IdentityEvidence;
  readonly status: ResultStatus;
  readonly data?: T;
  readonly evidence: readonly string[];
  readonly coverage: Coverage;
  readonly error?: ResultError;
}

export function exitCodeFor(result: Result<unknown>): number {
  if (result.status === "ok") return 0;
  if (result.status === "failed") return 1;
  if (result.status === "inconclusive") return 7;
  switch (result.error?.code) {
    case "invalid-input":
      return 2;
    case "authentication":
      return 3;
    case "permission":
      return 4;
    case "service":
      return 5;
    case "unsupported":
      return 6;
    default:
      return 5;
  }
}

export function redactText(value: string, secrets: readonly string[]): string {
  return secrets.reduce((redacted, secret) => {
    if (secret === "") return redacted;
    return redacted.replaceAll(secret, "[REDACTED]");
  }, value);
}
