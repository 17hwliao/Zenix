# Zenix 星音：本地助手形象与拖动修复

> 归档说明：下文保留各次本地开发时的状态。本轮相关成果已纳入 v1.2.0/r56 发行范围，最终状态以 [v1.2.0 说明](../releases/v1.2.0.md) 为准。

本轮只保存在本地，没有改版本号、构建号、签名、更新清单或远端工件。正式资料及当前验收资料不合并、不覆盖。

## 形象

原创 Q 版音乐看板娘“星音”：银蓝长发、耳机、星月发饰、Zenix 胸牌；采用透明 PNG 立绘与闭眼帧，叠加轻微呼吸、眨眼、状态反馈和播放律动。它采用 Live2D 风格美术，不引入持续运行的骨骼/物理引擎。减少动效、隐藏和页面不可见仍会停止相关动画。用户导入的皮肤继续保留，恢复默认才切回星音；创作模板现在包含真实默认形象。

源资源：

- [睁眼立绘](../../assets/assistant/zenix-muse.png)
- [眨眼帧](../../assets/assistant/zenix-muse-blink.png)

两个资源均为 1086×1448 RGBA，约 1.9 MB / 1.8 MB；使用内置 imagegen 生成、随后仅编辑眼睛生成闭眼帧，没有调用外部 API CLI。生成结果复制到仓库，项目不依赖生成工具的缓存目录。

生成提示词：

> Use case: stylized-concept. Production asset for Zenix music player's small transparent desktop companion, original polished Live2D-inspired anime chibi key visual. Create ONE isolated full-body young adult female mascot, original design, cute 3-head-tall chibi proportions, expressive large turquoise eyes, silver-blue long hair with soft lavender shaded tips, layered bangs, tiny star-shaped music hair accessory, elegant white and midnight navy oversized jacket with restrained cyan accents, modest pleated skirt over opaque dark tights and ankle boots, stylish compact headphones around neck, one hand warmly greeting and other resting near jacket pocket. Include the EXACT readable word "Zenix" on a wide dark badge across the jacket chest, and a tiny Z hairpin. High quality Japanese anime VTuber / Live2D illustration aesthetics: delicate clean linework, beautiful soft cel shading, translucent hair highlights, carefully drawn hands and face, cozy approachable adult female mascot. She must look like a thoughtfully designed character illustration, not an emoji, animal blob or generic vector icon. Front three-quarter view, calm friendly smile, entire head, hair, hands and feet fully within image with comfortable transparent padding. ONE character only, no alternate poses, no sheet, no panel, no UI, no border, no text outside the chest badge. Portrait composition about 3:4. Genuinely TRANSPARENT BACKGROUND with clean alpha, no checkerboard painted into image, no floor, no cast shadow rectangle. Intended to be legible at roughly 220px tall. Standalone finished digital character art, no existing copyrighted character.

闭眼帧编辑提示词：

> Precise minimal animation-frame edit to the supplied Zenix mascot PNG. Change ONLY her two eyes into naturally gently closed eyelids for one blink animation frame. Keep the same smiling mouth. EVERYTHING ELSE must remain identical: original canvas size and exact character position, pose, head/hair/clothes contours, hands, feet, colors, lighting, shading, tiny details, and exact readable Zenix jacket badge. Do not resize, zoom, move, redraw or add other elements. Preserve the genuine transparent background and alpha edges. The result is a matching closed-eye blink frame for the same desktop companion, not a new illustration.

## 拖动与边界

原桌宠只允许顶部 20px 小抓手使用原生 drag 区域，角色本体没有拖动入口。现改为整个角色/抓手的指针捕获，主进程仅移动所属桌宠窗口，以 Electron DIP 光标和显示器工作区计算位置，不接受前端指定任意窗口或屏幕坐标。每次手势有独立 token，旧手势的迟到 move/end 不会终止新手势。点击、拖动、锁定、取消和快捷按钮分开。

应用内角色不再被固定 ±80 / ±30 像素范围卡住，改为按容器实际可用区域移动；缩放/窗口大小变化会重新限制边界。移动不触发输入框，点击才唤起指令。Android 原生悬浮同步默认立绘、按比例绘制，并在拖动时取消长按菜单；无需新增权限。

## 验证

- 拖动规则与既有协作/桌宠测试：9/9。
- 真实隔离 Electron 桌宠：默认图片和透明 alpha、实际 pointer 事件→IPC→窗口位移、锁定、无误触播放、可关闭及减少动效。
- 真实工作台 UI：PC/模拟 Android 桥接、1000/390/320px，角色拖动不变点击、点击聚焦、原工作台恢复等用例通过（1/1）。
- TypeScript、PC Web、Android Web 和 Android 生产 Java 编译通过。没有重新打包或上传发布，没有将隔离测试当作手机实机通过。

本地验收入口已经改为读取当前源码/dist，并沿用之前同一个验收副本；已打开的旧进程需要从托盘正常退出后再启动。不能同时让两进程写同一验收副本。
