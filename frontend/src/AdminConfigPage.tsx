import { faChartPie, faGear, faHistory, faServer } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Alert, Group, Loader, SegmentedControl, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { ArcElement, Chart as ChartJS, Legend, Tooltip as ChartTooltip } from 'chart.js';
import { useCallback, useEffect, useState } from 'react';
import { Doughnut } from 'react-chartjs-2';
import Button from '@/elements/Button.tsx';
import Select from '@/elements/input/Select.tsx';

ChartJS.register(ArcElement, Legend, ChartTooltip);

interface McvcSettings {
  mcjars_api_url: string;
  default_category: string;
}

interface StatsData {
  total: number;
  successes: number;
  failures: number;
  clean_installs: number;
  unique_servers: number;
  type_distribution: Array<{ type: string; count: number }>;
  days: number;
}

interface InstallRecord {
  id: string;
  server_uuid: string;
  server_type: string;
  version: string;
  build_id: number;
  is_zip: boolean;
  clean_install: boolean;
  success: boolean;
  installed_at: string;
}

const TYPE_COLORS: Record<string, string> = {
  PAPER: '#4ade80',
  PURPUR: '#a78bfa',
  FABRIC: '#fbbf24',
  FORGE: '#f97316',
  NEOFORGE: '#ef4444',
  VANILLA: '#94a3b8',
  SPIGOT: '#facc15',
  VELOCITY: '#22d3ee',
  WATERFALL: '#3b82f6',
  BUNGEECORD: '#eab308',
  FOLIA: '#34d399',
  SPONGE: '#f472b6',
  MOHIST: '#fb923c',
  LEAVES: '#86efac',
  PUFFERFISH: '#fde047',
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] ?? `hsl(${(type.charCodeAt(0) * 37) % 360}, 60%, 55%)`;
}

export default function AdminConfigPage() {
  const [tab, setTab] = useState('stats');

  // Settings state
  const [settings, setSettings] = useState<McvcSettings>({ mcjars_api_url: 'https://mcjars.app', default_category: 'all' });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Stats state
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsDays, setStatsDays] = useState('30');

  // Recent installs
  const [installs, setInstalls] = useState<InstallRecord[]>([]);
  const [installsLoading, setInstallsLoading] = useState(true);

  // Load settings
  useEffect(() => {
    fetch('/api/admin/mc-version-chooser/settings')
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {})
      .finally(() => setSettingsLoading(false));
  }, []);

  // Load stats
  useEffect(() => {
    setStatsLoading(true);
    fetch(`/api/admin/mc-version-chooser/stats?days=${statsDays}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [statsDays]);

  // Load recent installs
  useEffect(() => {
    fetch('/api/admin/mc-version-chooser/installs')
      .then((r) => r.json())
      .then((data) => setInstalls(data.installs ?? []))
      .catch(() => {})
      .finally(() => setInstallsLoading(false));
  }, []);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/admin/mc-version-chooser/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveMsg('Settings saved.');
    } catch (e) {
      setSaveMsg(`Failed to save: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }, [settings]);

  // Chart data for type distribution
  const typeChartData = stats ? {
    labels: stats.type_distribution.map((d) => d.type),
    datasets: [{
      data: stats.type_distribution.map((d) => d.count),
      backgroundColor: stats.type_distribution.map((d) => getTypeColor(d.type)),
      borderWidth: 0,
      hoverBorderWidth: 2,
      hoverBorderColor: '#fff',
    }],
  } : null;

  // Chart data for success/failure
  const outcomeChartData = stats ? {
    labels: ['Successful', 'Failed'],
    datasets: [{
      data: [stats.successes, stats.failures],
      backgroundColor: ['#4ade80', '#ef4444'],
      borderWidth: 0,
      hoverBorderWidth: 2,
      hoverBorderColor: '#fff',
    }],
  } : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { color: '#94a3b8', font: { size: 11 }, padding: 12 },
      },
    },
  };

  return (
    <div className='mcvc-admin'>
      <SegmentedControl
        value={tab}
        onChange={setTab}
        data={[
          { value: 'stats', label: 'Statistics' },
          { value: 'settings', label: 'Settings' },
          { value: 'installs', label: 'Recent Installs' },
        ]}
        mt='md'
        mb='lg'
      />

      {/* ── Statistics Tab ── */}
      {tab === 'stats' && (
        <Stack gap='lg'>
          <Group justify='space-between' align='center'>
            <Title order={4}>
              <FontAwesomeIcon icon={faChartPie} style={{ marginRight: 8 }} />
              Installation Statistics
            </Title>
            <Select
              data={[
                { value: '7', label: 'Last 7 days' },
                { value: '30', label: 'Last 30 days' },
                { value: '90', label: 'Last 90 days' },
                { value: '365', label: 'Last year' },
              ]}
              value={statsDays}
              onChange={(v) => v && setStatsDays(v)}
              w={160}
            />
          </Group>

          {statsLoading ? (
            <div className='mcvc-admin-center'><Loader color='violet' /></div>
          ) : !stats || stats.total === 0 ? (
            <Alert color='gray' variant='light'>
              No installation data yet. Stats will appear once users start installing server versions.
            </Alert>
          ) : (
            <>
              {/* Summary cards */}
              <div className='mcvc-admin-stat-grid'>
                <div className='mcvc-admin-stat-card'>
                  <Text size='xs' c='dimmed' tt='uppercase' fw={600}>Total Installs</Text>
                  <Text size='xl' fw={700}>{stats.total.toLocaleString()}</Text>
                </div>
                <div className='mcvc-admin-stat-card'>
                  <Text size='xs' c='dimmed' tt='uppercase' fw={600}>Success Rate</Text>
                  <Text size='xl' fw={700} c={stats.failures === 0 ? 'green' : 'yellow'}>
                    {stats.total > 0 ? ((stats.successes / stats.total) * 100).toFixed(1) : 0}%
                  </Text>
                </div>
                <div className='mcvc-admin-stat-card'>
                  <Text size='xs' c='dimmed' tt='uppercase' fw={600}>Clean Installs</Text>
                  <Text size='xl' fw={700}>{stats.clean_installs.toLocaleString()}</Text>
                </div>
                <div className='mcvc-admin-stat-card'>
                  <Text size='xs' c='dimmed' tt='uppercase' fw={600}>Unique Servers</Text>
                  <Text size='xl' fw={700}>{stats.unique_servers.toLocaleString()}</Text>
                </div>
              </div>

              {/* Charts */}
              <div className='mcvc-admin-chart-grid'>
                {typeChartData && typeChartData.labels.length > 0 && (
                  <div className='mcvc-admin-chart-card'>
                    <Text fw={600} mb='sm' size='sm'>
                      <FontAwesomeIcon icon={faServer} style={{ marginRight: 6 }} />
                      Type Distribution
                    </Text>
                    <div className='mcvc-admin-chart-container'>
                      <Doughnut data={typeChartData} options={chartOptions} />
                    </div>
                  </div>
                )}
                {outcomeChartData && (
                  <div className='mcvc-admin-chart-card'>
                    <Text fw={600} mb='sm' size='sm'>
                      <FontAwesomeIcon icon={faChartPie} style={{ marginRight: 6 }} />
                      Success / Failure
                    </Text>
                    <div className='mcvc-admin-chart-container'>
                      <Doughnut data={outcomeChartData} options={chartOptions} />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </Stack>
      )}

      {/* ── Settings Tab ── */}
      {tab === 'settings' && (
        <Stack gap='md'>
          <Title order={4}>
            <FontAwesomeIcon icon={faGear} style={{ marginRight: 8 }} />
            Extension Settings
          </Title>

          {settingsLoading ? (
            <div className='mcvc-admin-center'><Loader color='violet' /></div>
          ) : (
            <>
              <TextInput
                label='MCJars API URL'
                description='Base URL for the MCJars API. Change only if self-hosting.'
                value={settings.mcjars_api_url}
                onChange={(e) => setSettings((s) => ({ ...s, mcjars_api_url: e.currentTarget.value }))}
                placeholder='https://mcjars.app'
              />

              <Select
                label='Default Category'
                description='Default category filter shown to users on the type selection page.'
                data={[
                  { value: 'all', label: 'All' },
                  { value: 'recommended', label: 'Recommended' },
                  { value: 'plugins', label: 'Servers' },
                  { value: 'modded', label: 'Modded' },
                  { value: 'proxy', label: 'Proxies' },
                ]}
                value={settings.default_category}
                onChange={(v) => v && setSettings((s) => ({ ...s, default_category: v }))}
              />

              {saveMsg && (
                <Alert color={saveMsg.startsWith('Failed') ? 'red' : 'green'} variant='light'>
                  {saveMsg}
                </Alert>
              )}

              <Group justify='flex-end'>
                <Button onClick={saveSettings} loading={saving}>
                  Save Settings
                </Button>
              </Group>
            </>
          )}
        </Stack>
      )}

      {/* ── Recent Installs Tab ── */}
      {tab === 'installs' && (
        <Stack gap='md'>
          <Title order={4}>
            <FontAwesomeIcon icon={faHistory} style={{ marginRight: 8 }} />
            Recent Installations
          </Title>

          {installsLoading ? (
            <div className='mcvc-admin-center'><Loader color='violet' /></div>
          ) : installs.length === 0 ? (
            <Alert color='gray' variant='light'>No installations recorded yet.</Alert>
          ) : (
            <div className='mcvc-admin-table-wrap'>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Version</Table.Th>
                    <Table.Th>Server</Table.Th>
                    <Table.Th>Clean</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Date</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {installs.map((install) => (
                    <Table.Tr key={install.id}>
                      <Table.Td>
                        <span className='mc-vc-tag mc-vc-tag--blue'>{install.server_type}</span>
                      </Table.Td>
                      <Table.Td>{install.version}</Table.Td>
                      <Table.Td>
                        <Text size='xs' c='dimmed' ff='monospace'>
                          {install.server_uuid.slice(0, 8)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {install.clean_install && <span className='mc-vc-tag mc-vc-tag--red'>CLEAN</span>}
                      </Table.Td>
                      <Table.Td>
                        <span className={`mc-vc-tag ${install.success ? 'mc-vc-tag--green' : 'mc-vc-tag--red'}`}>
                          {install.success ? 'OK' : 'FAIL'}
                        </span>
                      </Table.Td>
                      <Table.Td>
                        <Text size='xs' c='dimmed'>
                          {new Date(install.installed_at).toLocaleString()}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}
        </Stack>
      )}
    </div>
  );
}
