export type ReportId = 'government' | 'research' | 'diplomacy' | 'empire' | 'demographics';

export const openReport = (report: ReportId): void => {
  document.dispatchEvent(new CustomEvent('open-report', { detail: { report } }));
};
