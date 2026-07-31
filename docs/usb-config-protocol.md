# USB 配置协议

本文描述 Stadia Dongle USB 配置协议 v1。该协议用于 WebHID 配置页面，不替代 Xbox 360 输入、震动、键盘或鼠标接口。

## 传输方式

- USB VID：`0x045E`
- USB PID：`0x0289`
- HID Usage Page：`0xFF00`
- HID Usage：`0x01`
- Feature Report ID：`0x10`
- Feature Report 数据长度：63 字节
- 包含 Report ID 时，USB 控制传输总长度为 64 字节

配置集合位于现有 Utility HID 接口中，使用 EP0 的 HID Feature Report，不增加中断端点。Windows 仍将游戏手柄接口绑定到 XUSB 驱动，浏览器只申请 vendor-defined 顶层集合。

## 数据帧

请求和响应都使用固定 63 字节的数据区。未使用字节必须写零。

### 请求

| 偏移 | 长度 | 含义 |
|---:|---:|---|
| 0 | 1 | Magic，固定为 `0x53` |
| 1 | 1 | 协议版本，当前为 `1` |
| 2 | 1 | Sequence，范围 1–255 |
| 3 | 1 | Command |
| 4 | 1 | Payload 长度，最大 55 |
| 5–7 | 3 | 保留，写零 |
| 8–62 | 55 | Payload |

### 响应

| 偏移 | 长度 | 含义 |
|---:|---:|---|
| 0 | 1 | Magic，固定为 `0x53` |
| 1 | 1 | 协议版本 |
| 2 | 1 | 与请求相同的 Sequence |
| 3 | 1 | 与请求相同的 Command |
| 4 | 1 | Status |
| 5 | 1 | Payload 长度，最大 55 |
| 6–7 | 2 | 保留，写零 |
| 8–62 | 55 | Payload |

浏览器先调用 `sendFeatureReport()` 提交请求，再重复调用 `receiveFeatureReport()`。固件任务尚未完成时返回 `PENDING`；完成后返回同一 Sequence 和 Command 的最终响应。浏览器端一次只允许一个未完成命令。

## 状态码

| 值 | 名称 | 含义 |
|---:|---|---|
| 0 | `OK` | 成功 |
| 1 | `PENDING` | 正在处理 |
| 2 | `BAD_MAGIC` | Magic 错误 |
| 3 | `UNSUPPORTED_VERSION` | 协议版本不兼容 |
| 4 | `UNKNOWN_COMMAND` | 未知命令 |
| 5 | `INVALID_PAYLOAD` | 长度或内容无效 |
| 6 | `INTERNAL_ERROR` | 固件内部操作失败 |
| 7 | `BUSY` | 请求队列已满 |
| 8 | `NOT_FOUND` | 手柄不存在或已断开 |
| 9 | `UNSUPPORTED` | 当前传输不支持该操作 |
| 10 | `NOT_READY` | 蓝牙控制器管理器仍在启动，稍后重试 |

## 命令

多字节整数均使用 little-endian。

| Command | 值 | 请求 Payload | 成功响应 |
|---|---:|---|---|
| `PING` | `0x01` | 空 | 1 字节协议版本 |
| `GET_DEVICE_INFO` | `0x02` | 空 | 固定 55 字节设备信息 |
| `GET_STATUS` | `0x03` | 空 | 固定 55 字节状态 |
| `GET_CONFIG` | `0x04` | 空 | 9 字节配置 |
| `SET_CONFIG` | `0x05` | 9 字节配置 | 保存后的 9 字节配置 |
| `GET_CONTROLLER_COUNT` | `0x06` | 空 | 1 字节数量 |
| `GET_CONTROLLER` | `0x07` | 1 字节索引 | 固定 55 字节手柄信息 |
| `GET_INPUT` | `0x08` | 1 字节 slot，`255` 表示兼容主状态 | 49 字节输入 |
| `START_PAIRING` | `0x10` | 空，或 2 字节超时秒数 | 空 |
| `STOP_PAIRING` | `0x11` | 空 | 空 |
| `FORGET_CONTROLLER` | `0x12` | 17 字节 ASCII 蓝牙地址 | 空 |
| `FORGET_ALL` | `0x13` | 空 | 空 |
| `START_WIFI` | `0x14` | 空 | 空 |
| `STOP_WIFI` | `0x15` | 空 | 空 |
| `REBOOT` | `0x16` | 空 | 空，随后设备重启 |

## 状态 Payload

`GET_STATUS` 成功时返回以下固定布局：

| 偏移 | 长度 | 含义 |
|---:|---:|---|
| 0 | 4 | 启动后的毫秒数 |
| 4 | 1 | `dongle_state_t` 状态值 |
| 5 | 2 | 状态标志 |
| 7 | 1 | 当前连接手柄数 |
| 8 | 1 | 已保存绑定数 |
| 9 | 1 | 电量百分比；`255` 表示未知 |
| 10 | 2 | Web UI 自动关闭剩余秒数 |
| 12 | 18 | 当前手柄蓝牙地址 |
| 30 | 25 | 当前手柄名称 |

状态标志按位定义：

- bit 0：Web UI/AP 已启用
- bit 1：已有 BLE 手柄连接
- bit 2：正在配对
- bit 3：USB 已配置
- bit 4：USB 已挂起
- bit 5：允许 USB Remote Wake
- bit 6：上一次唤醒请求被允许
- bit 7：蓝牙控制器管理器已就绪；仅当设备信息的 capabilities bit 7 声明支持该语义时读取，否则按已就绪处理以兼容旧版 v1 固件

## 配置 Payload

`GET_CONFIG` 和 `SET_CONFIG` 使用相同布局：

| 偏移 | 长度 | 含义 |
|---:|---:|---|
| 0 | 1 | Assistant 短按动作 |
| 1 | 1 | Assistant 长按动作 |
| 2 | 1 | Capture 短按动作 |
| 3 | 1 | Capture 长按动作 |
| 4 | 2 | 长按判定时间，300–5000 ms |
| 6 | 2 | Web UI 自动关闭时间，15–1800 秒 |
| 8 | 1 | bit 0：USB 休眠时关闭 AP；bit 1：无绑定手柄时自动启动 Web UI |

动作编号必须与 `dongle_action_t` 保持一致，自动合约测试会比较 C 与 JavaScript 两端的顺序。

## 兼容性与限制

- 需要桌面版 Chrome 或 Edge 的 WebHID 支持。
- 在线页面通过 HTTPS 提供；完全离线时可通过 `http://localhost` 提供，localhost 被浏览器视为可信上下文。
- 配置数据只在浏览器与 USB 接收器之间传输，不需要账户、云 API 或 Windows 常驻服务。
- v1 不支持 USB 固件上传。OTA 仍通过接收器的 Wi-Fi 页面完成。
- 同一时刻只使用一个配置页面。单页面传输层会串行化所有命令。

## 对应实现

- 固件协议：`main/usb_config_protocol.c`
- HID 集合和控制传输：`main/hid_extra.c`
- 浏览器传输层：`main/webhid_transport.js`
- 统一配置界面：`main/index.html`
- 合约和模拟测试：`tests/`
