# 现场传感器汇总发布器

该目录保存现场 PostgreSQL/TimescaleDB 到官网 D1 投影的发布程序。程序只读取原始传感器数据，按十分钟生成最小值、最大值、平均值和质量计数；官网只保留最近 30 天的汇总结果。

## 运行配置

运行时读取以下两个本地私有配置文件，文件内容不得提交到 Git：

- `/srv/aeroponics/config/postgres.env`
- `/srv/aeroponics/config/website-publisher.env`

后者需要提供 `TELEMETRY_PUBLISH_URL`、`TELEMETRY_PUBLISH_TOKEN` 和 `TELEMETRY_STATE_PATH`。上传密钥必须与 Cloudflare Pages 的同名机密变量一致。

现场主机当前使用 `jim` 用户的 cron，每十分钟执行一次：

```cron
*/10 * * * * /srv/aeroponics/app/website-publisher/run.sh >> /srv/aeroponics/app/website-publisher/publisher.log 2>&1
```

如以后改为系统级 systemd，可使用本目录中的 service 与 timer 模板；启用前应再次核对现场数据库服务名和状态目录写权限。
