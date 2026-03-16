const apps = {
  'apps.title': 'Activity',
  'apps.activityTitle': 'Recent Activity',
  'apps.subtitle': '{{files}} files · {{edits}} edits · from {{sessions}} sessions',
  'apps.empty': 'No activity yet',
  'apps.emptyDesc': 'AI file operations (Edit/Write) from your conversations will appear here.',
  'apps.search': 'Search files...',
  'apps.filterAll': 'All',
  'apps.filterEdit': 'Edit',
  'apps.filterWrite': 'Write',
  'apps.jumpToSession': 'Go to session',
  'apps.filesCount': 'files',
  'apps.opsCount': 'ops',
  'apps.opsDetail': '{{count}} edits',
  'apps.wrote': 'created',
  'apps.loading': 'Loading...',
  'apps.loadError': 'Failed to load',
  'apps.noResults': 'No matching files',
} as const;

export type AppsKeys = keyof typeof apps;
export default apps;
