let MCJARS_BASE = 'https://mcjars.app';

/** Load the configured MCJars API URL from admin settings (best-effort) */
export async function loadMcjarsBaseUrl(): Promise<void> {
  try {
    const res = await fetch('/api/admin/mc-version-chooser/settings');
    if (res.ok) {
      const data = await res.json();
      if (data.mcjars_api_url) MCJARS_BASE = data.mcjars_api_url.replace(/\/+$/, '');
    }
  } catch {
    // Use default - admin settings may not be accessible to non-admins
  }
}

export function getMcjarsBase(): string {
  return MCJARS_BASE;
}

export interface McJarsType {
  name: string;
  icon: string;
  color: string;
  homepage: string;
  deprecated: boolean;
  experimental: boolean;
  description: string;
  categories: string[];
  compatibility: string[];
  builds: number;
  versions: { minecraft: number; project: number };
}

// The /types endpoint returns types grouped under categories
export interface McJarsTypesResponse {
  success: boolean;
  types: Record<string, Record<string, McJarsType>>;
}

export interface McJarsBuild {
  id: number;
  type: string;
  versionId: string;
  projectVersionId: string | null;
  name: string;
  buildNumber: number | null;
  experimental: boolean;
  jarUrl: string | null;
  jarSize: number | null;
  zipUrl: string | null;
  zipSize: number | null;
  changes: string[];
  created: string;
  installation: McJarsInstallStep[][];
}

export interface McJarsInstallStep {
  type: string;
  file?: string;
  url?: string;
  size?: number;
  action?: string;
  commands?: string[];
}

export interface McJarsBuildsResponse {
  success: boolean;
  builds: McJarsBuild[];
}

export interface McJarsVersionInfo {
  type: string;
  supported: boolean;
  java: number | null;
  builds: number;
  created: string;
  latest: McJarsBuild;
}

export interface McJarsVersionsResponse {
  success: boolean;
  builds: Record<string, McJarsVersionInfo>;
}

/** Fetch all server types, grouped by category */
export async function fetchTypes(): Promise<McJarsTypesResponse> {
  const res = await fetch(`${MCJARS_BASE}/api/v2/types`);
  if (!res.ok) throw new Error(`mcjars /types failed: ${res.status}`);
  return res.json();
}

/** Flatten types from all categories into a single record */
export function flattenTypes(categorized: Record<string, Record<string, McJarsType>>): Record<string, McJarsType> {
  const flat: Record<string, McJarsType> = {};
  for (const category of Object.values(categorized)) {
    for (const [key, type] of Object.entries(category)) {
      flat[key] = type;
    }
  }
  return flat;
}

/** Fetch versions for a given type. Returns version info keyed by version string. */
export async function fetchVersions(type: string): Promise<McJarsVersionsResponse> {
  const res = await fetch(`${MCJARS_BASE}/api/v2/builds/${type}`);
  if (!res.ok) throw new Error(`mcjars /builds/${type} failed: ${res.status}`);
  return res.json();
}

/** Fetch builds for a specific type+version */
export async function fetchBuilds(type: string, version: string): Promise<McJarsBuildsResponse> {
  const res = await fetch(`${MCJARS_BASE}/api/v2/builds/${type}/${version}`);
  if (!res.ok) throw new Error(`mcjars /builds/${type}/${version} failed: ${res.status}`);
  return res.json();
}

// Map egg names AND startup commands to mcjars type identifiers
const TYPE_KEYWORDS: Record<string, string> = {
  vanilla: 'VANILLA',
  paper: 'PAPER',
  spigot: 'SPIGOT',
  purpur: 'PURPUR',
  fabric: 'FABRIC',
  forge: 'FORGE',
  neoforge: 'NEOFORGE',
  velocity: 'VELOCITY',
  waterfall: 'WATERFALL',
  bungeecord: 'BUNGEECORD',
  folia: 'FOLIA',
  sponge: 'SPONGE',
  mohist: 'MOHIST',
  arclight: 'ARCLIGHT',
  leaves: 'LEAVES',
  canvas: 'CANVAS',
  pufferfish: 'PUFFERFISH',
};

/** Detect server type from egg name, startup command, or docker image */
export function detectServerType(eggName: string, startup: string, dockerImage: string): string | null {
  // Check all sources for type keywords
  const sources = [eggName, startup, dockerImage].map((s) => s.toLowerCase());

  for (const [keyword, type] of Object.entries(TYPE_KEYWORDS)) {
    if (sources.some((s) => s.includes(keyword))) {
      return type;
    }
  }
  return null;
}

/** Extract jar filename from a startup command like "java -jar server.jar" */
export function detectJarFilename(startup: string): string {
  // Match -jar <filename> pattern (handles quotes too)
  const match = startup.match(/-jar\s+["']?([^\s"']+\.jar)["']?/i);
  if (match) return match[1];

  // Match {{SERVER_JARFILE}} or similar variable patterns - fall back to server.jar
  const varMatch = startup.match(/-jar\s+\{\{(\w+)\}\}/i);
  if (varMatch) return 'server.jar';

  return 'server.jar';
}

/** Get the download URL for a build, preferring jarUrl over zipUrl */
export function getBuildDownloadUrl(build: McJarsBuild): string | null {
  return build.jarUrl ?? build.zipUrl ?? null;
}

/** Check if a build requires zip-based installation */
export function isBuildZipInstall(build: McJarsBuild): boolean {
  return !build.jarUrl && !!build.zipUrl;
}

/** Get the display size for a build */
export function getBuildSize(build: McJarsBuild): number | null {
  return build.jarSize ?? build.zipSize ?? null;
}
