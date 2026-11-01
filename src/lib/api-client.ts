"use client";

import { useCallback, useState } from "react";

/** Fired on window after a successful change; the Toaster shows a short confirmation. */
export const DONE_EVENT = "carenest:done";

export type ApiErrorBody = { code: string; message: string; details?: Record<string, string[]> | unknown };

export type SubmitState = {
  pending: boolean;
  error?: string;
  fieldErrors: Record<string, string[]>;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiErrorBody };

/** JSON fetch against our own API with uniform error handling (network failures included). */
export async function callApi<T>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, error: { code: "network", message: "" } };
  }
  if (res.status === 204) return { ok: true, data: undefined as T };
  const json = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: json as T };
  return { ok: false, status: res.status, error: json.error ?? { code: "internal", message: "" } };
}

/**
 * Form submission state: pending flag, a top-level message, and per-field errors from 422
 * responses so they can be shown next to the right input.
 */
export function useApiSubmit(messages: { network: string; generic: string; fixErrors: string }, options: { confirm?: boolean } = {}) {
  const confirm = options.confirm ?? true;
  const [state, setState] = useState<SubmitState>({ pending: false, fieldErrors: {} });

  const submit = useCallback(
    async <T,>(method: string, url: string, body?: unknown): Promise<T | null> => {
      setState({ pending: true, fieldErrors: {} });
      const result = await callApi<T>(method, url, body);
      if (result.ok) {
        setState({ pending: false, fieldErrors: {} });
        if (confirm && method !== "GET") window.dispatchEvent(new Event(DONE_EVENT));
        return result.data;
      }
      const details = result.error.details;
      const fieldErrors =
        result.status === 422 && details && typeof details === "object" ? (details as Record<string, string[]>) : {};
      const error =
        result.status === 0
          ? messages.network
          : Object.keys(fieldErrors).length > 0
            ? messages.fixErrors
            : result.error.message || messages.generic;
      setState({ pending: false, error, fieldErrors });
      return null;
    },
    [messages.network, messages.generic, messages.fixErrors, confirm],
  );

  return { ...state, submit };
}
