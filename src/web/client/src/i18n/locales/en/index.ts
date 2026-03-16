import apps, { type AppsKeys } from './apps';
import auth, { type AuthKeys } from './auth';
import chat, { type ChatKeys } from './chat';
import cli, { type CliKeys } from './cli';
import code, { type CodeKeys } from './code';
import common, { type CommonKeys } from './common';
import git, { type GitKeys } from './git';
import nav, { type NavKeys } from './nav';
import settings, { type SettingsKeys } from './settings';
import swarm, { type SwarmKeys } from './swarm';

const en = {
  ...apps,
  ...auth,
  ...chat,
  ...cli,
  ...code,
  ...common,
  ...git,
  ...nav,
  ...settings,
  ...swarm,
} as const;

export type WebLocaleKeys = AppsKeys | AuthKeys | ChatKeys | CliKeys | CodeKeys | CommonKeys | GitKeys | NavKeys | SettingsKeys | SwarmKeys;
export default en;
