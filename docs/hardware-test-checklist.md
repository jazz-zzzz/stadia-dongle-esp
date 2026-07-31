# USB WebUI 真机验收清单

这份清单用于首次真机测试。按顺序完成即可覆盖 USB 枚举、WebHID 读写、配置持久化、BLE 管理和 Wi-Fi 回退，不需要反复刷写。

## 测试前

1. 关闭其他已经打开的 Stadia Dongle 配置页面。
2. 使用本次 CI 生成的 `firmware-merged.bin` 完整烧录一次。
3. 断电后改用开发板的原生 USB 接口连接 Windows。
4. 打开 Windows 的“设置 USB 游戏控制器”，确认 Xbox 360 手柄仍能出现。
5. 使用桌面版 Chrome 或 Edge 打开 USB 配置页。

## 一次性验收

1. 点击 **Connect USB**，选择 VID `045E`、PID `0289` 的 Stadia 接收器。
2. 确认页面显示 **USB connected**，同时 Windows 原来的 Wi-Fi 没有断开。
3. 确认固件版本、USB 状态、手柄名称、地址、电量和实时输入能刷新。
4. 按动 A、Assistant、Capture，移动两个摇杆并按下两个扳机，确认页面数据变化。
5. 将 Assistant 短按动作临时改为 `f15`，点击 **Save mappings**。
6. 刷新页面并重新连接 USB，确认 `f15` 仍然保留，证明 NVS 写入成功。
7. 点击 **Start Pairing**，确认状态进入 pairing；再点击 **Stop Pairing**，确认状态退出 pairing。
8. 点击 **Start Wi-Fi AP**，确认出现 `StadiaDongle-XXXX`，但 Windows 不需要切换过去。
9. 点击 **Stop Wi-Fi AP**，确认热点消失，USB 页面仍保持连接。
10. 断开原生 USB 线，确认页面立即显示断连、状态被清空、所有设备操作被禁用。
11. 重新插入并点击 **Connect USB**，确认能够恢复连接。
12. 将 Assistant 短按动作改回原值并保存。

## 专项边界检查

这些步骤覆盖冷启动、多页面、焦点稳定性和高频操作：

1. 接收器冷启动后立即点击 **Connect USB**；确认页面能显示“Bluetooth starting”，配对和删除按钮暂时禁用，蓝牙就绪后自动恢复，不崩溃也不要求拔插。
2. 在同一网站打开两个配置页；第一个连接后，第二个应明确提示已有页面连接。断开第一个后，第二个应能立即连接。
3. 用键盘 Tab 将焦点停在某个 **Forget** 按钮或映射控件上并等待 10 秒；确认实时轮询不会夺走焦点或替换正在操作的控件。
4. 连续执行 **Start Wi-Fi AP** / **Stop Wi-Fi AP** 至少 5 轮；确认页面状态一致、USB 配置始终可用，固件无重启或死锁。
5. 连接接收器热点后，通过系统弹出的 captive portal 页面或任意被重定向的 HTTP 主机名进入界面；确认页面能探测本地 `/api/status`，不依赖地址栏必须是 `192.168.4.1`。
6. 保持 USB 配置页连接和轮询，在游戏或 XInput 测试程序中持续操作并触发震动；确认输入、双马达震动和 Capture 键没有明显延迟或丢失。
7. 从 USB 页面点击 **Reboot**；确认先显示预期重启状态，设备断开时不出现矛盾的失败提示，重枚举后可以重新连接。

## 回归检查

1. 在 Windows 游戏控制器测试页确认 A/B/X/Y、方向键、摇杆和扳机正常。
2. 在支持 XInput 震动的游戏或测试程序中确认双马达震动仍能传到 Stadia 手柄。
3. 短按 Capture，确认默认 `PrintScreen` 输出正常。
4. 同时按住 Assistant + Capture 约 2 秒，确认鼠标模式仍能进入和退出。
5. 如需 OTA，连接 `StadiaDongle-XXXX` 并打开 `http://192.168.4.1`，确认上传入口仍可用。

## 失败时需要保存的信息

- 页面中的完整错误文本
- Chrome 或 Edge 版本
- Windows 设备管理器中相关设备的名称和错误代码
- ESP32 串口日志中 `USB_CONFIG`、`HID_EXTRA` 和 `USB` 标签附近的内容
- 失败发生在哪一步，以及拔插后能否恢复
