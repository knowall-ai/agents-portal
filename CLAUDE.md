# CLAUDE.md - Agents Portal Project Guidelines

This document provides guidance for AI assistants (like Claude) working on the Agents Portal project.

## Project Overview

Agents Portal monitors the AI agents KnowAll AI builds and runs for itself and its customers (Sallie, Zaplie, Winnie for the Irish FA, and whatever gets tagged next). It discovers agents from Azure, derives their status, and shows skills and recent activity. It is a sibling of ZapDesk and Thyme and shares their stack and branding.

## Architecture

### Tech Stack

- **Frontend**: Next.js 16 with App Router, React 19, TypeScript
- **Runtime**: Node.js (production), Bun (local development)
- **Package Manager**: Bun
- **Styling**: Tailwind CSS 4 with CSS variables for theming (same palette as ZapDesk)
- **Authentication**: NextAuth.js with Azure AD provider (multi-tenant)
- **Data**: Azure Resource Graph, Azure Activity Log, Azure AI Foundry Assistants API, GitHub REST API, Microsoft Graph
- **Deployment**: Azure App Service

### Key Concepts

- **Agent** = a group of Azure resources (VM, App Service, Bot Service, AI Services account, …) that share an `agent` tag or a resource group claimed in `config/agents.json`
- **Kind** = how the agent is built: `openclaw` (VM-hosted OpenClaw gateway), `foundry` (Azure AI Foundry assistants), `botframework` (Teams bot)
- **Status** = derived from compute state (`src/lib/agents/discover.ts` → `deriveStatus`) and downgraded to `degraded` if the portal probe fails
- **Skills** = `SKILL.md` folders in the agent's GitHub repo, plus shared skill packs listed in `skillSources` (local skills shadow same-named plugin skills), plus tools on its Foundry assistants
- **Licences** = Microsoft licences on the agent's own Entra account (`teamsUpn`, via Graph `User.Read.All`) plus `fixedCosts` subscriptions from the registry
- **Soul** = the agent's `SOUL.md` (`soulPath`, default `workspace/SOUL.md` then `SOUL.md`) rendered on its page
- **Activity** = Azure Activity Log + GitHub commits + Foundry runs, merged and sorted
- **Costs** = Azure Cost Management by resource group (user token) + OpenAI/Anthropic admin cost APIs by project/workspace mapping + `fixedCosts` from the registry; aggregation is pure in `src/lib/agents/costs.ts`
- **Tenant** = the Entra tenant the user signed in to. Azure Resource Graph returns every subscription the user's ARM token can read, which includes subscriptions delegated via Azure Lighthouse

### Token Flow

1. Sign-in requests `https://management.azure.com/user_impersonation` (ARM) plus OpenID scopes
2. The ARM token is stored in the NextAuth JWT and used for Resource Graph / Activity Log
3. Tokens for other resources (AI Foundry `https://ai.azure.com/.default`, Microsoft Graph) are obtained server-side by exchanging the refresh token — see `src/lib/tokens.ts`
4. The tenant switcher sets a cookie read by the NextAuth route so the next sign-in targets that tenant's authority

## Code Style Guidelines

### TypeScript

- Use strict TypeScript with explicit types
- Prefer interfaces over types for object shapes
- Export shared types from `@/types/index.ts`

### React Components

- Functional components with hooks; `'use client'` for interactive components
- Use CSS variables from `globals.css` for colours (`var(--primary)`, `var(--text-secondary)`, …)
- Data fetching goes through `useApi` (`src/hooks/useApi.ts`) with polling where useful

### File Organization

```
src/
├── app/            # Pages and API routes
├── components/
│   ├── layout/     # Sidebar, Header, TenantSwitcher, MainLayout
│   ├── common/     # Badges, Avatar, LoadingSpinner, EmptyState, icon
│   └── agents/     # AgentCard, ResourceTable, SkillList, ActivityFeed
├── hooks/
├── lib/
│   ├── agents/     # discover.ts (pure logic, unit-tested) + service.ts (composition, caching)
│   └── providers/  # azure.ts, foundry.ts, github.ts, health.ts
└── types/
```

### Naming Conventions

- **Files**: PascalCase for components, kebab-case otherwise
- **CSS variables**: `--status-<status>`, `--kind-<kind>`

## Development Guidelines

### Adding a Data Source

1. Add a provider in `src/lib/providers/`
2. Compose it in `src/lib/agents/service.ts` (wrap in `cached()` and catch errors so one failing source never blanks the page)
3. Extend the types in `src/types/index.ts`
4. Render it in `src/components/agents/`

### Adding a Status or Kind

1. Extend `AgentStatus` / `AgentKind` in `src/types/index.ts`
2. Add `--status-*` / `--kind-*` variables and badge classes in `src/app/globals.css`
3. Update `StatusBadge` / `KindBadge` labels and `STATUS_ORDER` in `discover.ts`

### Error Handling

- API routes return 401 when unauthenticated, 404 for unknown agents, 502 when an upstream call fails
- Providers log with `console.warn` and return empty arrays so partial data still renders
- Never log tokens; `redactSensitive` in `src/lib/auth.ts` scrubs NextAuth logs

### Security

- **Do not put email addresses in the public repo** — use generic references
- Do not commit `.env`; the app registration secret lives in App Service settings / GitHub secrets
- All upstream calls use the signed-in user's own tokens — the dashboard never has more access than the user

## Testing

```bash
bun run test:unit    # Vitest — discovery and status logic
bun run test         # Playwright — login page, landing page, API auth guards
```

When adding Playwright tests, extend the existing spec files rather than creating new ones per feature, avoid hard-coded timeouts, and take screenshots at key points.

## Code Quality & CI/CD

**ALWAYS run `bun run check` before pushing.** CI runs lint, format, typecheck, unit tests and build on every PR to `main`; PR titles must use a conventional-commit prefix and the body needs a `## Test plan` (see `.github/workflows/pr-lint.yml`). All of these are required checks on `main`, plus one approving review.

```bash
bun run check          # All checks
bun run format         # Auto-format
bun run lint:fix       # Auto-fix lint
```

## Environment Variables

| Variable                 | Description                                           | Required                      |
| ------------------------ | ----------------------------------------------------- | ----------------------------- |
| `NEXTAUTH_URL`           | Base URL of the application                           | Yes                           |
| `NEXTAUTH_SECRET`        | Secret for NextAuth encryption                        | Yes                           |
| `AZURE_AD_CLIENT_ID`     | Entra app registration client ID                      | Yes                           |
| `AZURE_AD_CLIENT_SECRET` | Entra app registration client secret                  | Yes                           |
| `AZURE_AD_TENANT_ID`     | Default sign-in tenant (`common` for multi-tenant)    | No (default: `common`)        |
| `GITHUB_TOKEN`           | Token with Contents: read on agent + skill-pack repos | For private repos             |
| `OPENAI_ADMIN_KEY`       | OpenAI organisation admin key (cost report)           | For OpenAI API spend          |
| `ANTHROPIC_ADMIN_KEY`    | Anthropic organisation admin key (cost report)        | For Anthropic API spend       |
| `AGENT_TAG_KEYS`         | Comma-separated tag keys that name an agent           | No (default: `agent,project`) |
| `CACHE_TTL_SECONDS`      | Cache TTL for Azure / GitHub / Foundry lookups        | No (default: 60)              |

## Deployment

Releases are tagged with `bun pm version` and deployed by `.github/workflows/deploy.yml` to the `agent-dashboard-knowallai` App Service at https://agents.knowall.ai. See `docs/DEPLOYMENT.adoc`.

## Troubleshooting

See `docs/TROUBLESHOOTING.adoc`. When you resolve an issue that admins or users might hit, add a Problem/Solution row there.

## Contact

- **Project Owner**: KnowAll AI
- **Repository**: https://github.com/knowall-ai/agents-portal
- **Support**: support@knowall.ai
