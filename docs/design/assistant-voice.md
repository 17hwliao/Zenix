# 星音：按住语音与角色反馈

> 归档说明：下文保留各次本地开发时的状态。本轮相关成果已纳入 v1.2.0/r56 发行范围，最终状态以 [v1.2.0 说明](../releases/v1.2.0.md) 为准。

本轮为本地功能开发，源码版本字段仍为 1.1.0 / r55，未生成安装包或改动更新清单。后续如打包发行必须使用新的递增内部构建号，不能将新字节覆盖到已发布 r55 工件。既有歌单、配置和正式客户端不参与独立验收窗口。

## 操作与范围

- PC：在 Zenix 前台非输入控件区域按住空格；显示“正在听”后说话，松开提交。输入框保留空格输入，按钮保留键盘激活。也可按住麦克风按钮。没有注册系统全局裸空格热键。
- Android：应用内提供悬浮语音按钮，持续按住录入，松开提交，上滑取消。系统麦克风授权由用户处理；授权完成但手指已松开时不会补开录音。应用切后台取消本次录音。
- 文本和语音进入同一语义层。支持礼貌前缀、常见切歌口语、歌曲/歌手名称搜索、片段标记和少量角色交流。否定、复合或未知指令不自动执行；低置信度先显示理解结果并确认。它仍是受限音乐助手，没有接入通用聊天模型。
- 语音回复可关闭。识别错误保留文字编辑入口，错误不会清空歌单或中断播放器。搜索会展示版本选择，不因语音模糊匹配擅自替用户播放第一项。
- 点击默认角色触发捧脸、脸红、侧视的害羞姿势；聆听/交流切换手扶耳机姿势；回复期间使用独立闭口帧，局部口型切换不带动整个角色抖动。减少动效保留静态表情。

## 解耦与生命周期

`AssistantConversation.tsx` 负责按住会话、取消、理解结果和对话呈现；`intent.ts` 只产生登记过的音乐意图；`featureHost.ts` 沿用原播放器操作；`DefaultCharacter.tsx` 只负责显示动作。

PC `hold-recording.cjs` 仅在按住操作后请求麦克风，将录音保存在内存中。松开即释放设备，再将单声道 16 kHz PCM 交给 `AssistantSpeech`；Windows 使用已安装的中文 System.Speech 识别组件，不上传录音。缺少组件时提示使用文字。缓冲区按 8 MiB 音频数据上限保护内存，不用固定秒数切断正在说话的句子。

Android `AssistantSpeech.java` 使用 SpeechRecognizer，服务是否联网取决于用户安装的系统识别服务，不能承诺所有 Android 设备均离线。系统提前收好一句话时如实提示，仍等用户松开才提交。回复使用系统 TTS。当前长按麦克风位于应用内；应用外角色窗口没有常驻麦克风。

会话使用独立 token 和修订序号。松开前不执行；取消、离开、失焦和组件卸载后，迟到结果不能执行。已发给播放器的操作不能通过取消等待撤销，界面明确说明。音乐操作有同步互斥，重复确认不重复切歌。桌宠关闭只取消其自身语音，不能关闭主界面的语音服务。

系统接口依据：[Android SpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer)、[Windows SpeechRecognitionEngine](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.setinputtowavestream)。

## 本地验收入口

运行 `npm run preview:assistant`。窗口标题为“Zenix · 星音语音与动作验收”。窗口使用真实识别、语义与角色组件；音乐执行适配器明确只展示理解结果，不控制正式播放器。可切换手机布局，但 PC 上切换布局不能代替 Android 真机识别测试。普通关闭窗口会退出该验收进程。

本轮 TypeScript、PC/Android Web 构建、Android Java 编译已通过。必要自动检查覆盖空格输入隔离、按住/松开、重复按键、提前松手、取消后的迟到结果、低置信度确认去重、Chromium 真实触摸长按与上滑取消，以及桌宠语音资源归属。未进行手机实机语音识别、用户真人录音准确率或通用语义成功率统计。

## 原创动作资源与生成提示

使用内置 imagegen 编辑既有原创透明形象；保留原始文件，新资源均保存在项目 `assets/assistant/`，不是 Cubism 骨骼模型。

- `zenix-muse-shy.png`：1086 × 1448，透明捧脸害羞姿势。
- `zenix-muse-listening.png`：1086 × 1448，透明手扶耳机、开口交流姿势。
- `zenix-muse-speaking-closed.png`：1086 × 1448，交流姿势的闭口帧，仅局部口型用于交替显示。

最终提示词分别为：

```text
Edit target: attached Zenix 星音 transparent full-body chibi mascot. Create a matching SHY reaction state animation pose, not a new character. Preserve exact identity, rendering style, silver-blue long hair, aqua eyes, headphones, star moon hair ornament, jacket design and readable Zenix chest badge, boots, tights. Same canvas size 1086x1448 and same character scale, feet baseline and face center approximately anchored as reference, completely transparent background. Change pose meaningfully: bring both hands close to cheeks in a bashful gesture, head slightly tucked, rosy cheeks visibly blushing, eyes looking sideways, shy small smile. Sweet adult chibi music assistant, fully clothed. Clean alpha edges, no background, no external text, no extra props, no cropping. It must look like an intentional expressive reaction asset rather than a shifted or rotated reference.
```

```text
Edit target attached full-body transparent Zenix music mascot. Make a LISTENING / TALKING expressive pose for the SAME chibi character. Preserve exact identity silver-blue long hair, turquoise eyes, star crescent hair ornament, navy white jacket with exact readable Zenix chest badge, headphones, tights and boots, same rendering quality. Same 1086x1448 transparent canvas, full body same scale and foot baseline. Change one hand from waving to gently cupping headphone at ear, other hand open at chest height as conversational gesture, attentive eyes, mouth slightly OPEN in cheerful speaking expression. Head very slightly tilted attentively. This is an expressive state asset, not a new design. No background no panels no watermark no surrounding text. Keep face center approximately same and no cropping. Actual alpha.
```

```text
Precise animation frame edit of attached image. Keep EVERYTHING exactly the same pixel-aligned canvas 1086x1448, full body pose, hands holding headphone and open gesturing hand, face position, eye shape, hair, clothing and Zenix badge, shading and transparent alpha. Change ONLY the mouth from open into a small CLOSED friendly smile, to form a matching mouth animation pair for a speaking music mascot. Do not alter expression elsewhere, do not shift or scale the character, do not add anything. Preserve actual transparent background. This is a two-frame talking animation secondary frame, identity and pose invariance is essential.
```


## 2026-10-24：歌词、历史和歌单指令

文字、按住语音及桌宠转交的语音共用 `understand` → `libraryCommand` → `libraryHost`。解析器只生成登记过的动作；展示层不直接改文件，角色和录音模块不持有另一份用户资料。PC 使用当前播放器与 PersonalStore，Android 使用当前 Native snapshot / PrivateStore；沿用既有存储、通知和资料保护机制，不改更新通道。

可用示例：

- “当前歌曲的歌词是什么”“这首歌是谁唱的”：按实际播放版本取歌词或歌手；歌词正文以文字呈现，朗读简短反馈。
- “最近听过的十首歌曲”：按最近播放时间降序显示，记录不足十首时展示实际数量。
- “返回主界面”“打开歌单《通勤》”：只导航，不触发切歌或停止。
- “创建歌单《夜间》”“把当前歌曲加入一个新歌单”：未给名称时继续询问，给名称后确认；固定歌曲身份，询问期间切歌要求重新选择。
- “把当前歌单全部加入喜欢和收藏”“把当前队列全部加入喜欢”“把选中的歌曲加入收藏”：明确范围后预览并确认，已有记录保留，不通过 toggle 取消原喜欢；一次批量写入。
- “从歌单《通勤》删除《晴天》”“删除选中的歌曲”：仅从指定自定义歌单移出，保留本地文件、历史、喜欢收藏和其他歌单。重名歌曲须勾选具体版本；未指定范围不会默认整张删除。歌单名按完整名称匹配，重名歌单不猜选。

所有资料写入先显示数量、歌曲名称及确认／取消，支持高置信度说“确认”和重复点击去重。PC 及 Android 的批量勾选区域登记短生命周期上下文；退出页面即清理。确认后再核对源歌单顺序和成员，发生变化则中止；移出通过已有 expected 校验在存储侧再验证。当前歌曲加入新歌单在确认时固定目标，不因随后切歌换成另一首。取消和迟到歌词结果使用独立修订与 AbortSignal 隔离；已经提交给存储的保存不能通过取消等待撤销。

独立验收窗口新增内存中的“通勤”示例歌单、喜欢收藏计数、示例历史及原创示例歌词，明确标注示例资料，重启即重置；正式客户端资料仍不读取或改动。这里的页面导航和资料修改是示例适配器；产品入口使用两端实际适配器。

必要检查覆盖语义、真实临时目录持久化和无损保存、原生 JVM 批量逻辑、Chromium 触摸／确认／取消／问名称／语音确认及 320 px 宽度。PC / Android web 与 Android Java 编译通过不等于真机语音准确率或用户资料实机验收；本轮没有安装、发布或升级测试。


## 查询范围修订：当前歌曲及前后十首以内

用户纠正：查询不能固定为最近十首。现支持当前歌曲、相对位置单首、前／后若干首、跨当前歌曲的区间，以及最近 1–10 首听歌记录。普通前后位置以调用时的实际队列与 queueIndex 为准，重复歌曲不按首个同名项定位；索引不一致时只允许查询当前歌曲。前后各至多十首（含当前最多二十一首），边界不足如实显示数量，不循环补齐。随机播放时明确这里只是队列顺序，不能伪称已经预测实际下一首；历史记录另行查询，记录去重限制明确说明。

示例：“前面第三首的歌手是谁”“后面五首的名字”“前后各三首的全部信息”“前面第三首到后面第二首的资料”“最近听过的五首歌的名字”。不带查询对象的“上一首／下一首”仍是原播放操作。只问歌手／专辑／名字不拉取歌词；查询全部信息或歌词时按用户范围读取，歌词获取失败不丢失其余元数据，取消后迟到结果不呈现。

资料可包含实际录音的歌名、歌手、专辑、时长、年份、来源与音质、封面是否提供、喜欢／收藏／所在歌单、当前播放状态与进度、歌词。来源未提供的字段直接标明缺失，不补造；未播放歌曲不声称有当前进度或已确定音质。范围、字段和目标均在开始时固定，不修改队列、播放或个人资料。

语音回复开启后会逐首朗读实际查询内容，而不是只说“查到几首”。长结果拆为至多 260 UTF-16 字符的段落，适配 Android 每次 300 字符的现有保护且不截掉后续内容；PC 使用同一分段。读出期间可以停止朗读或重新按住说话，停止保留文字资料，取消及迟到 onend 不继续后续段落。朗读任务独立于写入互斥，不能因播报长结果阻挡下一次按住录音。没有用真实用户录音测试准确率；实际 Chromium 测试使用模拟 TTS 观察完整顺序、边界和停止行为。

### 对照已发行 r55 的本地待发布范围

GitHub v1.1.0/r55（源码 750e7d0）已包含音乐工作台、缓存／网络偏好、空间分区、漫游、私人搜索、备份预览、版本练习与设备协作的基础实现，不能把它们再次列为尚未发布。本地工作区尚未提交、打包或上传的主要是：

1. 星音原创 Zenix 看板娘、默认透明立绘和眨眼／捧脸害羞／耳机聆听／说话口型等姿态；仍为 Live2D 风格帧资源，不是真正 Cubism 骨骼模型。
2. PC 桌宠整个人物可拖动、位置约束和点击／拖动区分；应用内及 Android 原生悬浮的对应适配。
3. PC 前台空白区域按住空格与 Android 应用内悬浮按钮按住录音、松开发送、上滑／Escape 取消；Windows 中文 System.Speech 与 Android 系统识别/TTS，低置信度确认、会话隔离和系统权限处理。
4. 当前／相邻歌曲范围资料检索、歌词和历史按需查询、实际内容分段朗读及停止；本次修正包含在内。
5. 返回主页、按名打开歌单的宿主路由，浏览保持播放状态。
6. 创建歌单、追问名称、将固定当前歌曲加入新歌单。
7. 当前歌单／队列／勾选歌曲批量加入喜欢收藏，一次幂等保存；PC IPC 和 Android PrivateStore 对应接口。
8. 从指定歌单移出歌曲，确认预览、取消、并发歌单变更核验及文件／其他个人资料保留。
9. 对话结果名单和歌词滚动、窄屏适配、工作台遮挡处理，以及独立示例资料验收入口和对应自动测试。

真正的 Cubism 骨骼模型、系统语音唤醒不属于已完成待发布功能。没有新安装包、版本号或更新清单变更；下一次发布仍须使用递增内部构建号，不覆盖 r55 安装包。
