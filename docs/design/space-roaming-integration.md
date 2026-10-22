# 音乐空间与漫游功能接线

本组实现清单 1、2、14、15、16、22 的空间部分；主界面/详情页的全局动效由集成层应用同一设置。仅本地开发，没有修改版本、更新清单或发行身份。

## 共享入口

`SpaceFeaturesPanel({mobile?,playback,personal,invoke})` 调用：

- `{operation:'spaceFeatures',action:'read'}`：读取空间、分区、动效及长期漫游设置。
- `{operation:'spaceFeatures',action:'save',value}`：保存，按根对象 revision 检查过期写入。
- `{operation:'spaceFeatures',action:'roaming',edit:'branch',track,count}`：设置 1–5 首临时歌手探索，不立即切歌。
- `{operation:'spaceFeatures',action:'roaming',edit:'return'}`：返回原候选与查询路线。

PC renderer 分派到 `desktopSpaceFeature(args)`。Android 原生主线程分派到 `SpaceFeatureCommands.invoke(runtime,args)`；PlaybackService 提供 `Object spaceFeature(JSONObject args)throws Exception{return roaming.feature(args);}`。

PC 长期资料为现有 renderer 存储的 `zenix.space.features.v1`；Android 为既有 PrivateStore 的 `spaceFeatures` 字段，前端仅缓存供画布读取，不另建用户根目录。选择同步应读取本机对象，只替换其 roaming 后走保存接口；远端 revision 不覆盖本机。备份扩展若纳入本组资料亦需使用此字段。

## 画布

PC LatticePlayer 与移动 StickerSpace 均直接实现分区筛选、空间书签请求/恢复。书签保存有限歌曲引用、焦点与镜头，去除路径、音频地址、请求头；不修改播放队列。当前空间未打开时保存/恢复明确拒绝。缺失本机文件不凭空补造路径；可用的在线引用仍可展示并由既有音源解析。

通过 `zenix-space-request` / `zenix-space-response` / `zenix-space-restore` 传递当前画布上下文。分区可从工作台添加/移除当前歌曲、添加聚焦歌曲。画布“拖动贴纸归类”是独立编辑模式：PC 原生拖放到分区按钮，移动端捕获单指并在分区按钮处松手；普通模式继续浏览、聚焦、缩放。

全局页面/详情若需应用 #22，应读取 `useSpaceSettings().motion`，结合系统减少动态效果。空间内部已处理 full/light/reduced，默认保留原有 580ms 贴纸和 620ms 镜头过渡；light 分别使用 240/280ms，reduced 直接完成。没有隐藏/离页取消音频解析的逻辑。

## 漫游规则

两端均支持所有目录 / 自己喜欢收藏歌单 / 指定歌单范围；限制范围时直接使用资料中的引用并继续走原播放解析。候选耗尽明确暂停，不偷偷突破范围。

探索倾向影响熟悉/陌生歌手排序，是倾向而非固定百分比。近期歌手避让用于降权。个人偏好可减少出现（仍允许播放）或自动漫游完全排除；歌曲、准确版本、歌手分别匹配。偏好可以撤销，不影响手动点击播放。版本排除不扩大成同名所有版本排除。

临时探索在内存保存原候选、分页/查询进度；实际播放新探索歌曲才消耗配额，重听同一首不重复扣除。配额完成或探索耗尽回到原路线。停止漫游清除临时状态。Android 持久化原路线供重启继续，不承诺重启恢复临时探索；网络与解析失败不计成负面喜好。

## 已执行验证

- `Test-SpaceFeatures.cjs` 五项核心检查通过：空间引用/预算、偏好隔离和指定范围、排序倾向、生产 PC 漫游临时路线不中断/返回、生产 Java 状态及过滤（含过期写入拒绝）。
- 新增真实 Electron/React 用例通过：PC 与移动画布真实分区筛选、恢复有限贴纸与镜头缩放、全程零播放调用、画布缺失明确拒绝。它是隔离 UI 测试，不是真机性能证据。
- 原生产漫游三首重听、贴纸投影/缩放三个相关检查通过。
- 本组接线后的 Android Debug Java 编译通过；之后的减少出现降权/修订号小改由生产 Java 定向测试覆盖，最终双端构建仍由主任务收拢。

主任务需将 `scripts/Test-SpaceFeatures.cjs` 纳入正式回归入口。全项目 TypeScript 检查最后仅有集成层 Workbench ref 类型错误；本组无独立类型错误。未操作真实设备或现有用户资料。
