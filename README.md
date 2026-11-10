# DSH Image Generator

在 DeepSeek Harness（DSH）对话中直接生成图片的插件：内置 `generate_image` 工具与 `image-generation` 技能，生成过程带 Codex 风格的进度动效，结果以原生大图直接展示。

![示例：社交产品 UI 概念图](docs/example-social-ui.png)

## 特性

- **一句话生成图片**：对话中直接调用 `generate_image`，图片作为附件保存并在会话中展示
- **GPT 最新生图模型优先**：自动复用 DSH 模型配置中已保存的 `OPENAI_API_KEY`，默认走 OpenAI `gpt-image-2.6-flare`；未配置 key 时自动回退到免费的 Pollinations
- **任意分辨率**：支持 `1024x1024`、`1792x1024`、`1024x1792`、`768x768`，也可传任意尺寸（宽高 16 整除、比例 1:3~3:1、最长边 ≤3840，工具自动校验归一化）
- **Codex 风格动效**：生成中显示按目标宽高比渲染的深灰点阵卡片（双层点阵流动 + 光晕呼吸 + 绿色百分比胶囊），出图时布局不跳动；完成后图片直接大图展示
- **内置技能**：`image-generation` 技能教模型如何打磨提示词、调用工具与汇报结果，用户提出图片需求时可直接使用

## 安装

### 从 GitHub 安装

```bash
dsh plugin add git+https://github.com/MR-MaoJiu/dsh-image-generator.git
```

### 本地开发安装

```bash
dsh plugin add /path/to/dsh-image-generator
```

安装完成后重启或刷新 DSH 页面即可。插件会注册：

- Host 工具 `generate_image`
- 运行时技能 `image-generation`
- Web 端工具卡片视图（`tool.call.toolview` key: `generate_image`）

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `provider` | 自动 | `openai` / `pollinations`，默认按是否配置了 key 自动选择 |
| `openaiBaseUrl` | `https://api.openai.com/v1` | OpenAI 兼容 API 地址 |
| `openaiModel` | `gpt-image-2.6-flare` | OpenAI 生图模型 |
| `openaiApiKey` | 空 | 显式指定 key；留空时自动读取 DSH 凭证中的 `OPENAI_API_KEY` |
| `openaiApiKeyEnv` | `OPENAI_API_KEY` | 凭证引用名 |
| `pollinationsModel` | `flux` | 免费后端模型 |
| `pollinationsEnhance` | `false` | 免费后端是否开启提示词增强 |
| `timeoutMs` | `120000` | 单次生成超时 |

> 未配置 OpenAI key 时自动使用 Pollinations 免费后端（同 IP 每 45 秒 1 张，尺寸会被服务端缩放）。

## 使用

模型在对话中会这样调用：

```json
{ "prompt": "a cozy Japanese ramen shop at night, warm lantern light, photorealistic", "size": "1792x1024" }
```

也可以显式指定后端：

```json
{ "prompt": "...", "size": "1024x1024", "provider": "pollinations" }
```

## 开发

```bash
node --check index.js
node --check client.js
```

修改后重新安装使插件生效：

```bash
dsh plugin remove dsh-image-generator
dsh plugin add ./dsh-image-generator
```

## 许可证

[MIT](LICENSE)
