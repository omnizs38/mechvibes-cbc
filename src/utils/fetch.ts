'use strict';

import { app } from 'electron';

export interface MechvibesRequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Thin wrapper over the platform `fetch` (global in Electron's Node runtime)
 * that adds a default User-Agent and JSON-encodes non-string bodies. Replaces
 * the former unmaintained `electron-fetch` dependency; the WHATWG Response it
 * returns is what `installer.ts` already streams via `body.getReader()`.
 */
function mechvibesFetch(
  serverUrl: string,
  requestOptions: MechvibesRequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': `Mechvibes/${app.getVersion()} (Electron/${process.versions.electron})`,
    ...requestOptions.headers,
  };

  let body = requestOptions.body;
  if (body && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  return fetch(serverUrl, {
    ...requestOptions,
    headers,
    signal: requestOptions.signal
      ? AbortSignal.any([requestOptions.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    body: body as BodyInit | null | undefined,
  });
}

export = mechvibesFetch;
