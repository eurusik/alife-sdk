# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Yes    |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues by emailing the maintainer directly or by using
[GitHub Private Vulnerability Reporting](https://github.com/eurusik/alife-sdk/security/advisories/new).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive a response within 72 hours. If the issue is confirmed, a patch
will be released as soon as possible and you will be credited in the release notes.

## Scope

This is a client-side game SDK — it runs in Node.js or the browser and has no
network-facing components, no server, and no credential handling. The attack
surface is limited to:

- Malicious serialized state passed to `kernel.restoreState()` (deserialization)
- Plugin code executed via `kernel.use()` (trusted by design — plugins are developer code)

Dependencies are minimal (zero runtime deps in `@alife-sdk/core`).
