"use client";

import { useEffect } from "react";

/** Flags `<html data-hydrated>` once React has attached, so browser tests never click a dead button. */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return null;
}
