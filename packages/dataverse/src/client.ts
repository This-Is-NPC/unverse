import type { ErrorCode } from "@unverse/core";

export interface Credential {
  getToken(scope: string): Promise<string>;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export interface HttpTransport {
  request?(
    method: "POST" | "PATCH" | "DELETE",
    url: string,
    headers: Readonly<Record<string, string>>,
    body?: string,
  ): Promise<HttpResponse>;
  get(
    url: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<HttpResponse>;
}

export interface RetryClock {
  wait(milliseconds: number): Promise<void>;
  now(): number;
}

export interface WhoAmI {
  readonly organizationId: string;
  readonly applicationUserId: string;
  readonly businessUnitId: string;
}

export interface Collection {
  readonly rows: readonly Record<string, unknown>[];
  readonly complete: boolean;
}

export class DataverseError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly serviceCode?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "DataverseError";
  }
}

export class DataverseClient {
  get url(): string {
    return this.environmentUrl;
  }
  constructor(
    private readonly environmentUrl: string,
    private readonly credential: Credential,
    private readonly transport: HttpTransport,
    private readonly clock: RetryClock,
    private readonly pageSize = 5000,
  ) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5000)
      throw new DataverseError(
        "invalid-input",
        "Page size must be between 1 and 5000.",
      );
  }

  async whoAmI(): Promise<WhoAmI> {
    const token = await this.token();
    const response = await this.read("WhoAmI", token);
    const body = object(response.body);
    return {
      organizationId: requiredString(body.OrganizationId, "OrganizationId"),
      applicationUserId: requiredString(body.UserId, "UserId"),
      businessUnitId: requiredString(body.BusinessUnitId, "BusinessUnitId"),
    };
  }

  async write(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<Record<string, unknown>> {
    const { value } = await this.writeRaw(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      headers,
    );
    return value ?? {};
  }

  async atomicBatch(
    operations: readonly {
      readonly path: string;
      readonly createOnly: boolean;
      readonly body: Readonly<Record<string, unknown>>;
    }[],
  ): Promise<void> {
    if (!operations.length) return;
    if (operations.length > 1000)
      throw new DataverseError(
        "unsupported",
        "Atomic data writes are limited to 1000 operations.",
      );
    const boundary = `batch_${crypto.randomUUID()}`;
    const changeset = `changeset_${crypto.randomUUID()}`;
    const parts = operations.map((operation, index) => {
      const url = this.requestUrl(operation.path);
      if (!/^[a-z][a-z0-9_]*\([a-f\d-]{36}\)$/i.test(operation.path))
        throw new DataverseError(
          "invalid-input",
          "Atomic data operations require an entity set and explicit UUID.",
        );
      return [
        `--${changeset}`,
        "Content-Type: application/http",
        "Content-Transfer-Encoding: binary",
        `Content-ID: ${index + 1}`,
        "",
        `PATCH ${url} HTTP/1.1`,
        "Content-Type: application/json",
        operation.createOnly ? "If-None-Match: *" : "If-Match: *",
        "",
        JSON.stringify(operation.body),
      ].join("\r\n");
    });
    const body = [
      `--${boundary}`,
      `Content-Type: multipart/mixed;boundary=${changeset}`,
      "",
      ...parts,
      `--${changeset}--`,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    if (new TextEncoder().encode(body).length > 4_000_000)
      throw new DataverseError(
        "unsupported",
        "Atomic data writes are limited to a 4 MB request.",
      );
    const { response } = await this.writeRaw("POST", "$batch", body, {
      "Content-Type": `multipart/mixed;boundary=${boundary}`,
      Accept: "application/json",
    });
    const statuses = [
      ...response.body.matchAll(/^HTTP\/1\.[01] (\d{3})[^\r\n]*\r?\n/gm),
    ].map((match) => Number(match[1]));
    if (
      statuses.length !== operations.length ||
      statuses.some((status) => status < 200 || status >= 300)
    )
      throw new DataverseError(
        "service",
        "Atomic data batch did not confirm every operation; inspect and re-plan before retrying.",
      );
  }

  private async writeRaw(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body: string | undefined,
    headers: Readonly<Record<string, string>>,
  ): Promise<{
    readonly response: HttpResponse;
    readonly value?: Record<string, unknown>;
  }> {
    if (this.transport.request === undefined)
      throw new DataverseError(
        "unsupported",
        "This transport does not support writes.",
      );
    const token = await this.token();
    try {
      const response = await this.transport.request(
        method,
        this.requestUrl(path),
        {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...headers,
          Authorization: `Bearer ${token}`,
          "OData-Version": "4.0",
        },
        body,
      );
      if (response.status < 200 || response.status >= 300)
        throw serviceError(response);
      if (
        response.body !== "" &&
        !headers["Content-Type"]?.startsWith("multipart/")
      ) {
        const value = object(response.body);
        if (value.error !== undefined) throw serviceError(response);
        return { response, value };
      }
      return { response };
    } catch (error) {
      throw new DataverseError(
        error instanceof DataverseError ? error.code : "service",
        message(error, "Dataverse write failed.").replaceAll(
          token,
          "[REDACTED]",
        ),
        error instanceof DataverseError ? error.serviceCode : undefined,
        error instanceof DataverseError ? error.httpStatus : undefined,
      );
    }
  }

  async collect(path: string, limit?: number): Promise<Collection> {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
      throw new DataverseError(
        "invalid-input",
        "The row limit must be a positive safe integer.",
      );
    }
    const token = await this.token();
    const rows: Record<string, unknown>[] = [];
    const visited = new Set<string>();
    let next: string | undefined = this.requestUrl(path);
    while (next !== undefined) {
      if (visited.has(next))
        throw new DataverseError(
          "service",
          "Dataverse returned a repeated continuation link.",
        );
      visited.add(next);
      const response = await this.read(next, token);
      const body = object(response.body);
      if (!Array.isArray(body.value))
        throw new DataverseError(
          "service",
          "Dataverse collection is missing value.",
        );
      for (const value of body.value) {
        if (typeof value !== "object" || value === null || Array.isArray(value))
          throw new DataverseError(
            "service",
            "Dataverse returned an invalid collection row.",
          );
        if (limit !== undefined && rows.length === limit)
          return { rows, complete: false };
        rows.push(value as Record<string, unknown>);
      }
      const continuation: unknown = body["@odata.nextLink"];
      if (continuation !== undefined && typeof continuation !== "string")
        throw new DataverseError(
          "service",
          "Dataverse returned an invalid continuation link.",
        );
      next =
        continuation === undefined ? undefined : this.requestUrl(continuation);
      if (next !== undefined && rows.length === limit)
        return { rows, complete: false };
    }
    return { rows, complete: true };
  }

  private requestUrl(path: string): string {
    const url = new URL(path, `${this.environmentUrl}/api/data/v9.2/`);
    if (
      url.origin !== this.environmentUrl ||
      url.username !== "" ||
      url.password !== "" ||
      !url.pathname.startsWith("/api/data/v9.2/")
    ) {
      throw new DataverseError(
        "service",
        "Rejected a continuation outside the authenticated Dataverse API.",
      );
    }
    return url.href;
  }

  private async token(): Promise<string> {
    try {
      const token = await this.credential.getToken(
        `${this.environmentUrl}/.default`,
      );
      if (token.trim() === "")
        throw new Error("The credential returned an empty token.");
      return token;
    } catch (error) {
      throw new DataverseError(
        "authentication",
        message(error, "Token acquisition failed."),
      );
    }
  }

  private async read(path: string, token: string): Promise<HttpResponse> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: HttpResponse;
      try {
        response = await this.transport.get(this.requestUrl(path), {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "OData-MaxVersion": "4.0",
          "OData-Version": "4.0",
          Prefer: `odata.maxpagesize=${this.pageSize}`,
        });
      } catch (error) {
        if (attempt === 2) {
          throw new DataverseError(
            "service",
            message(error, "Dataverse transport failed.").replaceAll(
              token,
              "[REDACTED]",
            ),
          );
        }
        await this.clock.wait(1_000);
        continue;
      }
      if (retryable(response.status) && attempt < 2) {
        const delay = retryAfterMilliseconds(
          response.headers,
          this.clock.now(),
        );
        if (delay <= 30_000) {
          await this.clock.wait(delay);
          continue;
        }
      }
      if (
        response.status < 200 ||
        response.status >= 300 ||
        object(response.body).error !== undefined
      ) {
        const failure = serviceError(response);
        throw new DataverseError(
          failure.code,
          failure.message.replaceAll(token, "[REDACTED]"),
          failure.serviceCode,
          failure.httpStatus,
        );
      }
      return response;
    }
    throw new DataverseError("service", "Dataverse retry budget exhausted.");
  }
}

function retryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryAfterMilliseconds(
  headers: Readonly<Record<string, string | undefined>>,
  now: number,
): number {
  const value = headers["retry-after"] ?? headers["Retry-After"];
  if (value === undefined) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 1_000;
}

function serviceError(response: HttpResponse): DataverseError {
  const detail = serviceMessage(response.body);
  let code: string | undefined;
  try {
    const error = object(response.body).error;
    if (typeof error === "object" && error !== null) {
      const value = (error as Record<string, unknown>).code;
      if (typeof value === "string") code = value.toLowerCase();
    }
  } catch {
    // Non-JSON error bodies retain their HTTP classification.
  }
  if (response.status === 401)
    return new DataverseError("authentication", detail, code, response.status);
  if (response.status === 403 || code === "0x80040220" || code === "0x80048306")
    return new DataverseError("permission", detail, code, response.status);
  return new DataverseError("service", detail, code, response.status);
}

function serviceMessage(body: string): string {
  try {
    const parsed = object(body);
    const error = parsed.error;
    if (typeof error === "object" && error !== null) {
      const messageValue = (error as Record<string, unknown>).message;
      if (typeof messageValue === "string") return messageValue;
      if (typeof messageValue === "object" && messageValue !== null) {
        const value = (messageValue as Record<string, unknown>).value;
        if (typeof value === "string") return value;
      }
    }
  } catch {
    return "Dataverse request failed.";
  }
  return "Dataverse request failed.";
}

function object(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new DataverseError("service", "Dataverse returned invalid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DataverseError(
      "service",
      "Dataverse returned an invalid response body.",
    );
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new DataverseError(
      "service",
      `Dataverse response is missing ${field}.`,
    );
  }
  return value;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
