import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "@/lib/errors";

/**
 * Runs a loader and turns authorization / missing-resource failures into a 404, so outsiders can't
 * tell "doesn't exist" from "not yours". Kept separate from JSX so pages never build elements
 * inside a try/catch.
 */
export async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
}
