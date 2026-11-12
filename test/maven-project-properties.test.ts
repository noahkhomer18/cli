/**
 * Maven built-in project coordinates are substituted in dependency group, artifact,
 * and version. A child that omits `<version>` uses `<parent><version>`. Explicit
 * `<properties>` keep priority. A reference that still cannot be filled is skipped.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { MavenCache } from '../src/core-open/scanners/maven-cache.js';
import { scanJavaProjects } from '../src/core-open/scanners/java-scanner.js';
import { Semaphore } from '../src/core-open/utils/semaphore.js';
import type { ProjectScan } from '../src/reporting/types.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/maven-project-properties');

function offlineMavenCache(): MavenCache {
  const cache = new MavenCache(new Semaphore(1), undefined, true);
  vi.spyOn(cache, 'get').mockImplementation(async () => ({
    latest: null,
    stableVersions: [],
    latestStableOverall: null,
  }));
  return cache;
}

function specs(project: ProjectScan): Array<[string, string]> {
  return project.dependencies.map((dep) => [dep.package, dep.currentSpec]).sort();
}

describe('scan: Maven ${project.version} and related coordinates', () => {
  it('keeps sibling modules and drops references that stay unresolved', async () => {
    const projects = await scanJavaProjects(FIXTURE, offlineMavenCache());
    const byName = new Map(projects.map((project) => [project.name, project]));
    expect([...byName.keys()].sort()).toEqual(['app', 'core', 'parent']);

    expect(specs(byName.get('parent')!)).toEqual([]);

    // No <version> or <groupId> on app: both come from <parent>.
    // sibling.version is itself ${project.version}, so the second row also resolves.
    expect(specs(byName.get('app')!)).toEqual([
      ['com.example:app-tests', '2.4.0'],
      ['com.example:core', '2.4.0'],
    ]);

    // <version>${revision}</version> is 3.1.0. pom.version / version alias that.
    // An explicit <project.version> property wins for that key only.
    // project.parent.* stays the parent coordinate, not the child's version.
    expect(specs(byName.get('core')!)).toEqual([
      ['com.example:explicit-property', '9.9.9'],
      ['com.example:from-pom-alias', '3.1.0'],
      ['com.example:from-version-alias', '3.1.0'],
      ['com.example:parent-coordinates', '2.4.0'],
      ['com.example:plain-lib', '1.2.3'],
    ]);
  });
});
