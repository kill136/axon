/**
 * pickProjectIcon 测试
 *
 * 测试根据目录内容自动推断项目 icon 的逻辑。
 * 由于 pickProjectIcon 是 blueprint-api.ts 内部函数，
 * 我们提取核心逻辑进行独立测试。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 因为 pickProjectIcon 是模块内部函数，我们复刻一份核心逻辑用于测试
function pickProjectIcon(projectPath: string): string {
  try {
    const entries = new Set<string>();
    for (const entry of fs.readdirSync(projectPath)) {
      entries.add(entry.toLowerCase());
    }

    const has = (name: string) => entries.has(name);
    const hasAny = (...names: string[]) => names.some(n => entries.has(n));
    const hasExt = (ext: string) => {
      for (const e of entries) {
        if (e.endsWith(ext)) return true;
      }
      return false;
    };

    // 游戏引擎
    if (hasAny('project.godot', 'projectsettings.asset')) return '🎮';
    if (has('assets') && has('projectsettings')) return '🎮';

    // 移动端 — Android 需要有 app/ 目录或 AndroidManifest.xml 才算
    if (has('androidmanifest.xml') || (hasAny('build.gradle', 'build.gradle.kts') && has('app') && !has('package.json'))) return '📱';
    if (hasAny('podfile', 'info.plist', '.xcodeproj', '.xcworkspace')) return '🍎';
    if (has('pubspec.yaml')) return '📱';

    // Python
    if (hasAny('requirements.txt', 'setup.py', 'pyproject.toml', 'pipfile')) {
      if (hasAny('manage.py')) return '🌐';
      if (hasAny('app.py', 'main.py') && hasAny('templates', 'static')) return '🌐';
      if (hasExt('.ipynb')) return '🔬';
      return '🐍';
    }

    // Rust
    if (has('cargo.toml')) return '🦀';
    // Go
    if (has('go.mod')) return '🐹';
    // Java/Kotlin
    if (has('pom.xml') || (has('build.gradle') && !has('package.json'))) return '☕';
    // C/C++
    if (hasAny('cmakelists.txt', 'makefile', 'meson.build')) return '⚙️';
    // .NET
    if (hasExt('.csproj') || hasExt('.sln') || hasExt('.fsproj')) return '🟣';

    // 前端框架
    if (has('package.json')) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps['next']) return '▲';
        if (allDeps['nuxt'] || allDeps['nuxt3']) return '💚';
        if (allDeps['react'] || allDeps['react-dom']) return '⚛️';
        if (allDeps['vue']) return '💚';
        if (allDeps['svelte'] || allDeps['@sveltejs/kit']) return '🔥';
        if (allDeps['angular'] || allDeps['@angular/core']) return '🅰️';
        if (allDeps['electron']) return '🖥️';
        if (allDeps['express'] || allDeps['fastify'] || allDeps['koa']) return '🌐';
      } catch { /* ignore */ }
      return '📦';
    }

    // 文档
    if (hasAny('mkdocs.yml', 'docusaurus.config.js', 'book.toml')) return '📖';
    if (hasExt('.tex') || has('main.tex')) return '📄';
    if (hasAny('readme.md', 'index.md') && !has('package.json') && !has('cargo.toml')) return '📝';

    // Docker
    if (hasAny('dockerfile', 'docker-compose.yml', 'docker-compose.yaml')) return '🐳';
    if (hasAny('.terraform', 'terraform.tf', 'main.tf')) return '☁️';

    // 数据
    if (hasExt('.csv') || hasExt('.parquet') || hasExt('.sqlite') || hasExt('.db')) return '🗄️';

    // 空目录
    if (entries.size === 0) return '✨';

    return '📁';
  } catch {
    return '📁';
  }
}

describe('pickProjectIcon', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-icon-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('空目录返回 ✨', () => {
    expect(pickProjectIcon(tmpDir)).toBe('✨');
  });

  it('React 项目返回 ⚛️', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { 'react': '^18.0.0', 'react-dom': '^18.0.0' },
    }));
    expect(pickProjectIcon(tmpDir)).toBe('⚛️');
  });

  it('Next.js 项目返回 ▲', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { 'next': '^14.0.0', 'react': '^18.0.0' },
    }));
    expect(pickProjectIcon(tmpDir)).toBe('▲');
  });

  it('Vue 项目返回 💚', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { 'vue': '^3.0.0' },
    }));
    expect(pickProjectIcon(tmpDir)).toBe('💚');
  });

  it('Express 项目返回 🌐', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { 'express': '^4.0.0' },
    }));
    expect(pickProjectIcon(tmpDir)).toBe('🌐');
  });

  it('Electron 项目返回 🖥️', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { 'electron': '^28.0.0' },
    }));
    expect(pickProjectIcon(tmpDir)).toBe('🖥️');
  });

  it('纯 Node.js 项目（无特定框架）返回 📦', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'my-lib',
      dependencies: { 'lodash': '^4.0.0' },
    }));
    expect(pickProjectIcon(tmpDir)).toBe('📦');
  });

  it('Python 项目返回 🐍', () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'flask\nrequests\n');
    expect(pickProjectIcon(tmpDir)).toBe('🐍');
  });

  it('Django 项目返回 🌐', () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'django\n');
    fs.writeFileSync(path.join(tmpDir, 'manage.py'), '');
    expect(pickProjectIcon(tmpDir)).toBe('🌐');
  });

  it('Rust 项目返回 🦀', () => {
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "test"');
    expect(pickProjectIcon(tmpDir)).toBe('🦀');
  });

  it('Go 项目返回 🐹', () => {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/test');
    expect(pickProjectIcon(tmpDir)).toBe('🐹');
  });

  it('Java Maven 项目返回 ☕', () => {
    fs.writeFileSync(path.join(tmpDir, 'pom.xml'), '<project></project>');
    expect(pickProjectIcon(tmpDir)).toBe('☕');
  });

  it('C++ CMake 项目返回 ⚙️', () => {
    fs.writeFileSync(path.join(tmpDir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.0)');
    expect(pickProjectIcon(tmpDir)).toBe('⚙️');
  });

  it('.NET 项目返回 🟣', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.csproj'), '<Project></Project>');
    expect(pickProjectIcon(tmpDir)).toBe('🟣');
  });

  it('Flutter 项目返回 📱', () => {
    fs.writeFileSync(path.join(tmpDir, 'pubspec.yaml'), 'name: test_app');
    expect(pickProjectIcon(tmpDir)).toBe('📱');
  });

  it('Godot 游戏项目返回 🎮', () => {
    fs.writeFileSync(path.join(tmpDir, 'project.godot'), '');
    expect(pickProjectIcon(tmpDir)).toBe('🎮');
  });

  it('Docker 项目返回 🐳', () => {
    fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM node:18');
    expect(pickProjectIcon(tmpDir)).toBe('🐳');
  });

  it('iOS 项目返回 🍎', () => {
    fs.writeFileSync(path.join(tmpDir, 'Podfile'), '');
    expect(pickProjectIcon(tmpDir)).toBe('🍎');
  });

  it('文档项目返回 📝', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hello');
    expect(pickProjectIcon(tmpDir)).toBe('📝');
  });

  it('纯 Gradle 项目（无 package.json）返回 ☕', () => {
    fs.writeFileSync(path.join(tmpDir, 'build.gradle'), 'apply plugin: "java"');
    expect(pickProjectIcon(tmpDir)).toBe('☕');
  });

  it('Gradle + package.json 应识别为 Node.js 而非 Java', () => {
    fs.writeFileSync(path.join(tmpDir, 'build.gradle'), '');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));
    // build.gradle + package.json → package.json 的 Node 检测优先
    expect(pickProjectIcon(tmpDir)).toBe('📦');
  });

  it('不存在的目录返回 📁', () => {
    expect(pickProjectIcon(path.join(tmpDir, 'nonexistent'))).toBe('📁');
  });

  it('Jupyter notebook 项目返回 🔬', () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'pandas\n');
    fs.writeFileSync(path.join(tmpDir, 'analysis.ipynb'), '{}');
    expect(pickProjectIcon(tmpDir)).toBe('🔬');
  });

  it('Svelte 项目返回 🔥', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { 'svelte': '^4.0.0' },
    }));
    expect(pickProjectIcon(tmpDir)).toBe('🔥');
  });

  it('Terraform 项目返回 ☁️', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.tf'), 'provider "aws" {}');
    expect(pickProjectIcon(tmpDir)).toBe('☁️');
  });

  it('数据文件目录返回 🗄️', () => {
    fs.writeFileSync(path.join(tmpDir, 'data.csv'), 'a,b,c');
    expect(pickProjectIcon(tmpDir)).toBe('🗄️');
  });
});
