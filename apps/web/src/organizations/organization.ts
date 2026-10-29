export type Organization = {
  id: string
  name: string
  slug: string
  country_code: string
  base_currency: string
  timezone: string
  allow_negative_stock: boolean
}

export function chooseActiveOrganization(
  organizations: Organization[],
  preferredId: string | null | undefined,
): Organization | null {
  if (organizations.length === 0) return null

  if (preferredId) {
    const preferred = organizations.find((organization) => organization.id === preferredId)
    if (preferred) return preferred
  }

  return organizations[0] ?? null
}

export function suggestOrganizationSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}
