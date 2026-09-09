# 3.0 beta targeted security review

Scope: targeted source review against main commit fd1656734ac9e0187c5590df4d68df6d4419caab. No version bump, new feature, dependency upgrade, release, or renderer sandbox migration.

## Changes

- Require streaming HTTP bodies rather than allocating an unbounded arrayBuffer before enforcing the byte limit. Validate limits/counters and decimal Content-Length values; check chunks before copying. Bodyless WHATWG responses remain supported.
- Fail closed when Electron IPC frames are absent or disposed. Extend the existing navigation policy to subframe navigations. This is defense in depth, not renderer isolation.
- Open profile imports nonblocking so Unix FIFOs cannot wait forever for a writer before the regular-file check. Preserve descriptor-based reads, the 64 KiB cap and handle cleanup.
- Separate installation commit from backup cleanup. A partially failed cleanup must never delete a valid new installation and restore a partially deleted backup. Failed promotion still restores the original pack. A leftover .backup-* directory may need manual removal after filesystem access recovers; discovery already ignores it.
- Add security regression tests to test:unit, so npm test / npm run verify and the existing CI matrix execute them.

## Local validation

- Node 24.14.1; TypeScript 7.0.2 targeted compilation.
- 15 targeted tests passed, including a real FIFO test in a child process with a 5-second timeout. On Windows the Unix-only FIFO test is skipped.
- Running the same tests against the original source produced 10 failures and 5 passes; after the patch all 15 pass. These are regression scenarios, not 10 independently confirmed vulnerabilities.
- Original locally reconstructed files were verified against GitHub blob hashes before editing; package.json changes only the test command.
- git diff --check passed for the source patches.

## Important limitations / follow-up

The connector did not expose the repository's Security & Quality alert list. The last beta PR's CodeQL job completed successfully, but job success does not establish that code-scanning alerts are absent. No alert IDs have been dismissed or claimed resolved. Review the new PR's security-and-quality CodeQL results and compare the open dashboard alerts before merging.

The local sandbox could not resolve github.com, so a full clone, locked dependency installation, npm audit and full npm run verify were not possible locally. The targeted compile used a local-only minimal Electron type declaration; it was not added to the repository. The actual Electron type check, full tests, dependency audit and platform builds must pass in the existing GitHub CI. Do not treat the targeted checks as a complete application audit.

Native Electron GUI/audio behavior, profile dialogs, installation recovery and Windows/macOS/Linux smoke tests still need target-machine acceptance. Legacy renderers retain nodeIntegration and @electron/remote; moving to context isolation and a sandbox is a separate, larger change. Archive decompression and all filesystem race surfaces were not exhaustively audited in this patch.
