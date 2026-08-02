export type CompanyLogoAssetSource = {
  iconUrl: string | null;
  logoUrl: string | null;
};

export function preferredCompanyLogoUrl(
  source: CompanyLogoAssetSource | null | undefined,
) {
  return source?.iconUrl || source?.logoUrl || null;
}
