'use strict';

import { app } from 'electron';
import Fetch from 'electron-fetch';
import type { RequestInit, Response } from 'electron-fetch';

export interface MechvibesRequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  headers?: Record<string, string>;
  body?: unknown;
}

function fetch(serverUrl: string, requestOptions: MechvibesRequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = requestOptions.headers ?? {
    'User-Agent': `Mechvibes/${app.getVersion()} (Electron/${process.versions.electron})`,
  };

  let body = requestOptions.body;
  if (body && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  return Fetch(serverUrl, {
    ...requestOptions,
    headers,
    body: body as RequestInit['body'],
  });
}

export = fetch;
