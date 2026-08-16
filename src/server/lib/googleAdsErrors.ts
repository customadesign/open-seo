export class GoogleAdsTokenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GoogleAdsTokenError";
  }
}

export class GoogleAdsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = "GoogleAdsApiError";
  }
}
