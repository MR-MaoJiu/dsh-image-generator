---
name: image-generation
description: Generate images from text prompts with the generate_image tool. Use when the user asks to create, draw, or generate an image, illustration, poster, avatar, logo, wallpaper, cover art, or any visual from a description.
---

# 图片生成技能（Image generation）

使用 `generate_image` 工具把文字描述变成图片，图片会以附件形式保存并在对话中展示。

## 何时使用

- 用户想要一张图片、插画、海报、头像、Logo、壁纸、封面图，或任何「从描述生成的视觉内容」。
- 用户想可视化某个场景、概念或想法。
- 用户提到「画一个 / 生成一张 / 设计一个」等图片诉求。

## 使用步骤

1. **打磨提示词**：写一段详细的英文 prompt，包含主体、风格、构图、光线、色彩、氛围。把用户的中文描述翻译并扩写，而不是逐字直译。
2. **调用工具**：`generate_image`，必填 `prompt`；`size` 可选（`1024x1024` 方形、`1792x1024` 横版、`1024x1792` 竖版、`768x768` 小方形）。
3. **汇报结果**：告诉用户图片已生成，附上返回的路径与简短描述。

## 提示词建议

- 明确主体与动作：`a red fox jumping over a fence in a snowy forest`
- 指定风格：`flat vector illustration` / `watercolor painting` / `photorealistic` / `cyberpunk neon`
- 加上光线与镜头：`golden hour lighting, shallow depth of field`
- 负面控制（如需）：把不想出现的内容写进 `prompt` 的否定表述，或换个说法重写提示词。

## 注意事项

- 后端自动选择：能拿到 OpenAI key（复用模型配置里保存的 `OPENAI_API_KEY`）时优先走 OpenAI 最新生图模型 `gpt-image-2.6-flare`；没有配置则回退免费的 Pollinations。除非用户明确要求，否则不要传 `provider` 参数。
- OpenAI GPT image 模型支持任意分辨率（宽高需能被 16 整除，比例 1:3~3:1，最长边 ≤3840），工具会自动校验并归一化不合法的尺寸。
- Pollinations 免费档同 IP 每 45 秒仅 1 张，工具会自动等待重试一次；仍失败时把错误信息如实告诉用户。
- 生成失败时（网络、限流、内容拦截、key 无效），把错误信息如实告诉用户，并可尝试改写提示词重试一次；用户想用免费后端时可显式传 `provider: "pollinations"`。
