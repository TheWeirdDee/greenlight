export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "upstream";

/** An expected, user-presentable failure. Anything else is a bug and is logged, not shown. */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (message = "You do not have access to this resource") => new AppError("forbidden", message);
export const notFound = (message = "Not found") => new AppError("not_found", message);
export const conflict = (message: string) => new AppError("conflict", message);
export const invalid = (message: string) => new AppError("invalid", message);
