# Security

## Reporting a vulnerability

Do not include private logs, credentials or working exploit details in a public
issue. Use GitHub's **Security → Report a vulnerability** if private reporting is
available for this repository. If it is not available, open a minimal issue
asking the maintainer for a private contact channel, without vulnerability details.

## Current trust boundary

Mechvibes is a desktop application with global keyboard/mouse hooks. Renderers
currently use `nodeIntegration: true`, `contextIsolation: false` and
`@electron/remote` for compatibility with the audio engine and editor. They are
**not sandboxed**. The navigation guards and CSP are defense in depth, not a
replacement for an isolated, narrow preload API. Do not load untrusted HTML or
remote application code into these windows.

- Window navigation, redirects, popups, frames and webviews are blocked.
- Application external links are routed through a checked IPC handler and allow
  only ordinary HTTP(S) URLs; custom OS protocols, local files and credentials in
  URLs are rejected.
- Privileged IPC checks both the owning window and its main frame.
- Soundpack paths, extensions, config and byte limits are validated. ZIPs with
  duplicate case-insensitive file paths are rejected. These checks reduce risk
  but do not guarantee that every supported audio decoder is vulnerability-free.
- Do not disable `webSecurity` to troubleshoot a blank window.

## Privacy

The application no longer contacts the remote-debug status endpoint on every
renderer startup. Opening **Advanced** does not opt into remote debugging.
Enabling remote debugging explicitly sends the hostname, OS username, platform,
app version and diagnostic logs to the existing `beta.mechvibes.com` service.
The preference is persisted; turn it off when the support session ends.
Disabling stops future logging, but does not promise deletion of logs already
received by that third-party service.

Update checks and user-requested soundpack downloads still make network requests.
`npm run diagnose` writes a local report that can contain installation paths and
log excerpts. Review/redact it before sharing. Never commit it to the repository.

## Follow-up work

Migrate filesystem access, settings and pack management behind a typed,
context-isolated preload bridge, then remove `@electron/remote`. This is a
separate architecture change requiring native audio/editor integration tests;
it has not been claimed complete by the current modernization work.
