import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import type { ScratchpadExternalLinkRow } from "@/server/features/audit/AuditScratchpad";
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";
import {
  parseHreflangLinks,
  parseImageSrcs,
  parseStringList,
  reportAssetProbes,
  reportCanonicalProbes,
  reportExternalLinkProbes,
  reportHreflangTargetProbes,
  reportImageProbes,
} from "@/server/lib/audit/issues/resource-checks";
import {
  createResourceProbeBudget,
  probeResources,
  type ResourceProbeBudget,
} from "@/server/lib/audit/resource-probe";

export async function runResourceChecks(input: {
  auditId: string;
  origin: string;
  externalLinks: ScratchpadExternalLinkRow[];
}): Promise<{ issues: DetectedIssue[]; budget: ResourceProbeBudget }> {
  const pages = await AuditRepository.getResourceCheckPages(input.auditId);
  const statusByUrl = new Map<string, number>();
  const hreflangByUrl = new Map(
    pages.map((page) => [page.url, parseHreflangLinks(page.hreflangTagsJson)]),
  );
  for (const page of pages) {
    if (page.statusCode !== null) statusByUrl.set(page.url, page.statusCode);
  }

  const prepared = pages.map((page) => ({
    id: page.id,
    url: page.url,
    canonicalUrl: page.canonicalUrl,
    headerCanonicalUrl: page.headerCanonicalUrl,
    imageSrcs: parseImageSrcs(page.imagesJson, page.url),
    scriptUrls: parseStringList(page.scriptUrlsJson),
    stylesheetUrls: parseStringList(page.stylesheetUrlsJson),
    inlineScriptBytes: page.inlineScriptBytes,
    inlineStyleBytes: page.inlineStyleBytes,
    hreflangLinks: parseHreflangLinks(page.hreflangTagsJson),
    statusByUrl,
    hreflangByUrl,
  }));

  const budget = createResourceProbeBudget();
  const statusTargets: string[] = [];
  for (const link of input.externalLinks) statusTargets.push(link.targetUrl);
  for (const page of prepared) {
    statusTargets.push(...page.imageSrcs);
    const canonical = page.canonicalUrl ?? page.headerCanonicalUrl;
    if (canonical && canonical !== page.url && !statusByUrl.has(canonical)) {
      statusTargets.push(canonical);
    }
    for (const link of page.hreflangLinks) {
      if (link.href && !statusByUrl.has(link.href))
        statusTargets.push(link.href);
    }
  }
  const statusProbes = await probeResources(statusTargets, budget);

  const inspectTargets: string[] = [];
  for (const page of prepared) {
    inspectTargets.push(...page.scriptUrls, ...page.stylesheetUrls);
  }
  const inspectProbes = await probeResources(inspectTargets, budget, {
    inspect: true,
  });

  const issues: DetectedIssue[] = [
    ...reportExternalLinkProbes(input.externalLinks, statusProbes),
    ...reportImageProbes({
      pages: prepared,
      origin: input.origin,
      probes: statusProbes,
    }),
    ...reportAssetProbes({
      pages: prepared,
      origin: input.origin,
      probes: inspectProbes,
    }),
    ...reportCanonicalProbes({
      pages: prepared,
      probes: statusProbes,
    }),
    ...reportHreflangTargetProbes({
      pages: prepared.map((page) => ({
        id: page.id,
        url: page.url,
        links: page.hreflangLinks,
        statusByUrl: page.statusByUrl,
        hreflangByUrl: page.hreflangByUrl,
      })),
      probes: statusProbes,
    }),
  ];

  return { issues, budget };
}
