'use strict';

/**
 * Custom electron-log **remote** transport.
 *
 * electron-log ships no HTTP remote transport that surfaces the server's
 * response status, which Mechvibes' debug pipeline relies on. This transport
 * POSTs each log message to the configured URL and records a local warning when
 * the request fails or the server answers with a non-200 status.
 *
 * electron-log v5 note: a transport is a plain `(message) => void` function
 * carrying its own `level`/`transforms` (plus our extra fields). It no longer
 * depends on the removed `electron-log/src/transform` internal module or on
 * `logMessageWithTransports`; we serialize the payload ourselves and write
 * diagnostics straight to the sibling transports to avoid recursing back into
 * this one.
 */

import { app } from 'electron';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

export interface RemoteLogMessage {
  data: unknown[];
  level: string;
  date?: Date;
  variables?: Record<string, unknown> & { sender?: string };
}

type Transport = ((message: RemoteLogMessage) => void) & { level?: string | false };

export interface ElectronLogLike {
  variables: Record<string, unknown> & { sender?: string };
  transports: Record<string, Transport | undefined>;
}

export interface RemoteTransport {
  (message: RemoteLogMessage): void;
  transforms: unknown[];
  client: { name: string; identifier?: unknown };
  depth: number;
  level: string | false;
  requestOptions: http.RequestOptions;
  url: string | null;
  onError: ((error: Error) => void) | null;
  transformBody: (body: unknown) => string;
  clear: () => void;
}

/** Strip electron-log `%c` style directives and their trailing style arguments. */
function removeStyles(data: unknown[]): unknown[] {
  if (data.length === 0 || typeof data[0] !== 'string' || !data[0].includes('%c')) {
    return data;
  }
  const styleCount = (data[0].match(/%c/g) ?? []).length;
  return [data[0].replace(/%c/g, ''), ...data.slice(1 + styleCount)];
}

/** Depth-limited, circular-safe clone so JSON.stringify can never throw or run away. */
function limitDepth(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (depth <= 0) return Array.isArray(value) ? '[Array]' : '[Object]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => limitDepth(item, depth - 1, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = limitDepth(item, depth - 1, seen);
  }
  return output;
}

function post(
  serverUrl: string,
  requestOptions: http.RequestOptions,
  body: Buffer,
): http.ClientRequest {
  const urlObject = url.parse(serverUrl);
  const httpTransport = urlObject.protocol === 'https:' ? https : http;

  const options: http.RequestOptions = {
    hostname: urlObject.hostname ?? undefined,
    port: urlObject.port ?? undefined,
    path: urlObject.path ?? undefined,
    method: 'POST',
    headers: {},
  };

  Object.assign(options, requestOptions);

  const headers = (options.headers ?? {}) as Record<string, unknown>;
  headers['Content-Length'] = body.length;
  if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  options.headers = headers as http.OutgoingHttpHeaders;

  const request = httpTransport.request(options);
  request.write(body);
  request.end();

  return request;
}

/**
 * Write a diagnostic line to specific local transports WITHOUT going through
 * `electronLog.info/warn`, which would fan back out to this remote transport
 * and recurse. Never throws — diagnostics must not crash logging.
 */
function writeLocal(
  electronLog: ElectronLogLike,
  level: string,
  data: unknown[],
  transportNames: string[],
): void {
  const previousSender = electronLog.variables.sender;
  electronLog.variables.sender = 'log.remote';
  const message: RemoteLogMessage = {
    data,
    level,
    date: new Date(),
    variables: electronLog.variables,
  };
  for (const name of transportNames) {
    const transport = electronLog.transports[name];
    if (typeof transport === 'function' && transport.level !== false) {
      try {
        transport(message);
      } catch {
        // A diagnostic write must never take down the app.
      }
    }
  }
  electronLog.variables.sender = previousSender ?? 'main';
}

function remoteTransportFactory(
  electronLog: ElectronLogLike,
  defaultUrl: string | null,
): RemoteTransport {
  const transport = ((message: RemoteLogMessage): void => {
    if (!transport.url) return;

    const seen = new WeakSet<object>();
    const data = removeStyles(message.data).map((item) =>
      limitDepth(item, transport.depth + 1, seen),
    );

    const body = transport.transformBody({
      client: transport.client,
      data,
      date: (message.date instanceof Date ? message.date : new Date()).getTime(),
      level: message.level,
      variables: message.variables ?? electronLog.variables,
    });

    // Keep a local record that we're sending remotely.
    writeLocal(
      electronLog,
      'info',
      [`log.remote › sending › ${String((message.variables ?? electronLog.variables).sender)}`],
      ['file'],
    );

    const request = post(transport.url, transport.requestOptions, Buffer.from(body, 'utf8'));

    const onError = (error: Error): void => {
      writeLocal(
        electronLog,
        'warn',
        [`cannot send HTTP request to ${transport.url}`, error],
        ['console', 'file', 'ipc'],
      );
    };

    // Process the response — the whole reason for a custom transport.
    request.on('response', (response: http.IncomingMessage) => {
      response.setEncoding('utf8');
      response.on('data', () => {
        // The body is drained but unused; only the status code matters here.
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          writeLocal(
            electronLog,
            'warn',
            [`received HTTP response code ${response.statusCode} from ${transport.url}`],
            ['console', 'file', 'ipc'],
          );
        }
      });
    });

    request.on('error', transport.onError ?? onError);
  }) as RemoteTransport;

  // v5 runs `transport.transforms` before invoking the transport; we serialize
  // the payload ourselves, so leave the pipeline empty.
  transport.transforms = [];
  // NOTE: The IPC server requires an identifier to be set, otherwise logs will be rejected with a 403 error.
  transport.client = { name: 'Mechvibes' };
  transport.depth = 6;
  transport.level = false;
  transport.requestOptions = {
    method: 'LOG',
    headers: {
      'User-Agent': `Mechvibes/${app.getVersion()} (Electron/${process.versions.electron})`,
    },
  };
  transport.url = defaultUrl;
  transport.onError = null;
  transport.transformBody = (body: unknown): string => JSON.stringify(body);

  // TODO: queue messages while disabled and flush on enable; add enable()/disable().
  transport.clear = (): void => {
    throw new Error('Not implemented');
  };

  return transport;
}

export = remoteTransportFactory;
