import type {
  ReportBranding,
  ResolvedReportBranding,
} from "@/types/schemas/reports";

export const DEFAULT_REPORT_BRANDING: ResolvedReportBranding = {
  brandName: "OpenSEO",
  logoUrl: null,
  primaryColor: "#2563eb",
  accentColor: "#0f172a",
};

type StoredBranding = {
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
};

/** Per-run overrides win over template branding, which wins over product
 * defaults. Null stored values mean "inherit" rather than "clear". */
export function resolveReportBranding(
  template: StoredBranding,
  override?: ReportBranding,
): ResolvedReportBranding {
  return {
    brandName:
      override?.brandName ??
      template.brandName ??
      DEFAULT_REPORT_BRANDING.brandName,
    logoUrl:
      override?.logoUrl ?? template.logoUrl ?? DEFAULT_REPORT_BRANDING.logoUrl,
    primaryColor:
      override?.primaryColor ??
      template.primaryColor ??
      DEFAULT_REPORT_BRANDING.primaryColor,
    accentColor:
      override?.accentColor ??
      template.accentColor ??
      DEFAULT_REPORT_BRANDING.accentColor,
  };
}
