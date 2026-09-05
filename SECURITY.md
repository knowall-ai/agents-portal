# Security Policy

## Reporting a vulnerability

Please email security@knowall.ai with a description of the issue and steps to reproduce. Do not open a public GitHub issue for security problems. We aim to acknowledge reports within two working days.

## Scope and design

- Agents Portal persists no data of its own — no database, nothing written to disk; what it reads is held only in a short-lived in-memory cache. Azure and Azure AI Foundry data is read live with the signed-in user's delegated tokens, so a user can never see more than Azure RBAC already allows.
- The portal has one write action: **Boost**, which runs the agent's own `boost.sh` on its VM through Azure `runCommand` using the signed-in user's ARM token. Azure RBAC (Virtual Machine Contributor or higher on the VM) decides who can use it, and every invocation is recorded in the Azure Activity Log with the caller's identity. The script path is fixed in `config/agents.json`; the API accepts only `on <hours>` / `off` / `status`.
- The Brain tab reads each agent's Reverie graph through a read-only API on the agent VM with a server-side `REVERIE_TOKEN`. The token is only ever sent to the `brainUrl` in `config/agents.json`, never to a URL taken from an Azure tag, and the API cannot change the graph.
- GitHub content (skills, SOUL.md, commits) is read with a server-side `GITHUB_TOKEN` that has _Contents: read_ only, on the agent and skill-pack repos. Everyone who can sign in sees the same GitHub content.
- Sign-in is limited to the tenants in `AZURE_AD_ALLOWED_TENANTS` (or the home tenant when `AZURE_AD_TENANT_ID` names one). A production deployment must set `AZURE_AD_ALLOWED_TENANTS`: with the multi-tenant authority `common` and no allow-list there is nothing to check a tenant against, so sign-in is refused outright.
- Registry settings that spend server-held tokens (brain URL, repo) only apply to agents whose Azure resources the caller can see, and only inside the scope the entry claims — the subscriptions in its `subscriptionIds`, or the registry's own tenant. The boost script path is fixed in the registry the same way, but running it spends no server-held token: it is an Azure `runCommand` made with the signed-in user's own ARM token.
- Access and refresh tokens live only in the encrypted NextAuth JWT cookie and are used server-side; they are never sent to the browser.
- The server-held secrets are the Entra app client secret, an optional read-only `GITHUB_TOKEN`, the optional `REVERIE_TOKEN` for agents' Brain streams and the optional provider admin keys `OPENAI_ADMIN_KEY` and `ANTHROPIC_ADMIN_KEY`, which are used only to read organisation cost reports from OpenAI and Anthropic. They live in App Service settings, never in the repo.
- Values read from Azure resource tags (portal URL, repo, avatar) are treated as untrusted: only `https` URLs to public hosts are probed, repo slugs must match `owner/name`, and avatars must be same-origin paths or `https` URLs.
- Security headers (HSTS, nosniff, frame denial, referrer policy) are set for every response.

## Supported versions

Only the latest release on `main` is supported.
