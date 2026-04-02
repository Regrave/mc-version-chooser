import { faArrowLeft, faArrowDown, faCheck, faExclamationTriangle, faRefresh } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Alert, Badge, Checkbox, Group, Loader, Modal, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/Button.tsx';
import Select from '@/elements/input/Select.tsx';
import ServerContentContainer from '@/elements/containers/ServerContentContainer.tsx';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import {
  detectJarFilename,
  detectServerTypeFromFiles,
  fetchBuilds,
  fetchTypes,
  fetchVersions,
  getBuildDownloadUrl,
  getBuildSize,
  isBuildZipInstall,
  loadMcjarsBaseUrl,
  type McJarsBuild,
  type McJarsType,
} from './api.ts';

type Step = 'type' | 'version' | 'build';
type InstallStep = 'idle' | 'downloading' | 'installing' | 'done' | 'error';

const CATEGORY_FILTERS: Record<string, (cats: string[]) => boolean> = {
  all: () => true,
  plugins: (cats) => cats.includes('plugins') && !cats.includes('proxy'),
  modded: (cats) => cats.includes('modded'),
  proxy: (cats) => cats.includes('proxy'),
  limbo: (cats) => cats.includes('limbo'),
};

export default function VersionChooserPage() {
  const { addToast } = useToast();
  const { server } = useServerStore();

  // Navigation
  const [step, setStep] = useState<Step>('type');

  // Type data
  const [categorizedTypes, setCategorizedTypes] = useState<Record<string, Record<string, McJarsType>>>({});
  const [allTypes, setAllTypes] = useState<Record<string, McJarsType>>({});
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [typesLoading, setTypesLoading] = useState(true);

  // Version data
  const [versions, setVersions] = useState<Record<string, McJarsVersionInfo>>({});
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // Build data
  const [builds, setBuilds] = useState<McJarsBuild[]>([]);
  const [selectedBuild, setSelectedBuild] = useState<McJarsBuild | null>(null);
  const [buildsLoading, setBuildsLoading] = useState(false);

  // Install state
  const [installStep, setInstallStep] = useState<InstallStep>('idle');
  const [installing, setInstalling] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);

  // Install options
  const [cleanInstall, setCleanInstall] = useState(false);
  const [acceptEula, setAcceptEula] = useState(false);

  // Soft hint from egg name (not authoritative)
  const [detectedType, setDetectedType] = useState<string | null>(null);
  const jarFilename = useMemo(
    () => detectJarFilename(server.startup ?? server.egg.startup),
    [server.startup, server.egg.startup],
  );
  const isRunning = server.status === 'running' || server.status === 'starting';

  // Load settings + types on mount
  useEffect(() => {
    loadMcjarsBaseUrl().then(() => fetchTypes())
      .then(async (res) => {
        setCategorizedTypes(res.types);
        const flat: Record<string, McJarsType> = {};
        for (const cat of Object.values(res.types)) {
          for (const [key, type] of Object.entries(cat)) {
            flat[key] = type;
          }
        }
        setAllTypes(flat);
        // Detect server type from files first, egg name as fallback
        const hint = await detectServerTypeFromFiles(
          server.uuid,
          server.egg.name,
          server.startup ?? server.egg.startup,
          server.image ?? '',
        );
        if (hint && flat[hint]) setDetectedType(hint);
      })
      .catch((err) => addToast(`Failed to load server types: ${err.message}`, 'error'))
      .finally(() => setTypesLoading(false));
  }, []);

  // Load versions when type selected
  useEffect(() => {
    if (!selectedType) return;
    setVersionsLoading(true);
    fetchVersions(selectedType)
      .then((res) => setVersions(res.builds))
      .catch((err) => addToast(`Failed to load versions: ${err.message}`, 'error'))
      .finally(() => setVersionsLoading(false));
  }, [selectedType]);

  // Load builds when version selected
  useEffect(() => {
    if (!selectedType || !selectedVersion) return;
    setBuildsLoading(true);
    fetchBuilds(selectedType, selectedVersion)
      .then((res) => {
        setBuilds(res.builds);
        if (res.builds.length > 0) setSelectedBuild(res.builds[0]);
      })
      .catch((err) => addToast(`Failed to load builds: ${err.message}`, 'error'))
      .finally(() => setBuildsLoading(false));
  }, [selectedType, selectedVersion]);

  // Filter and sort types
  const filteredTypes = useMemo(() => {
    const result: Array<{ id: string; type: McJarsType; apiCategory: string }> = [];
    for (const [apiCat, types] of Object.entries(categorizedTypes)) {
      for (const [id, type] of Object.entries(types)) {
        const cats = type.categories;
        const filterFn = CATEGORY_FILTERS[categoryFilter];
        if (categoryFilter === 'all' || (filterFn && filterFn(cats)) || apiCat === categoryFilter) {
          result.push({ id, type, apiCategory: apiCat });
        }
      }
    }
    return result;
  }, [categorizedTypes, categoryFilter]);

  // Filter + sort versions (newest first)
  const sortedVersions = useMemo(() => {
    const entries = Object.entries(versions);
    const filtered = showSnapshots
      ? entries
      : entries.filter(([v]) => !v.includes('-') && !v.includes('pre') && !v.includes('rc') && !v.includes('snapshot'));
    // Reverse to get newest first (API returns ascending)
    return filtered.reverse();
  }, [versions, showSnapshots]);

  // Build options for modal selector
  const buildOptions = useMemo(
    () =>
      builds.map((b) => ({
        value: String(b.id),
        label: b.projectVersionId
          ? `${b.projectVersionId}${b.buildNumber ? ` #${b.buildNumber}` : ''}`
          : b.buildNumber ? `Build #${b.buildNumber}` : `Build ${b.id}`,
      })),
    [builds],
  );

  const selectType = (id: string) => {
    setSelectedType(id);
    setSelectedVersion(null);
    setBuilds([]);
    setSelectedBuild(null);
    setStep('version');
  };

  const selectVersion = (version: string) => {
    setSelectedVersion(version);
    setSelectedBuild(null);
    setStep('build');
    setShowInstallModal(true);
    setInstallStep('idle');
    setCleanInstall(false);
    setAcceptEula(false);
  };

  const goBack = () => {
    if (step === 'build') {
      setStep('version');
      setShowInstallModal(false);
    } else if (step === 'version') {
      setStep('type');
      setSelectedType(null);
    }
  };

  const doInstall = useCallback(async () => {
    if (!selectedBuild) return;
    const downloadUrl = getBuildDownloadUrl(selectedBuild);
    if (!downloadUrl) {
      addToast('Selected build has no downloadable file.', 'error');
      return;
    }

    setInstalling(true);
    setInstallStep('downloading');

    try {
      const isZip = isBuildZipInstall(selectedBuild);
      const params = new URLSearchParams({ url: downloadUrl, filename: jarFilename });
      if (isZip) params.set('unzip', 'true');
      if (cleanInstall) params.set('clean_install', 'true');
      if (selectedType) params.set('server_type', selectedType);
      if (selectedVersion) params.set('version', selectedVersion);
      params.set('build_id', String(selectedBuild.id));

      const res = await fetch(
        `/api/client/servers/${server.uuid}/mc-version-chooser/install?${params}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Install failed: ${res.status}`);
      }

      const statusUrl = `/api/client/servers/${server.uuid}/mc-version-chooser/install/status`;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const statusRes = await fetch(statusUrl);
        if (!statusRes.ok) throw new Error('Failed to check install status');
        const status = await statusRes.json();
        if (status.state === 'downloading') setInstallStep('installing');
        if (status.state === 'done') break;
      }

      setInstallStep('done');
      addToast(
        isRunning
          ? 'Version updated! Restart your server to apply changes.'
          : 'Version updated successfully!',
        'success',
      );
    } catch (err) {
      setInstallStep('error');
      const message = err instanceof Error ? err.message : httpErrorToHuman(err);
      addToast(`Version change failed: ${message}`, 'error');
    } finally {
      setInstalling(false);
    }
  }, [selectedBuild, server.uuid, jarFilename, isRunning, cleanInstall]);

  const currentTypeInfo = selectedType ? allTypes[selectedType] : null;
  const isZip = selectedBuild ? isBuildZipInstall(selectedBuild) : false;
  const buildSize = selectedBuild ? getBuildSize(selectedBuild) : null;

  return (
    <ServerContentContainer title='Version Chooser'>
      <div className='mc-vc'>
        {/* Header */}
        <div className='mc-vc-header'>
          <div className='mc-vc-header-left'>
            {step !== 'type' && (
              <button className='mc-vc-back' onClick={goBack} type='button'>
                <FontAwesomeIcon icon={faArrowLeft} />
              </button>
            )}
            <Title order={3}>Minecraft Versions</Title>
          </div>
        </div>

        {/* Running warning */}
        {isRunning && step !== 'type' && (
          <Alert icon={<FontAwesomeIcon icon={faExclamationTriangle} />} color='yellow' variant='light' mt='sm' mb='sm'>
            Server is running. Restart after changing versions.
          </Alert>
        )}

        {/* Step 1: Type Selection */}
        {step === 'type' && (
          <>
            <SegmentedControl
              value={categoryFilter}
              onChange={setCategoryFilter}
              data={[
                { value: 'all', label: 'All' },
                { value: 'recommended', label: 'Recommended' },
                { value: 'plugins', label: 'Servers' },
                { value: 'modded', label: 'Modded' },
                { value: 'proxy', label: 'Proxies' },
              ]}
              mt='md'
              mb='md'
              className='mc-vc-tabs'
            />

            {typesLoading ? (
              <div className='mc-vc-center'>
                <Loader color='violet' size='lg' />
              </div>
            ) : (
              <div className='mc-vc-type-grid'>
                {filteredTypes.map(({ id, type, apiCategory }) => (
                  <button
                    key={id}
                    className={`mc-vc-type-card ${id === detectedType ? 'mc-vc-type-card--detected' : ''}`}
                    onClick={() => selectType(id)}
                    type='button'
                  >
                    <img src={type.icon} alt={type.name} className='mc-vc-type-icon' />
                    <div className='mc-vc-type-info'>
                      <Text fw={600} size='sm'>{type.name}</Text>
                      <Text size='xs' c='dimmed'>
                        {type.versions.minecraft} Versions &middot; {type.builds.toLocaleString()} Builds
                      </Text>
                    </div>
                    <div className='mc-vc-type-badges'>
                      {id === detectedType && (
                        <span className='mc-vc-tag mc-vc-tag--green'>DETECTED</span>
                      )}
                      {apiCategory === 'recommended' && id !== detectedType && (
                        <span className='mc-vc-tag mc-vc-tag--blue'>POPULAR</span>
                      )}
                      {type.experimental && (
                        <span className='mc-vc-tag mc-vc-tag--yellow'>EXPERIMENTAL</span>
                      )}
                      {type.deprecated && (
                        <span className='mc-vc-tag mc-vc-tag--red'>DEPRECATED</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Step 2: Version Selection */}
        {step === 'version' && selectedType && (
          <>
            <Group justify='space-between' mt='md' mb='md'>
              <Group gap='sm'>
                {currentTypeInfo && (
                  <img src={currentTypeInfo.icon} alt='' className='mc-vc-header-icon' />
                )}
                <Title order={4}>{currentTypeInfo?.name ?? selectedType}</Title>
              </Group>
              <Checkbox
                label='Show snapshots'
                checked={showSnapshots}
                onChange={(e) => setShowSnapshots(e.currentTarget.checked)}
                size='sm'
              />
            </Group>

            {versionsLoading ? (
              <div className='mc-vc-center'>
                <Loader color='violet' size='lg' />
              </div>
            ) : sortedVersions.length === 0 ? (
              <Text c='dimmed' ta='center' mt='xl'>No versions found.</Text>
            ) : (
              <div className='mc-vc-version-grid'>
                {sortedVersions.map(([version, info]) => (
                  <button
                    key={version}
                    className='mc-vc-version-card'
                    onClick={() => selectVersion(version)}
                    type='button'
                  >
                    <img
                      src={currentTypeInfo?.icon ?? ''}
                      alt=''
                      className='mc-vc-version-icon'
                    />
                    <div>
                      <Text fw={600} size='sm'>{version}</Text>
                      <Text size='xs' c='dimmed'>{info.builds} Builds</Text>
                    </div>
                    {info.java && (
                      <span className='mc-vc-tag mc-vc-tag--gray' style={{ marginLeft: 'auto' }}>
                        Java {info.java}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Step 3: Install Modal */}
        <Modal
          opened={showInstallModal && step === 'build'}
          onClose={() => {
            setShowInstallModal(false);
            setStep('version');
          }}
          title={
            <Group gap='sm'>
              {currentTypeInfo && <img src={currentTypeInfo.icon} alt='' width={24} height={24} />}
              <Text fw={600}>Install {currentTypeInfo?.name} {selectedVersion}</Text>
            </Group>
          }
          size='md'
          centered
        >
          <Stack gap='md'>
            {/* Build selector */}
            {buildsLoading ? (
              <div className='mc-vc-center'>
                <Loader color='violet' size='sm' />
              </div>
            ) : (
              <Select
                label='Build'
                placeholder='Select build...'
                data={buildOptions}
                value={selectedBuild ? String(selectedBuild.id) : null}
                onChange={(val) => {
                  const build = builds.find((b) => String(b.id) === val);
                  setSelectedBuild(build ?? null);
                }}
                searchable
              />
            )}

            {/* Build info */}
            {selectedBuild && (
              <div className='mc-vc-modal-info'>
                {buildSize && (
                  <Text size='xs' c='dimmed'>
                    Download size: {(buildSize / 1024 / 1024).toFixed(1)} MB
                    {isZip && ' (zip install)'}
                  </Text>
                )}
                {selectedBuild.experimental && (
                  <Badge color='yellow' variant='light' size='sm' mt='xs'>Experimental</Badge>
                )}
                {selectedBuild.changes.length > 0 && (
                  <div className='mc-vc-changes'>
                    <Text size='xs' c='dimmed' mt='xs' mb={4}>Changes:</Text>
                    {selectedBuild.changes.slice(0, 3).map((change, i) => (
                      <Text key={i} size='xs' c='dimmed' className='mc-vc-change-item'>
                        {change}
                      </Text>
                    ))}
                    {selectedBuild.changes.length > 3 && (
                      <Text size='xs' c='dimmed'>...and {selectedBuild.changes.length - 3} more</Text>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Clean install option */}
            <Checkbox
              label='Clean install'
              description='Deletes all existing server files before installing. Recommended when switching between server types (e.g. Paper to Forge). Cannot be undone.'
              checked={cleanInstall}
              onChange={(e) => setCleanInstall(e.currentTarget.checked)}
              color='red'
            />

            {/* EULA */}
            <Checkbox
              label='I accept the Minecraft EULA'
              description='By checking this box you agree to the Minecraft End User License Agreement.'
              checked={acceptEula}
              onChange={(e) => setAcceptEula(e.currentTarget.checked)}
            />

            {/* Install button */}
            <Group justify='flex-end' mt='sm'>
              <Button
                variant='subtle'
                onClick={() => {
                  setShowInstallModal(false);
                  setStep('version');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={doInstall}
                loading={installing && installStep !== 'done' && installStep !== 'error'}
                disabled={!selectedBuild || !getBuildDownloadUrl(selectedBuild) || !acceptEula}
                color={installStep === 'done' ? 'green' : installStep === 'error' ? 'red' : 'red'}
                leftSection={
                  <FontAwesomeIcon
                    icon={installStep === 'done' ? faCheck : installStep === 'error' ? faRefresh : faArrowDown}
                  />
                }
              >
                {installStep === 'idle' && 'Install'}
                {installStep === 'downloading' && 'Downloading...'}
                {installStep === 'installing' && 'Installing...'}
                {installStep === 'done' && 'Done!'}
                {installStep === 'error' && 'Retry'}
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    </ServerContentContainer>
  );
}
