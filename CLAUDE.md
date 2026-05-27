# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **professional Remotion video component library** for creating tech tutorial videos with Apple-style aesthetics and FilmStorm-level quality.

**Goal**: Build a reusable component library for AI tech content creators, featuring:
- Apple-style minimal design (#000000 background + #007AFF accent)
- Organic, non-mechanical animations
- Professional SVG icons (no emoji)
- Code demonstrations with syntax highlighting
- Data visualization and metrics

---

## Development Commands

```bash
# Start Remotion Studio (live preview at http://localhost:3000)
npm run dev

# Run linting (ESLint + TypeScript)
npm run lint

# Bundle for rendering
npm run build

# Render specific composition
npx remotion render src/index.ts <CompositionID> out/video.mp4

# Upgrade Remotion
npm run upgrade
```

---

## Architecture

### Design System (src/design-system/)

**tokens.ts** - Centralized design constants:
- Colors: Apple-style palette (#000000 bg, #007AFF primary)
- Fonts: SF Pro Display/Text, JetBrains Mono
- Sizes: Large typography (hero: 120px, h1: 88px)
- Spacing, radius, animation durations

**animations.ts** - Animation presets:
- Spring presets: smooth, snappy, bouncy, heavy, playful
- Entrance animations: fade, slideUp, slideLeft, scale
- Decorative: lineExpand, glowSweep, breathe

### Component Library (src/components/new/)

All new components go here. Import via `src/components/new/index.ts`.

#### Core Components

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **HeroTitle** | Opening titles | Reveal animation, glow sweep, tags |
| **SectionTitle** | Chapter headers | Section number, progress bar, left indicator |
| **CodeTerminal** | Code display | macOS terminal style, line-by-line typing, syntax highlight |
| **AnimatedList** | Feature lists | Staggered entrance, icons, check animations |
| **FeatureCard** | Feature showcases | Icon + title + description, grid layout |
| **MetricCard** | Data metrics | Animated number counting, large typography |
| **Transitions** | Scene transitions | Fade, Slide, LightSweep, ZoomBlur, CurtainReveal |

#### Icon Library (src/components/new/Icons.tsx)

**50+ SVG icons** based on Heroicons (MIT) and Lucide (ISC) - free for commercial use.

Common icons:
- Tech: Computer, Bot, Terminal, Code, Database, Network
- Actions: Check, Plus, Minus, Close, ArrowRight, Download
- General: User, File, Folder, Calendar, Clock, Settings

**Usage**:
```tsx
import { Zap, Lock, Computer } from '../components/new/Icons';
<Zap size={24} color="#007AFF" strokeWidth={2} />
```

**Important**: Never use emoji. Always use icons from Icons.tsx.
AI 生成的文案如果需要图标，禁止使用 emoji，必须优先使用 SVG 图标或开源组件库中的高质感图标。

---

## Component Usage Patterns

### HeroTitle
```tsx
<HeroTitle
  title="OpenClaw"
  subtitle="完全新手指南"
  tags={["AI 编码助手", "开源免费", "自托管部署"]}
/>
```

### CodeTerminal
```tsx
<CodeTerminal
  code={`npm install -g openclaw`}
  language="bash"
  filename="install.sh"
  typingSpeed={1}
  showLineNumbers={true}
/>
```

### AnimatedList (with icons)
```tsx
<AnimatedList
  items={[
    { title: '...', description: '...', icon: 'computer' },
    { title: '...', description: '...', icon: 'bot' },
  ]}
  variant="card"
/>
```

### FeatureGrid (with icons)
```tsx
<FeatureGrid
  features={[
    { icon: 'zap', title: '极速响应', description: '...' },
    { icon: 'lock', title: '隐私安全', description: '...' },
  ]}
  columns={3}
/>
```

---

## 竖屏（9:16）组件规范

竖屏视频画布 **1080×1920**，用于抖音/视频号/快手等手机端传播。

### 布局常量
```tsx
import { VERTICAL } from '../components/new/vertical';
// VERTICAL.WIDTH: 1080, VERTICAL.HEIGHT: 1920
// VERTICAL.SAFE_TOP: 100 (避开 notch)
// VERTICAL.SAFE_BOTTOM: 100 (避开 home indicator)
// VERTICAL.SAFE_SIDE: 60 (左右边距)
```

### 通用竖屏组件（src/components/new/）
| 组件 | 用途 | 参数 |
|------|------|------|
| `PortraitGridBackground` | 竖屏网格背景（推荐） | opacity, gridSize, accentColor |
| `LandscapeGridBackground` | 横屏网格背景 | opacity, gridSize, accentColor |
| `GridBackground` | GridBackground 别名（兼容旧版） | opacity, gridSize |
| `GridSceneBackground` | 场景网格背景 | variant, opacity |
| `VerticalBackground` | 纯色竖屏背景（底层） | opacity |
| `SafeArea` | 安全区包装 | top, bottom, side |
| `ScreenPlaceholder` | 录屏站位虚线框 | frame, delay, label |
| `VerticalSectionTitle` | 竖屏章节标题 | title, subtitle, variant |
| `MetricComparison` | 对比柱状图 | before/after 数据 |
| `VerticalCodeTerminal` | 打字机代码终端 | lines, typingSpeed |

### 标准竖屏段落模板
```tsx
const Segment: React.FC = () => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - 10, fps: 30, config: SPRING_PRESETS.snappy });
  const op = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background }}>
      <GridBackground />
      <SafeArea style={{ gap: VERTICAL.GAP }}>
        <VerticalSectionTitle title="标题" delay={0} />
        {/* content */}
      </SafeArea>
    </AbsoluteFill>
  );
};
```

### 竖屏动画规则
- 入口用 `spring({ damping: 14, stiffness: 60 })`，交错 8-15 帧
- 动画范围：translateY ≤ 20px，scale ≥ 0.85，rotateY 常用
- 副标题只用淡入 + breathe，不用位移
- `SafeArea` 确保内容不超出 notch/home indicator

所有竖屏通用组件统一放在 `src/components/new/`，通过 `index.ts` 导出。

---

## Animation Guidelines

### Do's
- Use `useCurrentFrame()` for all animations
- Use `spring()` for natural motion
- Use `interpolate()` with easing functions
- Stagger list items with frame delays

### Don'ts
- **Never use CSS animations** (they won't render)
- **Never use Tailwind animation classes**
- **Never use emoji** (use SVG icons instead)
- Avoid mechanical timing (use organic easing)

### Example Pattern
```tsx
const frame = useCurrentFrame();
const { fps } = useVideoConfig();

// Spring animation
const scale = spring({
  frame,
  fps,
  config: { damping: 25, stiffness: 100 },
});

// Interpolation with easing
const opacity = interpolate(frame, [0, 20], [0, 1], {
  extrapolateLeft: 'clamp',
  easing: Easing.out(Easing.quad),
});
```

---

## Styling Guidelines

### Colors (from tokens.ts)
```tsx
import { COLORS } from '../design-system/tokens';
// Background: COLORS.background (#000000)
// Primary: COLORS.primary (#007AFF)
// Text: COLORS.text (#FFFFFF)
// Secondary: COLORS.textSecondary (#8E8E93)
```

### Fonts
```tsx
import { FONTS } from '../design-system/tokens';
// Display: FONTS.display (SF Pro Display)
// Text: FONTS.text (SF Pro Text)
// Mono: FONTS.mono (JetBrains Mono)
```

### Typography Scale
- hero: 120px (main titles)
- h1: 88px (section titles)
- h2: 56px (subsections)
- h3: 40px (card titles)
- h4: 28px (small headers)
- body: 20px (descriptions)

---

## File Structure

```
src/
├── design-system/          # Design tokens and animation utilities
│   ├── tokens.ts           # Colors, fonts, sizes
│   └── animations.ts       # Spring presets, entrance helpers
├── components/new/         # Reusable component library (横屏 + 竖屏)
│   ├── index.ts            # Exports
│   ├── vertical.ts         # 竖屏常量 (VERTICAL.WIDTH, SAFE_TOP, ...)
│   ├── HeroTitle.tsx       # 横屏开场标题
│   ├── SectionTitle.tsx    # 横屏章节标题
│   ├── CodeTerminal.tsx    # 横屏代码终端
│   ├── AnimatedList.tsx    # 动画列表
│   ├── FeatureCard.tsx     # 功能卡片
│   ├── MetricCard.tsx      # 指标卡片
│   ├── Transitions.tsx     # 场景过渡
│   ├── Icons.tsx           # 50+ SVG icons
│   ├── DataTable.tsx       # 数据表格
│   ├── HighlightQuote.tsx  # 高亮引用
│   ├── TypewriterText.tsx  # 打字机效果
│   ├── CommentBubble.tsx   # 弹幕/评论
│   ├── CausalGraph.tsx     # 因果关系图谱
│   ├── ComparisonCards.tsx  # 对比卡片
│   ├── ProcessFlow.tsx     # 流程步骤
│   ├── EvolutionTree.tsx   # 演进树
│   ├── KnowledgeWeb.tsx    # 知识网络
│   ├── ProductIntro.tsx    # 产品介绍
│   ├── LanguageStream.tsx  # 多语言流动
│   ├── DualChannelWave.tsx # 双通道声波
│   ├── MetricHighlight.tsx # 数据冲击
│   ├── PortraitGridBackground.tsx  # 竖屏网格背景
│   ├── LandscapeGridBackground.tsx  # 横屏网格背景
│   ├── GridBackground.tsx  # 网格背景别名
│   ├── GridSceneBackground.tsx  # 场景网格背景
│   ├── VerticalBackground.tsx  # 竖屏纯色背景
│   ├── SafeArea.tsx        # 竖屏安全区
│   ├── ScreenPlaceholder.tsx  # 录屏站位
│   ├── VerticalSectionTitle.tsx  # 竖屏章节标题
│   ├── VoxCpmSectionTitle.tsx  # 竖屏章节标题（带装饰）
│   ├── MetricComparison.tsx  # 对比柱状图
│   └── VerticalCodeTerminal.tsx  # 竖屏代码终端
├── scenes/demo/           # Demo compositions
│   ├── DemoScenes.tsx
│   ├── NewComponentsDemo.tsx
│   ├── RemotionIntro.tsx
│   └── RemotionBestPracticesIntro.tsx
├── Root.tsx               # Composition definitions
└── index.ts               # Entry point
```

---

## Dependencies

Key packages:
- `remotion` @ 4.0.434 - Video generation
- `@remotion/transitions` - Scene transitions
- `tailwindcss` @ 4.0.0 - Styling
- React @ 19.2.3

---

## TTS / Voiceover

User plans to implement Alibaba Cloud TTS as a Skill.
- Skip Edge TTS / ElevenLabs for now
- Voiceover sync system not yet implemented

---

## Common Issues & Solutions

### 1. LightSweep shows transparency at bottom
**Fix**: Add explicit `height` parameter:
```tsx
<LightSweep duration={30} height={1080} />
```

### 2. Flickering animation warning
**Cause**: Animation not purely driven by `useCurrentFrame()`
**Fix**: Ensure all animated values derive from frame

### 3. Emoji not rendering
**Policy**: Use SVG icons from Icons.tsx instead

### 4. Type errors with icons
**Fix**: Import IconProps and use proper typing:
```tsx
import { Zap, IconProps } from './Icons';
const iconMap: Record<string, React.FC<IconProps>> = { zap: Zap };
```

---

## Next Steps (Roadmap)

- [ ] AudioWaveform component (audio visualization)
- [ ] Chart components (BarChart, LineChart)
- [ ] TypewriterText effect
- [ ] Voiceover sync system
- [ ] TransitionSeries scene orchestration
- [ ] @remotion/light-leaks integration

---

## Contact

For questions about this component library, refer to:
- `src/components/new/` - Component implementations
- `src/design-system/` - Design tokens

---

## External Tools

### TTS CLI (配音生成)

当用户需要配音时，先询问 VoxCPM2 TTS 整合包的路径，然后使用完整路径调用：

```bash
# 配置参考音频
tts-cli config reference_audio "D:\my_voice.wav"

# 声音克隆
tts-cli clone "文案文字" [输出.wav]

# 声音设计
tts-cli design "描述(文字)" [输出.wav]

# 批量处理
tts-cli batch texts.txt ./outputs/
```

配音文件建议放在 `public/voiceover/` 目录。
