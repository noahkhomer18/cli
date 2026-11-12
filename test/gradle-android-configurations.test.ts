/**
 * Android and other Gradle configurations are scan rows.
 * `androidTest*`, `test*`, `testFixtures*`, `kaptTest`, `kaptAndroidTest`, and
 * `kspTest` are dev. `debugImplementation` and `ksp` stay production. The same
 * coordinate on `androidTestImplementation` and `implementation` stays
 * production, and the production declaration supplies the version.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGradleVersionCatalog } from '../src/core-open/scanners/gradle-version-catalog.js';
import { parseGradleBuild, scanJavaProjects } from '../src/core-open/scanners/java-scanner.js';
import { MavenCache } from '../src/core-open/scanners/maven-cache.js';
import { Semaphore } from '../src/core-open/utils/semaphore.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/gradle-android/build.gradle.kts', import.meta.url));

/** package, version, configuration, section. Scan order is code-unit sort. */
const ROWS: Array<[string, string, string, string]> = [
  ['androidx.test.espresso:espresso-core', '3.6.1', 'androidTestImplementation', 'devDependencies'],
  ['com.example:compile-only-api', '1.0.0', 'compileOnlyApi', 'dependencies'],
  ['com.example:debug-compile-only', '1.0.0', 'debugCompileOnly', 'dependencies'],
  ['com.example:debug-lib', '1.0.0', 'debugImplementation', 'dependencies'],
  ['com.example:dev-only', '1.0.0', 'developmentOnly', 'dependencies'],
  ['com.example:fixtures-api', '1.0.0', 'testFixturesApi', 'devDependencies'],
  ['com.example:fixtures-impl', '1.0.0', 'testFixturesImplementation', 'devDependencies'],
  ['com.example:free-lib', '1.0.0', 'freeImplementation', 'dependencies'],
  ['com.example:kapt-android-test', '1.0.0', 'kaptAndroidTest', 'devDependencies'],
  ['com.example:kapt-test', '1.0.0', 'kaptTest', 'devDependencies'],
  ['com.example:ksp-test', '1.0.0', 'kspTest', 'devDependencies'],
  ['com.example:release-api', '1.0.0', 'releaseApi', 'dependencies'],
  ['com.example:release-lib', '1.0.0', 'releaseImplementation', 'dependencies'],
  ['com.example:release-runtime', '1.0.0', 'releaseRuntimeOnly', 'dependencies'],
  ['com.example:shared', '1.2.3', 'implementation', 'dependencies'],
  ['com.google.dagger:hilt-compiler', '2.52', 'ksp', 'dependencies'],
];

const CATALOG = `
[versions]
espresso = "3.6.1"
hilt = "2.52"
debug = "1.4.0"

[libraries]
espresso = { module = "androidx.test.espresso:espresso-core", version.ref = "espresso" }
hilt = { module = "com.google.dagger:hilt-compiler", version.ref = "hilt" }
debug-lib = { module = "com.example:debug-lib", version.ref = "debug" }
`;

function offlineMavenCache(): MavenCache {
  const cache = new MavenCache(new Semaphore(1));
  vi.spyOn(cache, 'get').mockImplementation(async () => ({
    latest: null,
    stableVersions: [],
    latestStableOverall: null,
  }));
  return cache;
}

describe('Android Gradle configurations', () => {
  let root: string;

  afterEach(() => {
    vi.restoreAllMocks();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads variant, Android, ksp, and kapt configurations from an app module', async () => {
    const source = fs.readFileSync(FIXTURE, 'utf8');
    const parsed = parseGradleBuild(source, path.join('app', 'build.gradle.kts'));
    const stored = new Map(parsed.dependencies.map((dep) => [`${dep.groupId}:${dep.artifactId}`, dep]));
    expect([...stored.keys()].sort()).toEqual(ROWS.map(([name]) => name).sort());
    for (const [name, version, configuration] of ROWS) {
      expect(stored.get(name)?.version).toBe(version);
      expect(stored.get(name)?.configuration).toBe(configuration);
    }
    expect(stored.has('com.example:not-a-dep')).toBe(false);
    expect(stored.has('com.example:smoke')).toBe(false);
    expect(stored.has('com.example:legacy')).toBe(false);

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-gradle-android-'));
    fs.writeFileSync(path.join(root, 'build.gradle.kts'), source);
    const projects = await scanJavaProjects(root, offlineMavenCache());
    expect(projects).toHaveLength(1);
    expect(projects[0]!.dependencies.map((dep) => [dep.package, dep.currentSpec, dep.section])).toEqual(
      ROWS.map(([name, version, , section]) => [name, version, section]),
    );
  });

  it('reads the same names from a Groovy script and from catalog aliases', () => {
    const groovy = [
      "androidTestImplementation 'com.example:shared:9.9.9'",
      "implementation 'com.example:shared:1.2.3'",
      "debugImplementation 'com.example:debug-lib:1.0.0'",
      "ksp 'com.google.dagger:hilt-compiler:2.52'",
      "notimplementation 'com.example:not-a-dep:1.0.0'",
    ].join('\n');
    const parsed = parseGradleBuild(groovy, path.join('app', 'build.gradle'));
    const stored = new Map(parsed.dependencies.map((dep) => [`${dep.groupId}:${dep.artifactId}`, dep]));
    expect(stored.get('com.example:shared')).toMatchObject({ version: '1.2.3', configuration: 'implementation' });
    expect(stored.get('com.example:debug-lib')?.configuration).toBe('debugImplementation');
    expect(stored.get('com.google.dagger:hilt-compiler')?.configuration).toBe('ksp');
    expect(stored.has('com.example:not-a-dep')).toBe(false);

    const catalog = parseGradleVersionCatalog(CATALOG);
    const aliases = parseGradleBuild(
      [
        'dependencies {',
        '    androidTestImplementation(libs.espresso)',
        '    ksp(libs.hilt)',
        '    debugImplementation(libs.debug.lib)',
        '    notimplementation(libs.espresso)',
        '}',
      ].join('\n'),
      path.join('app', 'build.gradle.kts'),
      catalog,
    );
    const aliasStored = new Map(aliases.dependencies.map((dep) => [`${dep.groupId}:${dep.artifactId}`, dep]));
    expect(aliasStored.get('androidx.test.espresso:espresso-core')).toMatchObject({
      version: '3.6.1',
      configuration: 'androidTestImplementation',
    });
    expect(aliasStored.get('com.google.dagger:hilt-compiler')).toMatchObject({ version: '2.52', configuration: 'ksp' });
    expect(aliasStored.get('com.example:debug-lib')).toMatchObject({
      version: '1.4.0',
      configuration: 'debugImplementation',
    });
  });
});
