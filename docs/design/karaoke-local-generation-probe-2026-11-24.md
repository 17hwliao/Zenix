# 本地 K 歌生成技术探针（2026-11-24）

本报告只记录隔离环境中的真实执行结果，不修改产品源码、全局 Python、发行配置或用户资料。探针环境位于系统临时目录 `C:\Users\17hwliao\AppData\Local\Temp\zenix-karaoke-probe-1795499616`，没有放入仓库。

## 结论

- Demucs 4.0.1 与官方 `955717e8` 模型在 CPU 上真实完成了 12 秒双声道音频分离，`vocals.wav` 和 `no_vocals.wav` 均为完整 44.1 kHz、16-bit、双声道 WAV，时长与输入一致。
- `torchcrepe` 0.0.23 的 full 模型真实完成音高推理。1201 帧中 1096 帧通过周期度筛选，占抽查配方的 91.3%。
- SOFA 代码是 MIT，但可用的普通话歌声模型许可不允许作为当前默认产品依赖。官方讨论页中的 v2.0 中文模型明确标注 CC BY-NC-SA。v1.0.1 权重的再分发许可未在下载页明确说明，因此停止 SOFA 权重接入。
- 首版可以按 `timed-lyrics + CREPE` 继续。SOFA 只保留适配接口、依赖状态和关闭入口，不宣称真实强制对齐已验收。

## 环境

| 项目 | 实际值 |
| --- | --- |
| 操作系统 | Windows 10.0.26200 |
| CPU | Intel Core i7-13650HX，14 核 / 20 线程 |
| 内存 | 约 16 GiB |
| Python | 3.10.11，64-bit，项目外临时 venv |
| FFmpeg / ffprobe | 9.0.2-essentials_build-www.gyan.dev |
| torch / torchaudio | 2.5.1+cpu / 2.5.1+cpu |
| demucs | 4.0.1 |
| torchcrepe | 0.0.23 |
| librosa | 0.11.0 |
| numpy / scipy | 2.2.6 / 1.15.3 |
| soundfile | 0.13.1 |
| psutil | 7.0.0 |

创建隔离环境：

```powershell
$base = Join-Path $env:TEMP 'zenix-karaoke-probe'
py -3 -m venv (Join-Path $base 'venv')
$python = Join-Path $base 'venv\Scripts\python.exe'
& $python -m pip install --upgrade pip setuptools wheel
& $python -m pip install `
  'torch==2.5.1' 'torchaudio==2.5.1' `
  'demucs==4.0.1' 'torchcrepe==0.0.23' `
  'librosa==0.11.0' 'soundfile==0.13.1' 'psutil==7.0.0'
```

环境中未写入仓库。完整临时环境约 1.68 GiB，包含音频、输出和源码副本的探针目录约 1.85 GiB。

## Demucs 真实推理

官方模型：

```text
URL    https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th
文件   C:\Users\17hwliao\AppData\Local\Temp\zenix-karaoke-probe-1795499616\models\955717e8-8726e21a.th
大小   84,141,911 bytes
SHA256 8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4
许可   MIT
```

摘要与现有 `karaoke-separation.cjs` 中固定的模型摘要一致。

输入是 12 秒、44.1 kHz、16-bit、双声道的合成歌声加和弦测试音频。它用于验证模型可以真实运行和输出格式，不代表真人歌声分离质量。

```powershell
& $python -m demucs.separate `
  -n 955717e8 --repo $repo -d cpu --two-stems vocals `
  --shifts 0 --segment 5 --jobs 0 `
  --filename '{stem}.{ext}' -o $out -- $input
```

实际结果：

| 指标 | 结果 |
| --- | --- |
| 退出码 | 0 |
| 耗时 | 29.016 秒 |
| 采样观测峰值 RSS | 1049.92 MiB |
| `vocals.wav` | 2,116,844 bytes，12.000 秒 |
| `no_vocals.wav` | 2,116,844 bytes，12.000 秒 |
| 格式 | PCM signed 16-bit，44.1 kHz，双声道 |
| 两轨重建最大绝对误差 | 0.0425 |
| 两轨波形相关系数 | 0.0650 |

两个输出文件都被 ffprobe 和 WAV 解析共同确认完整。探针证明 CPU 路径可运行，没有测量 GPU 路径。

## CREPE 真实推理

`torchcrepe` 的 full 权重随 wheel 提供：

```text
文件   venv\Lib\site-packages\torchcrepe\assets\full.pth
大小   88,991,291 bytes
SHA256 133225604DEDD2E4005F8BBD1BD0A2EC073BA8B7A6CD31FF6D5EDBBFA3539986
许可   MIT，wheel 元数据声明
```

输入为 Demucs 生成的 `vocals.wav`，转单声道并重采样到 16 kHz，hop 为 160 samples（10 ms）。

```python
audio, sr = soundfile.read(vocals_wav, dtype="float32", always_2d=True)
audio = resample_poly(audio.mean(axis=1), 160, 441).astype("float32")
pitch, periodicity = torchcrepe.predict(
    torch.from_numpy(audio).unsqueeze(0),
    16000,
    hop_length=160,
    fmin=65,
    fmax=1100,
    model="full",
    batch_size=1024,
    device="cpu",
    return_periodicity=True,
)
```

实际结果：

| 指标 | 结果 |
| --- | --- |
| 退出码 | 0 |
| 进程总耗时 | 118.504 秒 |
| 纯推理耗时 | 88.984 秒 |
| 采样观测峰值 RSS | 2564.38 MiB |
| 音高帧数 | 1201 |
| 周期度至少 0.5 的有效帧 | 1096 |
| 有效帧比例 | 91.26% |
| 有效 MIDI 范围 | 57 至 64 |
| 有效基频范围 | 215.82 至 334.02 Hz |
| 周期度中位数 / 90 分位 | 0.8696 / 0.9694 |

这些数值只证明该合成样例能产生合理音高轨迹。真实中文歌曲、换气、和声和转音仍须另做样例验收。

## SOFA 核验

冻结检查的源码：

```text
仓库   https://github.com/qiuqiao/SOFA
提交   9549c6a86d16019c817eefe4bb8183405da524cc
代码许可 MIT
```

官方普通话模型讨论：

- [v1.0.0 普通话歌声模型](https://github.com/qiuqiao/SOFA/discussions/16) 提供 `pretrained_mandarin_singing.zip`，但发布内容没有给出可核验的权重摘要和明确再分发许可。
- [v2.0 普通话歌声模型](https://github.com/qiuqiao/SOFA/discussions/40) 明确标注 `CC BY-NC-SA`，并链接到第三方模型发行页。
- SOFA 的 `requirements.txt` 要求 `librosa<0.10.0` 和 `numpy~=1.24.1`，与本次 CREPE 环境中的 `librosa 0.11.0`、`numpy 2.2.6` 不同。真实 SOFA 探针需要单独 venv，不能复用当前环境。

因此本次没有下载或运行 SOFA 权重。接入条件仍是明确许可、固定摘要、独立环境和真实中文歌声对齐样例。首版只实现受控的普通歌词适配器接口和可关闭状态，不把缺失模型算作主链路阻塞。

## 首版运行条件

- Demucs 模型必须按现有 SHA-256 门禁加载，生产运行不自动下载。
- CREPE full 权重应作为独立受校验资源，或固定 torchcrepe 0.0.23 的 wheel 摘要。加载前核对文件 SHA-256。
- 在当前 CPU 上，12 秒样例的两阶段总耗时约 147.5 秒，峰值内存约 2.56 GiB。15 分钟歌曲不能按短样例线性承诺耗时，界面必须显示进度、允许取消并检查磁盘预算。
- Demucs 与 CREPE 的 `torch.load` 会读取 pickle。生产侧必须继续使用固定大小、固定 SHA-256 的本地模型，不接受渲染器或远程提供的模型路径。

## 产品运行时串联复验

探针结论已经接入实际 `KaraokeSeparation.startWithChart`，并再次使用同一 12 秒合成音频复验完整链路：

- FFmpeg 解码与身份检查通过。
- Demucs 4.0.1 分离、双轨 WAV 参数/时长验证和伴奏原子发布通过。
- 产品 `karaoke-chart-worker.py` 使用 `torchcrepe` 0.0.23 full 权重生成 UltraStar，worker 内核对 `full.pth` 的 88,991,291 bytes 与固定 SHA-256。
- runtime 返回 `ready`，总耗时 175.033 秒，伴奏 key 为 `9099235d3dba163f719c6c79ac502118c807ede14d0498e5425a12f88210a8f5`。
- 草稿为 4 个音符、3 个有效歌词行、120 BPM，告警为量化到 125 ms 及 1 句无有效音符；曲谱 SHA-256 为 `8d8d8d73cf9386a847ae7419f24ba58a49cdf01cc64fa36fa995448c0aeb7a82`。
- 同一草稿已通过 Zenix 现有 `validatePreparedChart`，再解析为 3 行、4 个音符。

第一次产品 worker 复验暴露了 `torchcrepe.predict` 返回批次维度时的数组标量化失败，已改为先 `squeeze(0)` 再逐帧处理，并重新完成上述推理。该修正证明探针代码不能直接当作产品代码，后续修改音高模型时必须继续跑真实 worker。

## 可复现材料

探针临时目录中还保留了以下未入仓库材料：

- `fixture\synthetic-vocal-mix.wav`
- `demucs-result.json`
- `demucs-out\955717e8\vocals.wav`
- `demucs-out\955717e8\no_vocals.wav`
- `crepe-result.json`
- `crepe-output.npz`
- `SOFA\` 的只读源码副本

这些文件只用于本次诊断。真实测试没有使用用户音频，也没有修改全局 Python 或正式软件资料。
