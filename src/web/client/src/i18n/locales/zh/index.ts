import type { WebLocaleKeys } from '../en';

import apps from './apps';
import auth from './auth';
import chat from './chat';
import cli from './cli';
import code from './code';
import common from './common';
import git from './git';
import nav from './nav';
import settings from './settings';
import swarm from './swarm';

const zh: Record<WebLocaleKeys, string> = {
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
};

export default zh;
