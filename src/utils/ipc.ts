'use strict';

import fetch from './fetch';

export interface IpcFailure {
  success: false;
  error: unknown;
  src: string;
}

export type IpcResponse = IpcFailure | Record<string, unknown>;

let remoteUrl: string | undefined = undefined;

export function setRemoteUrl(url: string | undefined): void {
  remoteUrl = url;
}

async function post(
  source: string,
  body: Record<string, unknown>,
): Promise<IpcResponse> {
  if (remoteUrl === undefined) {
    throw new Error('Remote URL not set');
  }

  try {
    const response = await fetch(remoteUrl, { method: 'AUTH', body });
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return { success: false, error, src: source };
  }
}

export function identify(info: unknown): Promise<IpcResponse> {
  return post('ipc-identify', { type: 'identify', userInfo: info });
}

export function validate(identifier: unknown, info: unknown): Promise<IpcResponse> {
  return post('ipc-validate', { type: 'validate', data: identifier, userInfo: info });
}
