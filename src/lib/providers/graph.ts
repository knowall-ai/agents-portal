// Microsoft Graph: licences assigned to an agent's own Entra account.
import type {
  AgentAccountAccess,
  AgentAppAccess,
  AgentLicense,
  AgentLicensing,
  PermissionItem,
} from '@/types';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Friendly names for common SKU part numbers (Graph only returns the part number). */
const SKU_NAMES: Record<string, string> = {
  ENTERPRISEPACK: 'Office 365 E3',
  ENTERPRISEPREMIUM: 'Office 365 E5',
  STANDARDPACK: 'Office 365 E1',
  SPE_E3: 'Microsoft 365 E3',
  SPE_E5: 'Microsoft 365 E5',
  SPE_F1: 'Microsoft 365 F3',
  DEVELOPERPACK_E5: 'Microsoft 365 E5 Developer',
  O365_BUSINESS_ESSENTIALS: 'Microsoft 365 Business Basic',
  O365_BUSINESS_PREMIUM: 'Microsoft 365 Business Standard',
  SPB: 'Microsoft 365 Business Premium',
  EXCHANGESTANDARD: 'Exchange Online (Plan 1)',
  EXCHANGEENTERPRISE: 'Exchange Online (Plan 2)',
  EXCHANGEDESKLESS: 'Exchange Online Kiosk',
  TEAMS_ESSENTIALS_AAD: 'Microsoft Teams Essentials',
  TEAMS_EXPLORATORY: 'Microsoft Teams Exploratory',
  Teams_Premium: 'Microsoft Teams Premium',
  MCOEV: 'Microsoft Teams Phone Standard',
  MCOCAP: 'Microsoft Teams Shared Devices',
  MCOMEETADV: 'Microsoft 365 Audio Conferencing',
  MCOPSTN1: 'Microsoft Teams Domestic Calling Plan',
  MCOPSTN2: 'Microsoft Teams International Calling Plan',
  MCOPSTN5: 'Microsoft Teams Domestic Calling Plan (120 min)',
  PHONESYSTEM_VIRTUALUSER: 'Microsoft Teams Phone Resource Account',
  Microsoft_365_Copilot: 'Microsoft 365 Copilot',
  FLOW_FREE: 'Power Automate Free',
  FLOW_PER_USER: 'Power Automate per user',
  POWERAPPS_PER_USER: 'Power Apps per user',
  POWER_BI_STANDARD: 'Power BI (free)',
  POWER_BI_PRO: 'Power BI Pro',
  CCIBOTS_PRIVPREV_VIRAL: 'Copilot Studio Viral Trial',
  DYN365_BUSCENTRAL_TEAM_MEMBER: 'Dynamics 365 Business Central Team Member',
  DYN365_BUSCENTRAL_ESSENTIAL: 'Dynamics 365 Business Central Essentials',
  DYN365_BUSCENTRAL_PREMIUM: 'Dynamics 365 Business Central Premium',
  AAD_PREMIUM: 'Microsoft Entra ID P1',
  AAD_PREMIUM_P2: 'Microsoft Entra ID P2',
  EMS: 'Enterprise Mobility + Security E3',
  EMSPREMIUM: 'Enterprise Mobility + Security E5',
  VISIOCLIENT: 'Visio Plan 2',
  PROJECTPROFESSIONAL: 'Project Plan 3',
  WIN10_PRO_ENT_SUB: 'Windows 10/11 Enterprise E3',
};

/** Service plans worth surfacing as capabilities; everything else is counted, not listed. */
const PLAN_NAMES: Record<string, string> = {
  TEAMS1: 'Teams',
  MCOSTANDARD: 'Teams calling',
  MCOEV: 'Phone System',
  MCOEV_VIRTUALUSER: 'Phone System',
  MCOPSTN1: 'Calling plan',
  MCOPSTN2: 'Calling plan',
  MCOMEETADV: 'Audio conferencing',
  EXCHANGE_S_ENTERPRISE: 'Exchange mailbox',
  EXCHANGE_S_STANDARD: 'Exchange mailbox',
  EXCHANGE_S_DESKLESS: 'Exchange mailbox',
  SHAREPOINTENTERPRISE: 'SharePoint & OneDrive',
  SHAREPOINTSTANDARD: 'SharePoint & OneDrive',
  OFFICESUBSCRIPTION: 'Microsoft 365 Apps',
  FLOW_O365_P2: 'Power Automate',
  FLOW_O365_P1: 'Power Automate',
  POWERAPPS_O365_P2: 'Power Apps',
  POWERAPPS_O365_P1: 'Power Apps',
  Bing_Chat_Enterprise: 'Copilot Chat',
  BI_AZURE_P0: 'Power BI',
  BI_AZURE_P2: 'Power BI',
  MICROSOFTBOOKINGS: 'Bookings',
  FORMS_PLAN_E3: 'Forms',
  DYN365_FINANCIALS_TEAM_MEMBERS: 'Business Central',
  DYN365_FINANCIALS_BUSINESS: 'Business Central',
  FLOW_CCI_BOTS: 'Copilot Studio',
  PURVIEW_DISCOVERY: 'Purview',
};

export function friendlySkuName(skuPartNumber: string): string {
  return SKU_NAMES[skuPartNumber] ?? skuPartNumber.replace(/_/g, ' ');
}

interface RawPlan {
  servicePlanName: string;
  provisioningStatus: string;
}

/** Deduplicated capability labels for the successfully provisioned plans, plus the count of the rest. */
export function summarisePlans(plans: RawPlan[]): { capabilities: string[]; otherPlans: number } {
  const active = plans.filter((p) => p.provisioningStatus === 'Success');
  const capabilities = [
    ...new Set(active.map((p) => PLAN_NAMES[p.servicePlanName]).filter((n): n is string => !!n)),
  ];
  const named = active.filter((p) => PLAN_NAMES[p.servicePlanName]).length;
  return { capabilities, otherPlans: active.length - named };
}

async function graphJson<T>(token: string, path: string): Promise<T> {
  const response = await fetch(path.startsWith('https://') ? path : `${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Graph ${response.status} ${path}`);
  return response.json() as Promise<T>;
}

/** Every page of a Graph collection, following `@odata.nextLink` until it runs out. */
async function graphList<T>(token: string, path: string, maxPages = 20): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;
  for (let page = 0; next && page < maxPages; page++) {
    const result: { value: T[]; '@odata.nextLink'?: string } = await graphJson(token, next);
    items.push(...result.value);
    next = result['@odata.nextLink'];
  }
  return items;
}

interface RawLicense {
  skuId: string;
  skuPartNumber: string;
  servicePlans: RawPlan[];
}

export interface UserPhoto {
  contentType: string;
  base64: string;
}

/** The account's profile photo, or null when it has none (Graph answers 404). */
export async function getUserPhoto(token: string, upn: string): Promise<UserPhoto | null> {
  const response = await fetch(`${GRAPH}/users/${encodeURIComponent(upn)}/photo/$value`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Graph ${response.status} photo`);
  const contentType = response.headers.get('content-type') ?? 'image/jpeg';
  if (!contentType.startsWith('image/')) return null;
  return { contentType, base64: Buffer.from(await response.arrayBuffer()).toString('base64') };
}

/** Account state and assigned licences for a user principal name. */
export async function getUserLicensing(
  token: string,
  upn: string
): Promise<Pick<AgentLicensing, 'displayName' | 'accountEnabled' | 'usageLocation' | 'licenses'>> {
  const user = encodeURIComponent(upn);
  const [account, details] = await Promise.all([
    graphJson<{ displayName?: string; accountEnabled?: boolean; usageLocation?: string }>(
      token,
      `/users/${user}?$select=displayName,accountEnabled,usageLocation`
    ),
    graphJson<{ value: RawLicense[] }>(token, `/users/${user}/licenseDetails`),
  ]);
  const licenses: AgentLicense[] = details.value
    .map((l) => ({
      skuId: l.skuId,
      skuPartNumber: l.skuPartNumber,
      name: friendlySkuName(l.skuPartNumber),
      ...summarisePlans(l.servicePlans ?? []),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    displayName: account.displayName,
    accountEnabled: account.accountEnabled,
    usageLocation: account.usageLocation,
    licenses,
  };
}

// ---------------------------------------------------------------------------
// Permissions: what the agent's account and app registrations can do
// ---------------------------------------------------------------------------

interface DirectoryObject {
  '@odata.type': string;
  id: string;
  displayName?: string;
  description?: string;
}

/** Directory roles and group memberships of the agent's own account. */
export async function getUserAccess(
  token: string,
  upn: string
): Promise<Pick<AgentAccountAccess, 'objectId' | 'directoryRoles' | 'groups'>> {
  const user = encodeURIComponent(upn);
  const [account, memberOf] = await Promise.all([
    graphJson<{ id: string }>(token, `/users/${user}?$select=id`),
    graphList<DirectoryObject>(
      token,
      `/users/${user}/memberOf?$select=id,displayName,description&$top=999`
    ),
  ]);
  const toItem = (o: DirectoryObject, kind: PermissionItem['kind']): PermissionItem => ({
    id: o.id,
    name: o.displayName ?? o.id,
    kind,
    description: o.description || undefined,
    resource: 'Microsoft Entra ID',
  });
  const byName = (a: PermissionItem, b: PermissionItem) => a.name.localeCompare(b.name);
  return {
    objectId: account.id,
    directoryRoles: memberOf
      .filter((o) => o['@odata.type'] === '#microsoft.graph.directoryRole')
      .map((o) => toItem(o, 'directory-role'))
      .sort(byName),
    groups: memberOf
      .filter((o) => o['@odata.type'] === '#microsoft.graph.group')
      .map((o) => toItem(o, 'group'))
      .sort(byName),
  };
}

export interface RequiredResourceAccess {
  resourceAppId: string;
  resourceAccess: { id: string; type: 'Scope' | 'Role' }[];
}

export interface ResourceServicePrincipal {
  id: string;
  appId: string;
  displayName: string;
  oauth2PermissionScopes: {
    id: string;
    value: string;
    adminConsentDisplayName?: string;
    adminConsentDescription?: string;
  }[];
  appRoles: { id: string; value?: string; displayName?: string; description?: string }[];
}

export interface Oauth2Grant {
  resourceId: string;
  scope: string;
}

export interface AppRoleAssignment {
  resourceId: string;
  appRoleId: string;
}

/**
 * Turn an app's required permissions into explained rows, marking each as
 * granted when the tenant has consented (delegated) or assigned it (application).
 * Pure; exported for unit tests.
 */
export function buildAppPermissionItems(
  required: RequiredResourceAccess[],
  resources: Map<string, ResourceServicePrincipal>,
  grants: Oauth2Grant[],
  assignments: AppRoleAssignment[]
): PermissionItem[] {
  const items: PermissionItem[] = [];
  for (const block of required) {
    const resource = resources.get(block.resourceAppId);
    const resourceName = resource?.displayName ?? block.resourceAppId;
    const consented = new Set(
      grants
        .filter((g) => resource && g.resourceId === resource.id)
        .flatMap((g) => g.scope.split(' ').filter(Boolean))
    );
    for (const access of block.resourceAccess) {
      if (access.type === 'Scope') {
        const scope = resource?.oauth2PermissionScopes.find((s) => s.id === access.id);
        items.push({
          id: `${block.resourceAppId}:${access.id}`,
          name: scope?.value ?? access.id,
          kind: 'delegated',
          description: scope?.adminConsentDescription || scope?.adminConsentDisplayName,
          resource: resourceName,
          granted: scope ? consented.has(scope.value) : false,
        });
      } else {
        const role = resource?.appRoles.find((r) => r.id === access.id);
        items.push({
          id: `${block.resourceAppId}:${access.id}`,
          name: role?.value ?? role?.displayName ?? access.id,
          kind: 'application',
          description: role?.description,
          resource: resourceName,
          granted: assignments.some(
            (a) => a.appRoleId === access.id && (!resource || a.resourceId === resource.id)
          ),
        });
      }
    }
  }
  return items.sort(
    (a, b) =>
      (a.resource ?? '').localeCompare(b.resource ?? '') ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name)
  );
}

const resourceSpCache = new Map<string, { value: ResourceServicePrincipal; expires: number }>();

async function getResourceServicePrincipal(
  token: string,
  appId: string
): Promise<ResourceServicePrincipal | undefined> {
  const hit = resourceSpCache.get(appId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const result = await graphJson<{ value: ResourceServicePrincipal[] }>(
    token,
    `/servicePrincipals?$filter=appId eq '${appId}'&$select=id,appId,displayName,oauth2PermissionScopes,appRoles`
  );
  const sp = result.value[0];
  if (sp) resourceSpCache.set(appId, { value: sp, expires: Date.now() + 60 * 60 * 1000 });
  return sp;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Required permissions of an app registration and whether each is granted in this tenant. */
export async function getAppAccess(
  token: string,
  appId: string,
  label?: string
): Promise<Omit<AgentAppAccess, 'azureRoles'>> {
  if (!GUID.test(appId)) throw new Error(`Invalid app id: ${appId}`);
  const base = { appId, displayName: label ?? appId, label, permissions: [] as PermissionItem[] };
  const [apps, sps] = await Promise.all([
    graphJson<{
      value: { displayName: string; requiredResourceAccess: RequiredResourceAccess[] }[];
    }>(
      token,
      `/applications?$filter=appId eq '${appId}'&$select=displayName,requiredResourceAccess`
    ),
    graphJson<{ value: { id: string; displayName: string }[] }>(
      token,
      `/servicePrincipals?$filter=appId eq '${appId}'&$select=id,displayName`
    ),
  ]);
  const app = apps.value[0];
  const sp = sps.value[0];
  if (!app && !sp) {
    return { ...base, error: 'App registration not found in this tenant' };
  }
  const required = app?.requiredResourceAccess ?? [];
  const [grants, assignments, resourceList] = await Promise.all([
    sp
      ? graphJson<{ value: Oauth2Grant[] }>(
          token,
          `/servicePrincipals/${sp.id}/oauth2PermissionGrants`
        )
      : Promise.resolve({ value: [] as Oauth2Grant[] }),
    sp
      ? graphJson<{ value: AppRoleAssignment[] }>(
          token,
          `/servicePrincipals/${sp.id}/appRoleAssignments`
        )
      : Promise.resolve({ value: [] as AppRoleAssignment[] }),
    Promise.all(
      [...new Set(required.map((r) => r.resourceAppId))].map((id) =>
        getResourceServicePrincipal(token, id)
      )
    ),
  ]);
  const resources = new Map<string, ResourceServicePrincipal>();
  for (const r of resourceList) if (r) resources.set(r.appId, r);
  return {
    ...base,
    displayName: app?.displayName ?? sp?.displayName ?? base.displayName,
    servicePrincipalId: sp?.id,
    permissions: buildAppPermissionItems(required, resources, grants.value, assignments.value),
  };
}
