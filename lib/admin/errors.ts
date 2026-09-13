export class AdminApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
    this.status = status;
  }
}
