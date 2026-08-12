export const PARITY_VIEWPORT = { width: 1280, height: 720 } as const;
export const PARITY_MINIMAP_SIZE = 300;

export const REDUCED_MOTION_PREFERENCES = JSON.stringify({
  muted: true,
  volume: 0,
  reducedMotion: true,
  disableFogOfWar: false,
  cityReportColumns: ['name', 'status', 'size', 'growth', 'resources', 'economy', 'production'],
  cityWorklistPresets: [],
});
