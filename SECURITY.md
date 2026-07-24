# Security Policy

The Osler maintainers take security bugs seriously. We appreciate your efforts to responsibly disclose vulnerabilities and will make every effort to acknowledge your contributions.

## Supported Versions

Only the latest release (`main` branch) and the most recent tagged release receive security updates. Older versions are not supported — upgrade before reporting.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | ✅                  |
| latest tag | ✅               |
| < latest | ❌                |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities privately via one of:

1. **GitHub Security Advisories** (preferred): visit <https://github.com/eyad-elghareeb/osler/security/advisories/new> and click "Report a vulnerability".
2. **Email**: send details to the maintainers listed in the repository's `CODEOWNERS` file. If you cannot find an address, open a private security advisory on GitHub asking for an encrypted contact channel.

Please include the following in your report:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept if possible)
- Affected versions (commit hash or tag)
- Any mitigations you've identified
- Your contact info for follow-up

We will acknowledge receipt within **72 hours** and aim to provide an initial assessment within **7 days**. Critical vulnerabilities receive priority handling.

## Disclosure Timeline

- **Day 0**: Maintainer acknowledges receipt privately.
- **Day 1–7**: Maintainer confirms the vulnerability and triages severity (CVSS).
- **Day 7–30**: Maintainer develops and tests a fix. Reporter is kept in the loop.
- **Day 30–45**: Coordinated public disclosure. Credit is given to the reporter unless they prefer to remain anonymous.
- For critical vulnerabilities with active exploitation, this timeline may be shortened to as little as 7 days from report to public disclosure.

## Scope

The following are **in scope**:

- The Cloudflare Worker backend at `cloudflare/worker/`
- The Next.js frontend in `src/`
- The admin panel and admin API endpoints
- Authentication, session management, password handling
- Authorization (role-based access control)
- Rate limiting bypass
- Input validation bypass (XSS, SQL injection, path traversal)
- Insecure default configurations
- Sensitive data exposure (PII leak, credential leak)

The following are **out of scope**:

- Vulnerabilities in third-party dependencies (report to the upstream maintainer)
- Self-hosted deployments misconfigured by operators (e.g., weak `JWT_SECRET`, no Turnstile)
- Social engineering attacks against Osler users
- DoS attacks against Cloudflare's edge (Cloudflare handles these)
- Findings from automated scanners without a working PoC
- Theoretical vulnerabilities without a realistic attack vector

## Bug Bounty

We do not currently offer a monetary bug bounty. We will publicly credit reporters in:

- The GitHub Security Advisory
- The next release's CHANGELOG entry
- The README's "Hall of Fame" section (if you consent)

## Hardening Recommendations for Operators

If you're deploying Osler, see [`docs/security.md`](./docs/security.md) for:

- The full threat model
- Recommended hardening checklist
- Audit log review cadence
- Incident response runbooks
- Known limitations

## Contact

- Security advisories: <https://github.com/eyad-elghareeb/osler/security/advisories>
- General security questions: open a private security advisory on GitHub

## Acknowledgements

We thank the following reporters who have responsibly disclosed vulnerabilities (none reported yet — be the first!).
