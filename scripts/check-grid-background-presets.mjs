import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const compositionFiles = listFiles(path.join(root, 'src/compositions'))
  .filter((file) => file.endsWith('.tsx'));
const directVerticalBackgroundImports = compositionFiles.filter((file) =>
  fs.readFileSync(file, 'utf8').includes('VerticalBackground')
);
const lowGridOpacityUsages = compositionFiles.flatMap((file) =>
  findLowGridOpacityUsages(file).map((value) =>
    `${path.relative(root, file)} gridOpacity={${value}}`
  )
);

const checks = [
  {
    label: '竖屏背景组件文件存在',
    ok: fs.existsSync(path.join(root, 'src/components/new/PortraitGridBackground.tsx')),
  },
  {
    label: '16:9 背景组件文件存在',
    ok: fs.existsSync(path.join(root, 'src/components/new/LandscapeGridBackground.tsx')),
  },
  {
    label: '统一导出竖屏背景组件',
    ok: includes('src/components/new/index.ts', "export { PortraitGridBackground } from './PortraitGridBackground';"),
  },
  {
    label: '统一导出16:9背景组件',
    ok: includes('src/components/new/index.ts', "export { LandscapeGridBackground } from './LandscapeGridBackground';"),
  },
  {
    label: 'CodeGraphIntro 复用竖屏背景组件',
    ok: includes('src/compositions/voxcpm/CodeGraphIntro.tsx', 'PortraitGridBackground'),
  },
  {
    label: 'UnderstandAnythingIntro reuses PortraitGridBackground',
    ok: includes('src/compositions/voxcpm/UnderstandAnythingIntro.tsx', 'PortraitGridBackground'),
  },
  {
    label: 'Composition files do not import low-level VerticalBackground directly',
    ok: directVerticalBackgroundImports.length === 0,
    details: directVerticalBackgroundImports.map((file) => path.relative(root, file)),
  },
  {
    label: 'Composition gridOpacity values stay visible',
    ok: lowGridOpacityUsages.length === 0,
    details: lowGridOpacityUsages,
  },
  {
    label: 'AGENTS.md documents required grid background presets',
    ok: includes('AGENTS.md', '竖屏 composition 必须使用 `PortraitGridBackground`'),
  },
  {
    label: 'remotion-components skill documents required grid background presets',
    ok: includes('.claude/skills/remotion-components/SKILL.md', '竖屏 composition 必须使用 `PortraitGridBackground`'),
  },
  {
    label: 'AGENTS.md 写入 AI 文案图标规范',
    ok: includes('AGENTS.md', 'AI 生成的文案如果需要图标，禁止使用 emoji，必须优先使用 SVG 图标或开源组件库中的高质感图标。'),
  },
  {
    label: 'CLAUDE.md 写入 AI 文案图标规范',
    ok: includes('CLAUDE.md', 'AI 生成的文案如果需要图标，禁止使用 emoji，必须优先使用 SVG 图标或开源组件库中的高质感图标。'),
  },
];

const failures = checks.filter((item) => !item.ok);

for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}`);
  if (!item.ok && item.details?.length) {
    for (const detail of item.details) {
      console.log(`  - ${detail}`);
    }
  }
}

if (failures.length > 0) {
  process.exitCode = 1;
}

function includes(relativePath, snippet) {
  const fullPath = path.join(root, relativePath);

  if (!fs.existsSync(fullPath)) {
    return false;
  }

  return fs.readFileSync(fullPath, 'utf8').includes(snippet);
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listFiles(fullPath);
    }

    return [fullPath];
  });
}

function findLowGridOpacityUsages(file) {
  const source = fs.readFileSync(file, 'utf8');
  const matches = source.matchAll(/gridOpacity=\{\s*([0-9.]+)\s*\}/g);

  return [...matches]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value < 0.14);
}
