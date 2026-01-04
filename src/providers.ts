export type Organization = {
  id: string;
  name: string;
  notes?: string;
};

export const ORGANIZATIONS: Organization[] = [];

export const ORGANIZATION_BY_ID = new Map(
  ORGANIZATIONS.map((organization) => [organization.id, organization]),
);
