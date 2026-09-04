# Security Policy

## Reporting a vulnerability

Please email security@knowall.ai with a description of the issue and steps to reproduce. Do not open a public GitHub issue for security problems. We aim to acknowledge reports within two working days.

## Scope and design

- Agents Portal holds no data of its own. Azure and Azure AI Foundry data is read live with the signed-in user's delegated tokens, so a user can never see more than Azure RBAC already allows.
- The portal has one write action: **Boost**, which runs the agent's own `boost.sh` on its VM through Azure `runCommand` using the signed-in user's ARM token. Azure RBAC (Virtual Machine Contributor or higher on the VM) decides who can use it, and every invocation is recorded in the Azure Activity Log with the caller's identity. The script path is fixed in `config/agents.json`; the API accepts only `on <hours>` / `off` / `status`.
- GitHub content (skills, SOUL.md, commits) is read with a server-side `GITHUB_TOKEN` that has _Contents: read_ only, on the agent and skill-pack repos. Everyone who can sign in sees the same GitHub content.
- Access and refresh tokens live only in the encrypted NextAuth JWT cookie and are used server-side; they are never sent to the browser.
- The only server-held secrets are the Entra app client secret and an optional read-only GitHub token.
- Values read from Azure resource tags (portal URL, repo, avatar) are treated as untrusted: only `https` URLs to public hosts are probed, repo slugs must match `owner/name`, and avatars must be same-origin paths or `https` URLs.
- Security headers (HSTS, nosniff, frame denial, referrer policy) are set for every response.

## Supported versions

Only the latest release on `main` is supported.
