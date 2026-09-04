import { redirect } from 'next/navigation';

/** The agent list lives on the home page; keep old /agents links working. */
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(key, value);
  }
  redirect(params.toString() ? `/?${params}` : '/');
}
