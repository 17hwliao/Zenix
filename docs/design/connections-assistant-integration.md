# 跨端协作与可换装助手接线

本轮范围：功能8播放接力、13一起排下一首、21选择同步、24可换装音乐助手。此文为接口和验证边界，不是发行验收声明。

## 共享界面

`ConnectionsPanel` 从 `src/features/connections/ConnectionsPanel.tsx` 导出，props：

```ts
{mobile:boolean, playback:PlayerState, personal:PersonalState,
 invoke:<T>(args:Record<string,unknown>)=>Promise<T>,
 onReceive:(payload:TransferPayload)=>Promise<void>,
 onPause:(expected?:{id:string,selection?:number})=>Promise<void>|void, preferences?:Record<string,unknown>}
```

所有invoke均带 `operation:'collaboration',action`。

- PC路由到 `desktopControls.invoke(args)`，原DesktopControls新增此operation。
- Android：action connect/status/disconnect调用原RemoteClient `invoke({operation:action,...})`；其余调用 `invoke({operation:'collaboration',action,...})`。此路由必须复用同一个RemoteClient实例。
- 主机在既有六位码配对/明确允许后，分别给设备开启submission、handoff、sync权限。没有授权时不能发送对应请求。
- 主机先start，手机connect，然后主机approve。手机可以刷新配对状态。
- Panel轮询state只读取，不执行操作。incoming先claim，pending变processing，再调用onReceive；成功才ack。processing中的操作不能再由发送端取消。未开始请求可以取消。发送端由独立handoffCoordinator等待accepted回执；关闭面板不取消接力。onPause接收发送时id/selection，必须在业务层读取实际播放核对后才暂停，用户已切歌则保留当前播放。
- TransferPayload包含kind、track、queue、position、playing或sections、personal、preferences。传输仅保留可移植元数据，排除音频URL、本机路径、认证头。当前本地文件不能接力，明确报错而不伪称另一台设备能播放。
- submission：追加待播队列，不切换当前歌曲。
- handoff：接收端恢复队列/进度，并依据playing恢复播放意图；必须等待真实开始播放再让onReceive成功返回。失败保留发送端播放。
- sync：选择playlists/liked/favorites/preferences后预览，接收端明确确认才合并；不整体覆盖当前资料。歌单使用现有importPlaylists以保留重名副本和本地日志；喜欢/收藏做集合并集，不能用toggle误删已存在条目。
- preferences只包括version与roaming，通过各自clean白名单过滤。漫游scope=playlist的外端playlistId通常不能直接对应本机，接收时必须要求本机选择或保留本机原范围。不得把不存在的远端ID应用成空范围。
- 网络断连、系统终止可能造成回执未到达。原则是保留发送端播放，不宣称分布式事务能保证绝对单设备出声。关闭连接撤销会话，未接收内容不落入个人资料。

## 助手

`AssistantPanel` props：`{mobile,playback,invoke,execute:(action,args)=>Promise<unknown>}`。

execute由主任务注册白名单：play、pause、next、previous、bookmark、tasks、search。实际业务完成后Promise才成功，界面才显示成功。未知指令只给建议，不执行脚本/系统命令。关闭助手不关闭业务模块。

PC后端：

```js
const {Assistant}=require('./runtime/assistant.cjs');
const assistant=new Assistant({folder,dialog,getWindow,BrowserWindow,ipcMain,
 execute:async action=>{/* play-pause/next/previous -> existing media command */}});
await assistant.load();
// companion operation assistant -> assistant.invoke(args)
// before-quit -> assistant.close()
```

桌宠只信任自己webContents发出的白名单IPC。透明窗口独立关闭，保留主播放器。新增打包文件：`electron/assistant-pet.html`、`src/features/assistant/skin-model.cjs`。electron目录内CJS遵循原通配规则。主机collaboration还依赖共享`src/features/space/model.cjs`与`src/features/playback/preferences.cjs`。

Android新增长期 `new AssistantFeatures(context)`，operation assistant -> invoke(args)。skinSave/Reset/state在工作线程；overlay会打开系统许可页或启动独立服务，不改变歌词悬浮开关。Manifest需声明：

```xml
<service android:name=".AssistantOverlayService" android:foregroundServiceType="specialUse" android:exported="false">
 <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="User-enabled floating music assistant with explicit close control"/>
</service>
```

templateSave需复用Android系统CREATE_DOCUMENT保存base64 ZIP为`.zenixskin`。speech需plugin通过系统`RecognizerIntent.ACTION_RECOGNIZE_SPEECH`，结果回传`{transcript}`；无系统识别服务明确报错。外部识别Activity处理麦克风许可，应用不持续监听。PC按键说话检测Web Speech可用性，没有提供时文字与快捷操作继续使用。语音唤醒仍是后续阶段，没有常驻监听占位开关。

## 皮肤规范1

ZIP扩展`.zenixskin`，仅skin.json和frames目录PNG。schema/name/author/version/width/height/frames/animations/hit/drag/scale。idle必需，其他状态缺失回退idle。画布16–2048，1–96张同尺寸PNG，各不超过2MiB；压缩包8MiB，解压图片16MiB，保存内容18MiB，所有帧合计最多16777216像素；fps1–30，动画帧索引受限。JSON不含脚本且不接受外部URL。用户可下载真实模板、导入预览、保存、重启读取和恢复默认；个人助手配置不随皮肤重置。

PC独立窗口与应用内助手使用同一原创SVG，提供六种状态动作及PNG状态序列；真实播放状态驱动轻微律动，暂停恢复待机。全局减少动效、隐藏与页面不可见暂停动画。Android独立悬浮目前使用皮肤待机形象；完整状态序列在应用内助手中呈现。Android悬浮采用原生View和缩略解码，不启动第二WebView。皮肤文件独立加密保存，避免每次歌单写入复制大图片。Android皮肤损坏保留原文件、使用默认角色；明确恢复默认才替换。

## 验证

`Test-CollaborationAssistant.cjs` 8/8：真实HTTP配对/权限/显式回执与撤销、资料过滤、队列与内存上限、PNG/路径/动作验证、真实文件持久化重开/失败保留及桌宠sender白名单、接力后台回执生命周期。皮肤持久化测试使用隔离加密provider，不声称证明操作系统加密可用性。

既有`Test-ListeningIteration.cjs` 5/5通过，原遥控和快捷键契约未破坏。生产Android `compileDebugJavaWithJavac --offline`通过。未操作真机、未实测两设备网络接力、外部语音识别服务和系统悬浮许可，不将编译等同于设备功能验收。双端主界面及onReceive完整业务由主任务集成后再进行相应自动检查。


## 本轮审查修补（2026-10-23）

- 断开或移除设备清理未接收私人payload；撤销权限取消尚未认领请求，已明确认领的操作继续收尾。
- 所有传递类型先校验1 MiB上限，再处理收据容量，避免超大新请求清掉旧收据。
- 结构化LX remoteId和歌曲id不截断，超限明确拒绝；真实HTTP覆盖投稿、同步与接力的长引用。
- 默认PC桌宠恢复原创Q版SVG；应用内默认形象六状态动作与全局motion联动。Assistant.update按播放状态变化推送桌宠，位置锁定、隐藏、系统减少动效与页面不可见均受控。
- 皮肤导入以请求代次隔离卸载/切换迟到结果；恢复默认写盘成功后才替换界面，避免虚假成功。
- Android悬浮与通知入口均带AssistantOverlayService.OPEN_ASSISTANT_EXTRA（zenix.openAssistant），由主Activity消费并打开助手。
- 新增真实隔离Electron渲染回归，验证绘制形象、播放/暂停、减少动效、隐藏、锁定与按钮IPC；不操作用户客户端。
