'use strict';

/**
 * We are overriding the default electron-log remote transport
 * because it doesn't process HTTP response codes,
 * which is a problem.
 */

import { app } from 'electron';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

const transform = require('electron-log/src/transform') as {
  transform(message: unknown, factories: unknown[]): unknown;
  removeStyles: unknown;
  toJSON: unknown;
  maxDepthFactory(depth: number): unknown;
};

export interface RemoteLogMessage {
  date: Date;
  level: string;
  variables: Record<string, unknown> & { sender?: string };
  data: unknown[];
}

export interface ElectronLogLike {
  variables: Record<string, unknown> & { sender?: string };
  transports: Record<string, unknown>;
  logMessageWithTransports(
    message: { data: unknown; level: string },
    transports: unknown[],
  ): void;
}

export interface RemoteTransport {
  (message: RemoteLogMessage): void;
  client: { name: string };
  depth: number;
  level: string | false;
  requestOptions: http.RequestOptions;
  url: string | null;
  onError: ((error: Error) => void) | null;
  transformBody: (body: unknown) => string;
  clear: () => void;
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

function remoteTransportFactory(
  electronLog: ElectronLogLike,
  defaultUrl: string | null,
): RemoteTransport {
  const transport = ((message: RemoteLogMessage): void => {
    if (!transport.url) return;

    const data = transform.transform(message, [
      transform.removeStyles,
      transform.toJSON,
      transform.maxDepthFactory(transport.depth + 1),
    ]);

    const body = transport.transformBody({
      client: transport.client,
      data,
      date: message.date.getTime(),
      level: message.level,
      variables: message.variables,
    });

    // log the fact we're sending messages remotely to the local log, so there's a record of it
    electronLog.variables['sender'] = `log.remote › sending › ${String(message.variables['sender'])}`;
    electronLog.logMessageWithTransports({ data, level: 'info' }, [
      electronLog.transports['file'],
    ]);
    electronLog.variables['sender'] = 'main';

    const request = post(transport.url, transport.requestOptions, Buffer.from(body, 'utf8'));

    // default error handler
    const onError = (error: Error): void => {
      electronLog.variables['sender'] = 'log.remote';
      electronLog.logMessageWithTransports(
        {
          data: [`cannot send HTTP request to ${transport.url}`, error],
          level: 'warn',
        },
        [
          electronLog.transports['console'],
          electronLog.transports['ipc'],
          electronLog.transports['file'],
        ],
      );
      electronLog.variables['sender'] = 'main';
    };

    // process the response
    request.on('response', (response: http.IncomingMessage) => {
      response.setEncoding('utf8');
      response.on('data', () => {
        // The body is drained but unused; only the status code matters here.
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          electronLog.variables['sender'] = 'log.remote';
          electronLog.logMessageWithTransports(
            {
              data: [
                `received HTTP response code ${response.statusCode} from ${transport.url}`,
              ],
              level: 'warn',
            },
            [
              electronLog.transports['console'],
              electronLog.transports['ipc'],
              electronLog.transports['file'],
            ],
          );
          electronLog.variables['sender'] = 'main';
        }
      });
    });

    // handle errors
    request.on('error', transport.onError || onError);
  }) as RemoteTransport;

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

  // TODO: Add a queue to store messages while the transport is disabled, and send them when it's enabled
  // TODO: transport.enable() and transport.disable() methods
  transport.clear = (): void => {
    throw new Error('Not implemented');
  };

  return transport;
}

export = remoteTransportFactory;
