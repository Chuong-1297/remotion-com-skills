---
name: tts-voiceover
description: |
  Generate voiceover audio using local VoxCPM2 TTS model with voice cloning.
  TRIGGER when the user says anything about: 配音, 配音, 语音合成, TTS, voice clone,
  voiceover, 克隆声音, 音色设计, 用我的声音, 朗读文案, 生成语音, 音频克隆, 语音生成,
  or asks to turn text into speech / narration / voiceover.
  This skill handles the entire workflow: locating the TTS integration package,
  configuring reference audio, generating voice clone or voice design audio,
  and saving output files.
  Use this whenever the user wants to generate spoken audio from text, even if they
  don't explicitly mention "TTS" — if they want narration, voiceover, or cloned voice,
  this skill applies.
---

# TTS Voiceover Skill

## 概述

本 skill 封装了本地 VoxCPM2 TTS 模型的配音流程。首次使用时，需要先确认用户的环境配置。

## 工作流程

### 第一步：询问整合包路径

用户提出配音需求后，**主动询问**整合包位置：

> "请告诉我你的 VoxCPM2 TTS 整合包放在哪个目录？比如 `D:\Tools\jinxi-voxcpm-tts\`"

如果用户不清楚，引导用户：
- 整合包包含 `tts-cli.bat`、`python/`、`models/` 等文件
- 通常是下载后解压的文件夹
- 可以提供几个常见路径示例让用户选择

### 第二步：检查参考音频配置

询问用户：

> "是否已配置参考音频（用于声音克隆）？如果没有，请告诉我你的参考音频文件路径，我来帮你配置。"

根据回答：
- **有参考音频** → 获取路径后执行 `tts-cli config reference_audio "路径"`
- **没有但想用声音克隆** → 引导用户准备一段 10 秒以上的干净录音（.wav），然后配置
- **不需要声音克隆** → 使用 voice design 模式，无需参考音频

### 第三步：生成配音

根据用户需求选择模式：

**声音克隆（clone）** — 用参考音频的音色朗读指定文案
```bash
tts-cli clone "文案内容" [输出路径.wav]
tts-cli clone "文案内容" --ref "其他参考音频.wav"  # 临时换参考音频
```

**声音设计（design）** — 通过文字描述生成音色，不需要参考音频
```bash
tts-cli design "描述文字(文案内容)" [输出路径.wav]
# 示例: tts-cli design "暴躁中年男声，语速快，愤怒(踩离合！你往哪开呢！)" output.wav
# 示例: tts-cli design "温柔女声，舒缓柔和(你好，欢迎光临)" output.wav
```

**批量处理（batch）** — 每行一条文案，批量生成
```bash
tts-cli batch 文案列表.txt [输出目录]
# 每行可以单独指定参考音频:
# 文案内容 ||| 自定义参考音频.wav
```

### 第四步：输出文件

- 默认输出到整合包目录下的 `outputs/` 文件夹
- 也可以指定任意输出路径
- 格式：48kHz mono WAV
- 如果用在 Remotion 项目中，建议输出到 `public/voiceover/`

## 工具调用方式

确认整合包路径后，用完整路径调用：

```bash
# PowerShell / CMD
& "D:\path\to\tts-cli.bat" clone "文案内容" output.wav
```

如果用户在整合包目录下操作，也可以直接用相对路径：

```bash
cd /d D:\path\to\jinxi-voxcpm-tts
tts-cli clone "文案内容" output.wav
```

## 注意事项

1. **首次加载模型**约需 5-15 秒，请耐心等待
2. **音质受参考音频质量影响**：建议用 10 秒以上的干净录音，不要有背景噪音
3. **cfg_value**：默认 2.0，值越高越接近参考音频的语调风格（范围 1.0-3.0）
4. **声音设计**的文本格式：`(音色描述)要说的内容` — 括号内是音色描述，括号外是台词
5. **批量处理**支持每行单独指定参考音频，用 `|||` 分隔
6. 所有处理在本地完成，不上传数据
