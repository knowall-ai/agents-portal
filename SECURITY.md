# Security Policy

## Reporting a vulnerability

We take the security of the Agents Portal seriously. It signs in with customers' Microsoft accounts, reads their Azure estate and Entra directory with delegated tokens, and holds one write action (Boost) that runs a script on an agent's VM, so a report is treated as a priority.

**Please do not open a public GitHub issue for a security vulnerability.**

Report it privately instead:

| Channel | Details                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email   | [security@knowall.ai](mailto:security@knowall.ai)                                                                                                |
| GitHub  | [Report a vulnerability](https://github.com/knowall-ai/agents-portal/security/advisories/new) (private advisory, once enabled on the repository) |

When reporting, please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce; proof-of-concept requests are welcome
- The component affected (sign-in and session, an `/api` route, the Brain stream, Boost, the Azure or Graph providers, or a deployment setting)
- Any suggested remediation, if you have one

## What to expect

- **Acknowledgement** within two working days of your report.
- **Assessment and triage**: we confirm the issue, assess severity, and keep you informed of progress.
- **Fix and disclosure**: we aim to remediate confirmed vulnerabilities promptly, publish a GitHub security advisory for anything that affects other deployments, and credit reporters (with permission) once a fix is released. We ask for up to 90 days from acknowledgement before public disclosure.

We ask that you practise responsible disclosure: give us reasonable time to fix the issue before any public disclosure, test only against your own tenant, deployment or agents, and do not access, modify or exfiltrate data beyond what is necessary to demonstrate the vulnerability.

## Of particular interest

- Signing in from a tenant that is not allowed, or seeing an agent, cost, licence or permission that Azure RBAC does not grant the signed-in user
- Any way to reach a server-held token (`REVERIE_TOKEN`, `GITHUB_TOKEN`, the app client secret) or to have it sent somewhere other than its intended host
- Reaching Boost, or any other run-command on a VM, without the Azure role that permits it, or without the request appearing in the Activity Log under the caller's identity
- Server-side request forgery through resource tags, registry values or the health probe
- Cross-site requests that change state (Boost, tenant selection) or leak data

## Scope and design

- Agents Portal holds no data of its own. Azure and Azure AI Foundry data is read live with the signed-in user's delegated tokens, so a user can never see more than Azure RBAC already allows.
- The portal has one write action: **Boost**, which runs the agent's own `boost.sh` on its VM through Azure `runCommand` using the signed-in user's ARM token. Azure RBAC (Virtual Machine Contributor or higher on the VM) decides who can use it, and every invocation is recorded in the Azure Activity Log with the caller's identity. The script path is fixed in `config/agents.json`; the API accepts only `on <hours>` / `off` / `status`.
- The Brain tab reads each agent's Reverie graph through a read-only API on the agent VM with a server-side `REVERIE_TOKEN`. The token is only ever sent to the `brainUrl` in `config/agents.json`, never to a URL taken from an Azure tag, and the API cannot change the graph.
- GitHub content (skills, SOUL.md, commits) is read with a server-side `GITHUB_TOKEN` that has _Contents: read_ only, on the agent and skill-pack repos. Everyone who can sign in sees the same GitHub content.
- Sign-in is limited to the tenants in `AZURE_AD_ALLOWED_TENANTS` (or the home tenant); registry settings that spend server-held tokens (brain URL, repo, boost script) only apply to agents whose Azure resources the caller can see.
- Access and refresh tokens live only in the encrypted NextAuth JWT cookie and are used server-side; they are never sent to the browser.
- The only server-held secrets are the Entra app client secret, an optional read-only GitHub token and the optional `REVERIE_TOKEN` for agents' Brain streams.
- Values read from Azure resource tags (portal URL, repo, avatar) are treated as untrusted: only `https` URLs to public hosts are probed, repo slugs must match `owner/name`, and avatars must be same-origin paths or `https` URLs.
- Security headers (HSTS, nosniff, frame denial, referrer policy) are set for every response.

## Supported versions

Only the latest release on `main` is supported.
