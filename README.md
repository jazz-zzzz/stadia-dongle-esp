# Stadia 无线手柄接收器

让 Google Stadia 手柄继续在 Windows 上无线使用，并保留双马达震动。

一块 ESP32-S3 会连接 Stadia 手柄，再通过 USB 向电脑提供 Xbox 360 兼容手柄、键盘和鼠标接口。无需安装专用驱动，也不依赖云服务。

```text
Stadia 手柄 ←── Bluetooth LE ──→ ESP32-S3 ←── USB ──→ Windows
```

本项目基于 [danzig666/stadia-dongle-esp](https://github.com/danzig666/stadia-dongle-esp)，其上游为 [Scalee/stadia-dongle](https://github.com/Scalee/stadia-dongle)。

## 能做什么

- 同时连接最多 2 个 Stadia 手柄
- Xbox 360 / XInput 按键、摇杆和模拟扳机
- 将游戏的双马达震动转发到 Stadia 手柄
- 将 Assistant 和 Capture 映射为独立键盘按键
- 一键切换鼠标模式
- 通过中文 Web GUI 配对、查看状态和修改配置
- 通过 USB 配置，不会占用 Windows 当前的 Wi-Fi
- 按需启动 Wi-Fi 热点，用于 OTA 和故障恢复
- 保存配对记录和按键配置，断电后仍然保留

Stadia 手柄没有扳机马达，因此本项目不提供 Xbox Series 手柄那种扳机震动。

## 需要什么

- 带原生 USB OTG 的 ESP32-S3 开发板
- 4 MB Flash 或更大
- 一根支持数据传输的 USB 线
- 桌面版 Chrome 或 Edge

开发板通常有两个 USB 接口：

- **COM/UART**：烧录固件
- **USB/OTG**：日常使用，向电脑模拟手柄

如果你的开发板只有一个接口，请以开发板说明书为准。

## 从零开始

### 1. 刷入固件

1. 用开发板的 **COM/UART** 接口连接电脑。
2. 打开[在线安装器](https://jazz-zzzz.github.io/stadia-dongle-esp/)。
3. 点击 **Install**，选择开发板对应的 COM 口。
4. 等待安装完成，然后断开 USB。
5. 改用开发板的 **USB/OTG** 接口连接电脑。

安装完成后，Windows 不一定弹出通知。可以运行 `joy.cpl`，检查是否出现 Xbox 360 兼容手柄。

如果设备仍显示为 ESP32 串口，或只有电源灯亮，按一次 **RESET/RST**，等待几秒即可。不要连续快速重启；恢复机制会把连续重启识别为故障操作。

### 2. 连接配置页

1. 打开[中文 USB 配置页](https://jazz-zzzz.github.io/stadia-dongle-esp/config.html)。
2. 点击 **连接 USB**。
3. 在浏览器设备列表中选择 Stadia 接收器。

配置页通过 WebHID 直接与 ESP32 通信，不会上传手柄数据，也不会让 Windows 切换 Wi-Fi。

### 3. 配对手柄

1. 在配置页点击 **开始配对**。
2. 按住手柄的 **Stadia + Y**，直到状态灯闪烁黄色或橙色。
3. 等待配置页显示手柄 **已就绪**。

“已连接”和“已就绪”不是一回事。只有显示“已就绪”后，按键、摇杆和震动才算全部可用。

完整刷写可能清除 ESP32 中的旧配对密钥，但手柄仍记得旧密钥。如果手柄一直黄灯闪烁，或者出现“能震动但没有输入”：

1. 在配置页忘记该手柄。
2. 关闭手柄。
3. 重新点击 **开始配对**。
4. 再次按住 **Stadia + Y** 完成配对。

成功一次后，后续开机通常会自动重连。

## 默认按键

常规按键按 Xbox 360 布局输出：

| Stadia | Windows / XInput |
|---|---|
| A / B / X / Y | A / B / X / Y |
| Menu | Start |
| Options | Back |
| Stadia | Guide |
| LB / RB、LT / RT | 对应肩键与扳机 |
| 摇杆、方向键 | 对应摇杆与方向键 |

Xbox 360 报告没有 Assistant 和 Capture，因此它们通过独立的键盘接口输出：

| Stadia 按键 | 短按 | 长按，默认 1 秒 |
|---|---|---|
| Assistant | F14 | 无操作 |
| Capture | F12（Steam 截图） | F15 |

F12 默认用于 Steam 截图。F14 和 F15 通常不会触发 Windows 系统功能，很适合交给 Steam Input、AutoHotkey 或其他工具自行映射。也可以在 Web GUI 中改成 F12–F24、PrintScreen、媒体键、方向键或其他常用按键。

## 震动

游戏发送的 Xbox 360 大、小马达强度会直接映射到 Stadia 手柄的两个马达。默认是线性映射，不会故意削弱震动。

Steam 的控制器测试通常不会一直发送满强度，因此测试时可能感觉偏轻；这不代表固件限制了最大震动。游戏中的实际强度由游戏和 Steam Input 决定。

## 鼠标模式

同时按住 **Assistant + Capture** 约 2 秒即可切换：

- 震动 2 次：进入鼠标模式
- 震动 3 次：返回手柄模式

鼠标模式默认使用以下映射：

| Stadia | 鼠标操作 |
|---|---|
| 左摇杆 | 移动光标 |
| A / B / X | 左键 / 右键 / 中键 |
| 方向键上 / 下 | 滚轮 |
| 右摇杆 Y 轴 | 模拟滚轮 |
| 按住 LT | 精细移动 |
| 按住 RT | 快速移动 |

每次开机都会回到普通手柄模式。

## Web GUI 与 Wi-Fi

日常配置推荐使用[在线 USB 配置页](https://jazz-zzzz.github.io/stadia-dongle-esp/config.html)。它可以：

- 配对、查看和删除手柄
- 查看实时按键、摇杆、扳机和电量
- 修改 Assistant 和 Capture 的短按、长按动作
- 修改长按时间
- 启动或停止 Wi-Fi 热点
- 重启接收器

Wi-Fi 热点默认关闭，不会常驻。它只用于 OTA 或 USB 配置不可用时的恢复。

正常情况下，可在 USB 配置页点击 **启动 Wi-Fi 热点**。热点名称为 `StadiaDongle-XXXX`，连接后打开 `http://192.168.4.1`。

USB 页面不可用时，还有两个恢复入口：

- 已连接手柄时，同时按住 **Stadia + Options + Menu** 约 5 秒。
- 在 30 秒内快速重启接收器 3 次。

热点在没有客户端连接时默认于 120 秒后关闭。快速重启 5 次会清除所有手柄绑定，只应作为最后的恢复手段。

### 完全本地运行配置页

USB 配置页本身没有运行时云依赖。下载仓库后，可在项目根目录运行：

```powershell
py -m http.server 8765 --directory main
```

然后用 Chrome 或 Edge 打开 `http://localhost:8765`。页面由本机提供，通信仍然直接走 USB。

在线安装器需要联网下载页面组件和固件；烧录过程由浏览器直接连接开发板。

## 更新固件

修改按键或常规设置不需要重新烧录，保存后会写入 ESP32 的 NVS。

需要升级固件时，最稳妥的方法是重新使用[在线安装器](https://jazz-zzzz.github.io/stadia-dongle-esp/)。直接覆盖即可，不需要先删除旧固件。完整刷写可能清除配对记录，因此升级后可能需要重新配对手柄。

Wi-Fi 页面也提供 OTA，但当前 OTA 流程尚未完成充分真机验证。OTA 只能上传构建产生的应用镜像 `build/stadia-dongle.bin`，不要上传完整安装镜像 `firmware-merged.bin`。

## 常见问题

### 烧录器无法初始化

- 确认选择的是开发板对应的 COM 口，不要选择主板自带的 COM1。
- 尝试按一次 RESET 后重新安装。
- 仍然失败时，按住 BOOT，再点击 Install。

### 刷完后没有出现 Xbox 手柄

- 确认已经从 COM/UART 口换到 USB/OTG 口。
- 按一次 RESET，等待几秒。
- 换一根确认支持数据传输的 USB 线。
- 运行 `joy.cpl`，不要只依赖 Windows 弹窗。

### 手柄一直黄灯闪烁

这通常表示配对没有真正完成。忘记旧手柄记录后重新配对，并等待配置页显示“已就绪”。

### Steam 能测试震动，但没有任何输入

USB 通常已经正常，问题多半在 BLE 配对或输入通知。先检查配置页是否显示“已就绪”，以及实时按键和原始报告是否随操作变化。

### 看不到 `StadiaDongle-XXXX`

这是正常行为。Wi-Fi 默认关闭，请从 USB 配置页手动启动，或使用上面的恢复入口。

### 配置后需要重新烧录吗

不需要。按键映射和 Web GUI 设置会持久保存。

## LED 状态

如果开发板在 GPIO 48 上带有兼容的 RGB LED，可参考：

| 灯效 | 状态 |
|---|---|
| 白色呼吸 | 正在启动 |
| 暗蓝色心跳 | 正在扫描手柄 |
| 蓝黄交替 | Wi-Fi 热点已开启 |
| 绿色心跳 | 一个手柄已连接 |
| 较快绿色心跳 | 两个手柄已连接 |
| 橙色心跳 | 鼠标模式 |
| 暗紫色心跳 | 电脑休眠 / USB 挂起 |
| 红色呼吸 | 固件错误 |
| 紫黄交替 | 正在 OTA |

开发板上的固定红色电源灯不属于上述状态灯。

## 从源码构建

需要 [ESP-IDF 6.x](https://github.com/espressif/esp-idf)：

```sh
idf.py set-target esp32s3
idf.py build
idf.py -p <串口> flash
```

生成用于网页安装器的完整镜像：

```sh
esptool.py --chip esp32s3 merge_bin \
  -o docs/firmware-merged.bin \
  --flash_mode dio --flash_freq 80m --flash_size 4MB \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0x20000 build/stadia-dongle.bin
```

更多维护资料：

- [USB 配置协议](docs/usb-config-protocol.md)
- [真机验收清单](docs/hardware-test-checklist.md)
- [产品与界面原则](PRODUCT.md)

## 许可证

[GNU General Public License v3.0](LICENSE)
