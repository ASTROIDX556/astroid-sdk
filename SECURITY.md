# Security Policy

Astroid is financial infrastructure for autonomous AI agents. We take security
seriously and appreciate responsible disclosure.

## Supported Versions

The SDK follows Semantic Versioning. Security fixes are released for the latest
minor of the current major. During the `0.x` phase, please track the latest
release.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security reports.**

Email `security@astroid.dev` with:

- A description of the vulnerability and its impact
- Steps to reproduce (proof of concept if possible)
- Affected package(s) and version(s)

We aim to acknowledge reports within 48 hours and to provide a remediation
timeline within five business days.

## Scope & handling guidance

- **Never commit secrets.** API keys, Stellar signing material, and webhook
  secrets must not appear in source, tests, or examples.
- **Webhook verification.** Always verify webhook signatures with
  `webhook.verifySignature(...)` (constant-time HMAC-SHA256) before trusting a
  payload. The SDK never trusts an unverified event.
- **Secret redaction.** The SDK does not log request bodies, `Authorization`
  headers, or API keys. Please keep it that way in contributions.
- **Least privilege.** Scope API keys to the minimum permissions required.

Thank you for helping keep the Astroid ecosystem safe.
