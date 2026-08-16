# SivitaCode 基准测试

[English](benchmarking.md) | 中文

本贡献者参考定义可复现的产品证据；它不会仅凭启动延迟宣称某个模型或 agent 更优秀。先构建仓库，再运行构建后的 SivitaCode 入口和无密钥的完整 agent 验收基准：

```sh
pnpm run build
pnpm benchmark:sivitacode --samples 9 --warmup 2 --output benchmark-results/sivitacode.json
```

JSON 报告会记录 Node 与操作系统环境、每个观测值，以及产品版本启动、headless 组合与帮助、Web 配置组合的中位数和 nearest-rank p95。它还会以构建模式启动真实 headless Loader 树，通过确定性 mock 模型驱动一次 Bash 工具回合，并要求持久化验收测试通过。后者记录一次验收时长而不是延迟分布，因为重复运行主要会测到测试进程启动成本。

只比较硬件、操作系统镜像、Node 版本、电源模式相同且同样空闲的 runner 报告。通过显式的先前报告拒绝中位数回退：

```sh
pnpm benchmark:sivitacode \
  --samples 9 \
  --warmup 2 \
  --baseline benchmark-baseline/sivitacode.json \
  --max-regression-percent 15 \
  --output benchmark-results/sivitacode.json
```

独立的 `SivitaCode benchmark` 工作流会上传机器可读报告。手动触发的运行可以通过明确的成功 run id 下载指定 artifact，并执行所选中位数预算。定时运行只采集证据，不比较不同的托管机器。agent 质量宣传需要独立任务语料、固定模型与 provider、多次试验、judge 协议、token/成本核算和置信区间；本启动基准不能支持这类宣传。
