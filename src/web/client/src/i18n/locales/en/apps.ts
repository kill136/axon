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
  // CreateAppDialog
  'apps.createTitle': 'Tell AI what you want to build',
  'apps.workingDir': 'Working Directory',
  'apps.workingDirHint': 'AI will create project files in this directory. Please specify a new empty directory.',
  'apps.workingDirPlaceholder': 'e.g. D:\\Projects\\my-app or ~/projects/my-app',
  'apps.dirRequired': 'Please specify a working directory',
  'apps.dirMustBeAbsolute': 'Please enter a full absolute path, e.g. D:\\Projects\\my-app',
  'apps.browse': 'Browse...',
  'apps.descLabel': 'Description',
  'apps.createPlaceholder': 'Describe what you want to build, e.g. a credit report reader, a budgeting app, a snake game',
  'apps.descPlaceholderShort': 'Describe what you want to build...',
  'apps.startCreate': 'Start Creating',
  // DirectoryBrowser
  'apps.selectDirectory': 'Select Directory',
  'apps.enterPathPlaceholder': 'Enter path and press Enter...',
  'apps.noSubDirs': 'No subdirectories',
  'apps.selectThisDir': 'Select This Directory',
} as const;

export type AppsKeys = keyof typeof apps;
export default apps;
