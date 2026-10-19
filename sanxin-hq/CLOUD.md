# 三鑫总公司系统：云端接续

本项目目录为 `sanxin-hq/`。只处理本目录内的三鑫总公司工作系统，不引用仓库中其他应用的资料。

## 手机 GPT 任务提示

请读取 sanxin-hq/AGENTS.md 和 sanxin-hq/README.md，继续开发三鑫总公司工作系统。优先处理资料更新、库存查询和库存流水追溯。所有修改限定在 sanxin-hq/。

## 启动与检查

从仓库根目录运行：

```sh
cd sanxin-hq
python3 -m http.server 8899 --bind 0.0.0.0 --directory dist
```

使用环境提供的端口预览访问 8899。

测试：

```sh
cd sanxin-hq
node tests/core.test.cjs
node --check dist/app.js
node --check dist/core.js
```

本应用无需安装依赖。真实录入数据保存在各浏览器本地，源码同步不会同步库存资料；多人共享仍需登录、权限和数据库服务。不要把真实业务资料、联系方式、备份或密钥提交到公开仓库。
