# Stadia 无线手柄接收器

这是一个面向 ESP32-S3 的开源固件。它通过蓝牙低功耗（BLE）连接一到两个 Google Stadia 手柄，并通过 USB 将它们呈现为：

- 有线 **Xbox 360 / XInput 手柄**
- HID 鼠标
- HID 键盘与消费控制设备

固件内置一个完全本地运行的 Web GUI，可用于手柄配对、额外按键映射、状态查看和 OTA 更新。

本项目基于 [danzig666/stadia-dongle-esp](https://github.com/danzig666/stadia-dongle-esp)，其上游为 [Scalee/stadia-dongle](https://github.com/Scalee/stadia-dongle)。

## 为什么需要接收器

Google 关闭 Stadia 后，为 Stadia 手柄提供了蓝牙模式固件。手柄在 Windows 上可以通过蓝牙正常输入，但 Windows BLE HID 驱动无法向它发送正确的震动输出报告，因此无线模式通常没有震动。

ESP32-S3 在手柄和电脑之间充当协议桥：

```text
Stadia 手柄 ←── BLE ──→ ESP32-S3 ←── USB ──→ 电脑
```

ESP32-S3 可以使用手柄要求的 BLE GATT 写入方式控制两个震动马达；电脑端只会看到一个标准的有线 Xbox 360 手柄，无需安装专用驱动。

## 主要功能

- 一到两个 Stadia BLE 手柄
- 标准 Xbox 360 / XInput 输入与双马达震动
- 每个手柄独立的鼠标模式
- Assistant 和 Capture 额外按键
- HID 键盘、媒体键和远程唤醒
- USB WebHID 配置 GUI，不影响 Windows 当前 Wi-Fi
- 本地 Wi-Fi Web GUI，作为 OTA 和恢复入口
- 配对信息和配置持久化
- 双 OTA 分区
- 可选 WS2812/SK6812 状态灯

## 硬件要求

- 带原生 USB OTG 的 **ESP32-S3** 开发板
- 4 MB Flash（默认）或 16 MB Flash
- 可选：连接到 GPIO 48 的 WS2812/SK6812 RGB LED，可在 `menuconfig` 中修改
- 从源码构建需要 [ESP-IDF v6.x](https://github.com/espressif/esp-idf)

开发板通常有两个 USB 接口：

- **COM/UART 接口**：用于首次烧录
- **原生 USB 接口**：正常使用时连接电脑，模拟 Xbox 360、键盘和鼠标

## 两类网页入口

仓库中包含两套用途不同的网页。

### 1. 首次安装页面

文件位于 `docs/`，通过 ESP Web Tools 和 WebSerial 将完整固件写入 ESP32-S3。

- 使用时机：开发板首次烧录或完整恢复
- 连接方式：COM/UART USB
- 写入文件：`docs/firmware-merged.bin`
- 当前在线入口：[jazz-zzzz.github.io/stadia-dongle-esp](https://jazz-zzzz.github.io/stadia-dongle-esp/)

当前 `docs/index.html` 会从 `unpkg.com` 加载 ESP Web Tools 组件，因此在线安装器不是完全离线的。烧录数据由浏览器直接发送给开发板，但页面组件和固件仍需先从网页下载。

### 2. 配置 Web GUI

配置页面源文件为 `main/index.html`，同一界面支持两种本地传输：

```text
在线或 localhost 配置页 ── WebHID / 原生 USB ──▶ ESP32-S3
http://192.168.4.1     ── HTTP / 接收器热点 ──▶ ESP32-S3
```

首选入口是 [USB 配置页](https://jazz-zzzz.github.io/stadia-dongle-esp/config.html)。点击 **连接 USB** 后，浏览器直接通过原生 USB 与接收器通信，Windows 继续使用原来的 Wi-Fi。

`main/CMakeLists.txt` 也会将配置页面和传输脚本编译进固件。连接接收器热点后访问 `http://192.168.4.1`，同一界面会自动改用本地 HTTP API，并保留 OTA 上传功能。

配置数据只在浏览器和接收器之间传输，并写入 ESP32 的 NVS。关闭页面、关闭热点或断电后配置仍会保留。

完全离线使用时，可在仓库根目录启动本地静态服务器：

```powershell
py -m http.server 8765 --directory main
```

然后用 Chrome 或 Edge 打开 `http://localhost:8765`。该页面不加载外部脚本；localhost 只负责提供页面文件，设备通信仍走 USB。

## 首次烧录

### 使用网页安装器

推荐使用桌面版 Chrome 或 Edge：

1. 使用开发板的 **COM/UART USB 接口**连接电脑。
2. 打开[网页安装器](https://jazz-zzzz.github.io/stadia-dongle-esp/)。
3. 点击 **Install**，选择正确的串口并等待烧录完成。
4. 断开开发板。
5. 改用开发板的**原生 USB 接口**连接电脑。

Windows 应将设备识别为 Xbox 360 手柄。

### 从源码构建

```sh
idf.py set-target esp32s3
idf.py build
```

`sdkconfig.defaults` 默认启用 NimBLE Central、TinyUSB、240 MHz CPU 和生产日志。默认 4 MB 分区表包含两个 OTA 应用分区。

烧录：

```sh
idf.py -p <串口> flash
```

### 生成完整安装镜像

用于 ESP Web Tools 的合并镜像包含 bootloader、分区表和应用固件：

```sh
esptool.py --chip esp32s3 merge_bin \
  -o docs/firmware-merged.bin \
  --flash_mode dio --flash_freq 80m --flash_size 4MB \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0x20000 build/stadia-dongle.bin
```

## 首次设置与配对

首选 USB 配置方式：

1. 烧录后，用开发板的**原生 USB 接口**连接电脑。
2. 使用桌面版 Chrome 或 Edge 打开 [USB 配置页](https://jazz-zzzz.github.io/stadia-dongle-esp/config.html)。
3. 点击 **连接 USB**，选择 Stadia 接收器。
4. 点击 **Start Pairing**。
5. 按住手柄的 **Stadia + Y**，直到状态灯闪烁橙色。
6. 配对成功后，绑定信息会保存到 Flash，之后开机会自动重连。

USB 配置不要求 Windows 切换网络。若 USB 页面不可用，仍可使用恢复入口：

1. 连接开放热点 **`StadiaDongle-XXXX`**。
2. 打开 `http://192.168.4.1`。
3. 在相同界面中完成配对或 OTA。

固件也会自动扫描可用的 Stadia 手柄，因此通常不必手动点击 Start Pairing。

## 手柄模式

### Xbox 360 模式

电脑会将每个 Stadia 手柄识别为一个 **Xbox 360 Controller for Windows**：

- VID：`0x045E`
- PID：`0x0289`

| Stadia 输入 | Xbox 360 输入 |
|---|---|
| A / B / X / Y | A / B / X / Y |
| LB / RB | LB / RB |
| LT / RT | LT / RT，模拟量 |
| LS / RS 按下 | LS / RS |
| 左摇杆 | 左摇杆 |
| 右摇杆 | 右摇杆 |
| 方向键 | 方向键 |
| Menu | Start |
| Options | Back |
| Stadia | Guide |

### 鼠标模式

同时按住 **Assistant + Capture** 约 2 秒即可切换：

- 震动 2 次：进入鼠标模式
- 震动 3 次：返回手柄模式

每次开机默认进入手柄模式。鼠标模式下，Xbox 360 接口持续发送中立状态，所有操作转交给 HID 鼠标接口。

| Stadia 输入 | 鼠标操作 |
|---|---|
| 左摇杆 | 移动光标，包含死区、加速曲线和平滑处理 |
| A | 左键 |
| B | 右键 |
| X | 中键 |
| 方向键上/下 | 滚轮，每次 ±1 |
| 右摇杆 Y 轴 | 模拟滚轮 |
| 按住 LT | 精细模式，速度 ÷ 3 |
| 按住 RT | 快速模式，速度 × 2 |
| Stadia / LB / RB / LS / RS / Menu / Options | 不输出鼠标动作 |

鼠标报告由 125 Hz 硬件定时器驱动。

### 双手柄

最多可同时配对和使用 **2 个手柄**。每个手柄在电脑上显示为独立的 Xbox 360 手柄，并拥有独立的鼠标模式和额外按键状态。

| 已连接手柄数 | BLE 连接间隔 | 预计更新率 |
|---|---:|---:|
| 1 | 7.5 ms | 约 133 Hz |
| 2 | 11–15 ms | 约 67–91 Hz |

Wi-Fi AP 开启时，固件会暂停 BLE 扫描以减少 2.4 GHz 共存干扰；已经建立的 BLE 连接和输入通知不会中断。

## 额外按键

Xbox 360 的 XInput 报告没有 Assistant 和 Capture 对应的按键位。固件因此使用独立的 **Boot Keyboard + Consumer Control HID** 接口发送这两个按键。

默认配置：

| Stadia 按键 | 短按 | 长按，默认 1 秒 |
|---|---|---|
| Assistant | F14 | 启动 Web GUI |
| Capture | PrintScreen | 无 |

Web GUI 可重新设置短按和长按动作。目前提供 38 种动作：

- F13–F24
- PrintScreen、Escape、Space、Enter、Tab、Backspace
- Insert、Delete、Home、End、Page Up、Page Down
- 方向键
- 音量加减、静音
- 媒体播放/暂停、上一曲、下一曲
- 仅远程唤醒
- 启动 Web GUI

复杂的按键组合和按游戏映射可以继续交给 Steam Input、PowerToys 或其他本地软件处理。

## 本地 Web GUI

推荐通过原生 USB 和 [在线配置页](https://jazz-zzzz.github.io/stadia-dongle-esp/config.html) 使用 Web GUI。也可以从 localhost 完全离线运行，或在 Wi-Fi AP 开启时通过 `http://192.168.4.1` 访问。

| 页面位置 | 设备传输 | Windows Wi-Fi | OTA |
|---|---|---|---|
| GitHub Pages / localhost | WebHID + 原生 USB | 保持原连接 | 暂不支持 |
| `http://192.168.4.1` | 本地 HTTP + 接收器热点 | 需要切换到热点 | 支持 |

WebHID 需要桌面版 Chrome 或 Edge。浏览器首次连接时会显示设备选择器；授权后页面可静默重新连接。同一来源的多个页面会通过 Web Locks 自动互斥；不同来源（例如 GitHub Pages 与 localhost）无法共享浏览器锁，因此仍不要同时连接同一个接收器。

当前界面提供：

- BLE、USB、Wi-Fi AP 和固件状态
- 每个手柄的名称、地址、电量和鼠标模式
- 实时按键、摇杆、扳机与原始报告
- 开始或停止配对
- 查看和删除已绑定手柄
- Assistant/Capture 短按与长按动作
- 长按判定时间
- Web GUI 自动关闭时间
- 电脑休眠时是否关闭 AP
- OTA 固件上传
- 重启和关闭 Web GUI

以下情况会启动 Wi-Fi 恢复入口：

- 刚完成首次烧录
- 没有已绑定的手柄
- 长按 Assistant，默认动作

有手柄连接后，AP 默认在 120 秒后自动关闭；可在 GUI 中修改超时时间。

### 配置是否需要重新烧录

通过 Web GUI 修改的配置会写入 NVS，不需要重新烧录固件。只有增加固件尚未实现的新功能或底层协议时，才需要更新固件。

### OTA 更新

Web GUI 的 `/api/update` 接口会将上传文件写入下一个 OTA 应用分区，成功后切换启动分区。

OTA 应上传构建产生的应用镜像：

```text
build/stadia-dongle.bin
```

不要将用于首次完整烧录的 `docs/firmware-merged.bin` 上传到 OTA 页面。

当前 OTA 流程尚未经过充分测试，正式使用前建议增加版本、项目名称、镜像类型和哈希校验，并验证失败回滚。

## USB 通信

USB 并不是单向通信：

| USB 接口 | 方向 | 用途 |
|---|---|---|
| Xbox 360 IN | ESP32 → 电脑 | 按键、摇杆和扳机 |
| Xbox 360 OUT | 电脑 → ESP32 | 双马达震动 |
| HID Keyboard IN | ESP32 → 电脑 | Assistant/Capture 快捷键 |
| HID Mouse IN | ESP32 → 电脑 | 鼠标模式 |
| HID Feature Report | 双向 | WebHID 状态、配对、映射和设备管理 |

USB 配置使用 Utility HID 接口中的 vendor-defined 顶层集合和 63 字节 Feature Report。Feature Report 通过 EP0 控制传输，不占用新的中断端点，也不改变两个 Xbox 360 接口的报告格式。

协议版本、帧格式、命令和状态码见 [`docs/usb-config-protocol.md`](docs/usb-config-protocol.md)。USB 配置 v1 不包含固件上传；OTA 继续使用 Wi-Fi 页面。

## USB 远程唤醒

电脑休眠时，按下以下任意按键会尝试调用 `tud_remote_wakeup()`：

- Stadia
- Assistant
- Capture
- A

是否能成功唤醒取决于主板 BIOS、Windows 电源管理和 USB 设备唤醒设置，目前不保证在所有电脑上正常工作。

## LED 状态

| 灯效 | 含义 |
|---|---|
| 白色呼吸 | 正在启动 |
| 暗蓝色心跳 | 正在扫描，没有手柄连接 |
| 蓝黄交替 | 正在扫描，且 Wi-Fi AP 已开启 |
| 绿色心跳 | 一个手柄处于游戏手柄模式 |
| 较快绿色心跳 | 两个手柄处于游戏手柄模式 |
| 橙色心跳 | 至少一个手柄处于鼠标模式 |
| 暗紫色心跳 | 电脑休眠，USB 已挂起 |
| 红色呼吸 | 错误 |
| 紫黄交替 | 正在执行 OTA 更新 |
| 短暂白色闪烁 | 已发送远程唤醒信号 |

## 软件架构

```text
Stadia BLE ──▶ ble_central.c ──▶ bridge.c ──▶ usb_xbox.c ──▶ 电脑（Xbox 360）
                   │
                   ├──▶ button_actions.c ──▶ hid_extra.c ──▶ 电脑（键盘）
                   │
                   └──▶ mouse_mode.c ──▶ hid_mouse.c ──▶ 电脑（125 Hz 鼠标）

电脑震动 ──▶ xbox_dev.c ──▶ ble_central.c ──▶ Stadia BLE

USB 浏览器 ◀── WebHID Feature Report ──▶ usb_config_protocol.c
                                             │
                                             ├──▶ config_store.c ──▶ NVS
                                             ├──▶ 配对与设备管理
                                             └──▶ Wi-Fi AP 控制

Wi-Fi 浏览器 ◀── HTTP / Wi-Fi AP ──▶ web_server.c ──▶ OTA 应用分区
```

首次真机验证可直接按 [`docs/hardware-test-checklist.md`](docs/hardware-test-checklist.md) 完成。

## 许可证

[GNU General Public License v3.0](LICENSE)
