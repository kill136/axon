import { describe, expect, it } from 'vitest';
import {
  pickInitialProject,
  type Project,
} from '../../src/web/client/src/contexts/ProjectContext';

function createProject(id: string, path: string): Project {
  return {
    id,
    name: path.split(/[\\/]/).pop() || path,
    path,
  };
}

describe('pickInitialProject', () => {
  const recentProjects = [
    createProject('latest', '/workspace/latest'),
    createProject('older', '/workspace/older'),
  ];

  it('should restore the saved project when it still exists in recent projects', () => {
    const savedProject = createProject('older', '/workspace/older');

    expect(pickInitialProject(savedProject, recentProjects)).toEqual(recentProjects[1]);
  });

  it('should fall back to the most recent project when the saved project is stale', () => {
    const savedProject = createProject('missing', '/workspace/missing');

    expect(pickInitialProject(savedProject, recentProjects)).toEqual(recentProjects[0]);
  });

  it('should keep first-time users on the no-project welcome state when nothing was opened before', () => {
    expect(pickInitialProject(null, [])).toBeNull();
  });
});
