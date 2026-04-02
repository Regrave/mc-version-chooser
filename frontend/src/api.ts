const MCJARS_BASE = 'https://mcjars.app';

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

import { axiosInstance } from '@/api/axios.ts';

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

/** Egg-name-only fallback (synchronous, used when server hasn't been started) */
export function detectServerType(eggName: string, startup: string, dockerImage: string): string | null {
  const sources = [eggName, startup, dockerImage].map((s) => s.toLowerCase());
  for (const [keyword, type] of Object.entries(TYPE_KEYWORDS)) {
    if (sources.some((s) => s.includes(keyword))) {
      return type;
    }
  }
  return null;
}

/**
 * Detect server type using a deterministic decision tree.
 *
 * Priority 1: .mcvc-type.json marker (from this extension on install)
 * Priority 2: Directory/file fingerprints (most specific first)
 *
 * Decision tree (order matters — server types inherit from each other):
 *   libraries/net/neoforged/       → NEOFORGE
 *   libraries/net/minecraftforge/  → FORGE
 *   fabric-server-launch*.jar / .fabric/ → FABRIC
 *   quilt-server-launcher*.jar / .quilt/ → QUILT
 *   purpur.yml                     → PURPUR
 *   pufferfish.yml                 → PUFFERFISH
 *   leaves.yml                     → LEAVES
 *   config/folia-global.yml        → FOLIA
 *   config/paper-global.yml        → PAPER
 *   spigot.yml                     → SPIGOT
 *   bukkit.yml                     → BUKKIT
 *   server.properties              → VANILLA
 */
export async function detectServerTypeFromFiles(uuid: string): Promise<string | null> {
  try {
    // ── Priority 1: .mcvc-type.json marker ──
    try {
      const { data: markerData } = await axiosInstance.get(`/api/client/servers/${uuid}/files/contents`, {
        params: { file: '/.mcvc-type.json' },
        responseType: 'text',
        transformResponse: [(d: string) => d],
      });
      if (markerData) {
        const marker = JSON.parse(markerData);
        if (marker.type) return marker.type;
      }
    } catch { /* marker doesn't exist */ }

    // ── Priority 2: File fingerprint decision tree ──
    const { data } = await axiosInstance.get(`/api/client/servers/${uuid}/files/list`, {
      params: { directory: '/', page: 1, per_page: 100, sort: 'name_asc' },
    });
    const entries = (data.entries?.data ?? []) as Array<{ name: string; directory: boolean; file: boolean }>;
    const rootDirs = new Set(entries.filter((e) => e.directory).map((e) => e.name));
    const rootFiles = new Set(entries.filter((e) => e.file).map((e) => e.name));

    // ── Bukkit-chain FIRST (Paper bundles NeoForge libs, so libraries/ check is unreliable) ──
    if (rootFiles.has('purpur.yml')) return 'PURPUR';
    if (rootFiles.has('pufferfish.yml')) return 'PUFFERFISH';
    if (rootFiles.has('leaves.yml')) return 'LEAVES';

    // Folia / Paper — check config/ directory
    if (rootDirs.has('config')) {
      const { data: cfgData } = await axiosInstance.get(`/api/client/servers/${uuid}/files/list`, {
        params: { directory: '/config', page: 1, per_page: 100, sort: 'name_asc' },
      }).catch(() => ({ data: { entries: { data: [] } } }));
      const cfgFiles = new Set((cfgData.entries?.data ?? []).filter((e: any) => e.file).map((e: any) => e.name));
      if (cfgFiles.has('folia-global.yml')) return 'FOLIA';
      if (cfgFiles.has('paper-global.yml')) return 'PAPER';
    }
    if (rootFiles.has('paper-global.yml')) return 'PAPER';
    if (rootFiles.has('spigot.yml')) return 'SPIGOT';
    if (rootFiles.has('bukkit.yml')) return 'BUKKIT';

    // ── Mod loaders (only if no Bukkit-chain match) ──
    if (rootDirs.has('.fabric') || rootFiles.has('fabric-server-launch.jar') || rootFiles.has('fabric-server-launcher.jar')) {
      return 'FABRIC';
    }
    if (rootDirs.has('.quilt') || rootFiles.has('quilt-server-launch.jar') || rootFiles.has('quilt-server-launcher.jar')) {
      return 'QUILT';
    }

    // NeoForge / Forge — ONLY if nothing else matched
    if (rootDirs.has('libraries')) {
      const { data: libData } = await axiosInstance.get(`/api/client/servers/${uuid}/files/list`, {
        params: { directory: '/libraries/net', page: 1, per_page: 100, sort: 'name_asc' },
      }).catch(() => ({ data: { entries: { data: [] } } }));
      const libDirs = new Set((libData.entries?.data ?? []).filter((e: any) => e.directory).map((e: any) => e.name));
      if (libDirs.has('neoforged')) return 'NEOFORGE';
      if (libDirs.has('minecraftforge')) return 'FORGE';
    }

    // Vanilla
    if (rootFiles.has('server.properties')) return 'VANILLA';

    return null; // Server never started
  } catch {
    return null;
  }
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
