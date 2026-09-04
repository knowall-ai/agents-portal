// Microsoft Graph: licences assigned to an agent's own Entra account.
import type { AgentLicense, AgentLicensing } from '@/types';

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
  const response = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Graph ${response.status} ${path}`);
  return response.json() as Promise<T>;
}

interface RawLicense {
  skuId: string;
  skuPartNumber: string;
  servicePlans: RawPlan[];
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
