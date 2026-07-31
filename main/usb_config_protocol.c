#include "usb_config_protocol.h"

#include "ble_central.h"
#include "config_store.h"
#include "controller_manager.h"
#include "dongle_config.h"
#include "dongle_state.h"
#include "web_server.h"

#include "esp_err.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include <string.h>
#include <strings.h>

#define USB_CONFIG_QUEUE_DEPTH 2
#define USB_CONFIG_PAIRING_DEFAULT_MS 120000U
#define USB_CONFIG_CONTROLLER_ADDRESS_SIZE 18
#define USB_CONFIG_CONTROLLER_NAME_SIZE 31

typedef struct {
    size_t len;
    uint8_t data[USB_CONFIG_REPORT_DATA_SIZE];
} usb_config_request_t;

static const char *TAG = "USB_CONFIG";
static QueueHandle_t s_request_queue;
static portMUX_TYPE s_response_lock = portMUX_INITIALIZER_UNLOCKED;
static uint8_t s_response[USB_CONFIG_REPORT_DATA_SIZE];

static void put_u16(uint8_t *out, uint16_t value)
{
    out[0] = (uint8_t)(value & 0xff);
    out[1] = (uint8_t)(value >> 8);
}

static void put_u32(uint8_t *out, uint32_t value)
{
    out[0] = (uint8_t)(value & 0xff);
    out[1] = (uint8_t)((value >> 8) & 0xff);
    out[2] = (uint8_t)((value >> 16) & 0xff);
    out[3] = (uint8_t)((value >> 24) & 0xff);
}

static uint16_t get_u16(const uint8_t *in)
{
    return (uint16_t)in[0] | ((uint16_t)in[1] << 8);
}

static void copy_fixed_string(uint8_t *out, size_t out_len, const char *value)
{
    memset(out, 0, out_len);
    if (!value || out_len == 0) return;
    size_t len = strnlen(value, out_len - 1);
    memcpy(out, value, len);
}

static void response_begin(uint8_t *response, uint8_t sequence, uint8_t command,
                           usb_config_status_t status)
{
    memset(response, 0, USB_CONFIG_REPORT_DATA_SIZE);
    response[0] = USB_CONFIG_MAGIC;
    response[1] = USB_CONFIG_PROTOCOL_VERSION;
    response[2] = sequence;
    response[3] = command;
    response[4] = (uint8_t)status;
}

static void response_set_payload_length(uint8_t *response, size_t payload_len)
{
    response[5] = (uint8_t)(payload_len <= USB_CONFIG_MAX_PAYLOAD
                                ? payload_len
                                : USB_CONFIG_MAX_PAYLOAD);
}

static void publish_response(const uint8_t *response)
{
    portENTER_CRITICAL(&s_response_lock);
    memcpy(s_response, response, sizeof(s_response));
    portEXIT_CRITICAL(&s_response_lock);
}

static uint32_t pressed_mask(const stadia_controller_state_t *state)
{
    if (!state) return 0;
    uint32_t mask = 0;
    mask |= state->dpad_up ? 1u << 0 : 0;
    mask |= state->dpad_down ? 1u << 1 : 0;
    mask |= state->dpad_left ? 1u << 2 : 0;
    mask |= state->dpad_right ? 1u << 3 : 0;
    mask |= state->a ? 1u << 4 : 0;
    mask |= state->b ? 1u << 5 : 0;
    mask |= state->x ? 1u << 6 : 0;
    mask |= state->y ? 1u << 7 : 0;
    mask |= state->lb ? 1u << 8 : 0;
    mask |= state->rb ? 1u << 9 : 0;
    mask |= state->ls ? 1u << 10 : 0;
    mask |= state->rs ? 1u << 11 : 0;
    mask |= state->menu ? 1u << 12 : 0;
    mask |= state->options ? 1u << 13 : 0;
    mask |= state->stadia ? 1u << 14 : 0;
    mask |= state->assistant ? 1u << 15 : 0;
    mask |= state->capture ? 1u << 16 : 0;
    return mask;
}

static bool action_valid(uint8_t action)
{
    return action <= DONGLE_ACTION_CONSUMER_SCAN_PREV;
}

static bool command_needs_controller_manager(uint8_t command)
{
    switch ((usb_config_command_t)command) {
    case USB_CONFIG_CMD_GET_CONTROLLER_COUNT:
    case USB_CONFIG_CMD_GET_CONTROLLER:
    case USB_CONFIG_CMD_START_PAIRING:
    case USB_CONFIG_CMD_STOP_PAIRING:
    case USB_CONFIG_CMD_FORGET_CONTROLLER:
    case USB_CONFIG_CMD_FORGET_ALL:
        return true;
    default:
        return false;
    }
}

static bool live_controller_matches(const dongle_status_t *status, const char *address)
{
    for (uint8_t i = 0; i < DONGLE_MAX_CONTROLLERS; i++) {
        const dongle_controller_status_t *controller = &status->controllers[i];
        if (controller->used &&
            strcasecmp(controller->controller_address, address) == 0) {
            return true;
        }
    }
    return false;
}

static uint8_t controller_count(const dongle_status_t *status,
                                const controller_info_t *stored, int stored_count)
{
    uint8_t count = 0;
    for (uint8_t i = 0; i < DONGLE_MAX_CONTROLLERS; i++) {
        if (status->controllers[i].used || status->controllers[i].connected) count++;
    }
    for (int i = 0; i < stored_count; i++) {
        if (!live_controller_matches(status, stored[i].address)) count++;
    }
    return count;
}

static bool controller_at(const dongle_status_t *status,
                          const controller_info_t *stored, int stored_count,
                          uint8_t wanted_index,
                          dongle_controller_status_t *live_out,
                          controller_info_t *stored_out, bool *is_live)
{
    uint8_t index = 0;
    for (uint8_t i = 0; i < DONGLE_MAX_CONTROLLERS; i++) {
        const dongle_controller_status_t *controller = &status->controllers[i];
        if (!controller->used && !controller->connected) continue;
        if (index++ == wanted_index) {
            *live_out = *controller;
            *is_live = true;
            return true;
        }
    }
    for (int i = 0; i < stored_count; i++) {
        if (live_controller_matches(status, stored[i].address)) continue;
        if (index++ == wanted_index) {
            *stored_out = stored[i];
            *is_live = false;
            return true;
        }
    }
    return false;
}

static void handle_device_info(uint8_t *response)
{
    dongle_status_t status;
    dongle_state_get_status(&status);
    uint8_t *payload = response + USB_CONFIG_HEADER_SIZE;
    payload[0] = USB_CONFIG_PROTOCOL_VERSION;
    payload[1] = DONGLE_MAX_CONTROLLERS;
    put_u32(payload + 2, USB_CONFIG_CAP_KEYMAP |
                             USB_CONFIG_CAP_CONTROLLERS |
                             USB_CONFIG_CAP_LIVE_INPUT |
                             USB_CONFIG_CAP_PAIRING |
                             USB_CONFIG_CAP_FORGET |
                             USB_CONFIG_CAP_WIFI_CONTROL |
                             USB_CONFIG_CAP_REBOOT |
                             USB_CONFIG_CAP_BLE_READINESS);
    copy_fixed_string(payload + 6, 24, status.firmware_version);
    copy_fixed_string(payload + 30, 25, status.build_date);
    response_set_payload_length(response, USB_CONFIG_MAX_PAYLOAD);
}

static void handle_status(uint8_t *response)
{
    dongle_status_t status;
    dongle_state_get_status(&status);
    uint8_t *payload = response + USB_CONFIG_HEADER_SIZE;
    uint16_t flags = 0;
    flags |= status.webui_active ? 1u << 0 : 0;
    flags |= status.ble_connected ? 1u << 1 : 0;
    flags |= status.pairing_mode ? 1u << 2 : 0;
    flags |= status.usb_configured ? 1u << 3 : 0;
    flags |= status.usb_suspended ? 1u << 4 : 0;
    flags |= status.usb_remote_wakeup_enabled ? 1u << 5 : 0;
    flags |= status.last_wake_attempt_allowed ? 1u << 6 : 0;
    flags |= controller_manager_is_ready() ? 1u << 7 : 0;

    int auto_off = 0;
    if (status.webui_auto_off_deadline_us > 0) {
        int64_t remain = status.webui_auto_off_deadline_us - esp_timer_get_time();
        auto_off = remain > 0 ? (int)(remain / 1000000) : 0;
        if (auto_off > UINT16_MAX) auto_off = UINT16_MAX;
    }

    int battery = status.battery_percent;
    if (battery < 0 || battery > 100) battery = 255;

    put_u32(payload, (uint32_t)(esp_timer_get_time() / 1000));
    payload[4] = (uint8_t)status.state;
    put_u16(payload + 5, flags);
    payload[7] = (uint8_t)status.connected_count;
    payload[8] = (uint8_t)status.stored_bonds;
    payload[9] = (uint8_t)battery;
    put_u16(payload + 10, (uint16_t)auto_off);
    copy_fixed_string(payload + 12, 18, status.controller_address);
    copy_fixed_string(payload + 30, 25, status.controller_name);
    response_set_payload_length(response, USB_CONFIG_MAX_PAYLOAD);
}

static void handle_get_config(uint8_t *response)
{
    dongle_config_t config;
    config_store_get(&config);
    uint8_t *payload = response + USB_CONFIG_HEADER_SIZE;
    payload[0] = config.assistant_short_action;
    payload[1] = config.assistant_long_action;
    payload[2] = config.capture_short_action;
    payload[3] = config.capture_long_action;
    put_u16(payload + 4, config.long_press_ms);
    put_u16(payload + 6,
            (uint16_t)(config.webui_timeout_after_ble_connected_ms / 1000U));
    payload[8] = (config.disable_ap_on_usb_suspend ? 1u << 0 : 0) |
                 (config.webui_auto_start_if_no_bond ? 1u << 1 : 0);
    response_set_payload_length(response, 9);
}

static usb_config_status_t handle_set_config(const uint8_t *payload, size_t payload_len)
{
    if (payload_len != 9 ||
        !action_valid(payload[0]) ||
        !action_valid(payload[1]) ||
        !action_valid(payload[2]) ||
        !action_valid(payload[3])) {
        return USB_CONFIG_STATUS_INVALID_PAYLOAD;
    }

    uint16_t long_press_ms = get_u16(payload + 4);
    uint16_t timeout_seconds = get_u16(payload + 6);
    if (long_press_ms < 300 || long_press_ms > 5000 ||
        timeout_seconds < 15 || timeout_seconds > 1800) {
        return USB_CONFIG_STATUS_INVALID_PAYLOAD;
    }

    dongle_config_t config;
    config_store_get(&config);
    config.assistant_short_action = payload[0];
    config.assistant_long_action = payload[1];
    config.capture_short_action = payload[2];
    config.capture_long_action = payload[3];
    config.long_press_ms = long_press_ms;
    config.webui_timeout_after_ble_connected_ms = (uint32_t)timeout_seconds * 1000U;
    config.disable_ap_on_usb_suspend = (payload[8] & (1u << 0)) != 0;
    config.webui_auto_start_if_no_bond = (payload[8] & (1u << 1)) != 0;
    esp_err_t error = config_store_set(&config);
    if (error != ESP_OK) {
        ESP_LOGE(TAG, "Could not persist USB configuration: %s", esp_err_to_name(error));
        return USB_CONFIG_STATUS_INTERNAL_ERROR;
    }
    web_server_notify_config_changed();
    return USB_CONFIG_STATUS_OK;
}

static void handle_controller_count(uint8_t *response)
{
    controller_info_t stored[CONTROLLER_MANAGER_MAX_CONTROLLERS];
    int stored_count = controller_manager_list(stored, CONTROLLER_MANAGER_MAX_CONTROLLERS);
    dongle_status_t status;
    dongle_state_get_status(&status);
    response[USB_CONFIG_HEADER_SIZE] = controller_count(&status, stored, stored_count);
    response_set_payload_length(response, 1);
}

static usb_config_status_t handle_controller(uint8_t *response,
                                             const uint8_t *payload,
                                             size_t payload_len)
{
    if (payload_len != 1) return USB_CONFIG_STATUS_INVALID_PAYLOAD;
    controller_info_t stored[CONTROLLER_MANAGER_MAX_CONTROLLERS];
    int stored_count = controller_manager_list(stored, CONTROLLER_MANAGER_MAX_CONTROLLERS);
    dongle_status_t status;
    dongle_state_get_status(&status);
    uint8_t total = controller_count(&status, stored, stored_count);
    dongle_controller_status_t live = {0};
    controller_info_t saved = {0};
    bool is_live = false;
    if (!controller_at(&status, stored, stored_count, payload[0],
                       &live, &saved, &is_live)) {
        return USB_CONFIG_STATUS_NOT_FOUND;
    }

    uint8_t *out = response + USB_CONFIG_HEADER_SIZE;
    out[0] = total;
    out[1] = payload[0];
    out[2] = is_live ? live.slot_index : 255;
    out[3] = is_live ? live.usb_gamepad_index : 255;
    out[4] = is_live
                 ? ((live.bonded ? 1u << 0 : 0) |
                    (live.connected ? 1u << 1 : 0) |
                    (live.ready ? 1u << 2 : 0) |
                    (live.mouse_mode ? 1u << 3 : 0))
                 : (saved.bonded ? 1u << 0 : 0);
    int battery = is_live ? live.battery_percent : -1;
    out[5] = battery >= 0 && battery <= 100 ? (uint8_t)battery : 255;
    copy_fixed_string(out + 6, USB_CONFIG_CONTROLLER_ADDRESS_SIZE,
                      is_live ? live.controller_address : saved.address);
    copy_fixed_string(out + 24, USB_CONFIG_CONTROLLER_NAME_SIZE,
                      is_live ? live.controller_name : saved.name);
    response_set_payload_length(response, USB_CONFIG_MAX_PAYLOAD);
    return USB_CONFIG_STATUS_OK;
}

static usb_config_status_t handle_input(uint8_t *response,
                                        const uint8_t *payload,
                                        size_t payload_len)
{
    if (payload_len != 1) return USB_CONFIG_STATUS_INVALID_PAYLOAD;
    dongle_status_t status;
    dongle_state_get_status(&status);
    const stadia_controller_state_t *input = NULL;
    uint8_t flags = 0;
    if (payload[0] == 255) {
        input = &status.stadia;
    } else if (payload[0] < DONGLE_MAX_CONTROLLERS) {
        const dongle_controller_status_t *controller = &status.controllers[payload[0]];
        if (!controller->used && !controller->connected) {
            return USB_CONFIG_STATUS_NOT_FOUND;
        }
        input = &controller->stadia;
        flags = (controller->connected ? 1u << 0 : 0) |
                (controller->ready ? 1u << 1 : 0) |
                (controller->mouse_mode ? 1u << 2 : 0);
    } else {
        return USB_CONFIG_STATUS_INVALID_PAYLOAD;
    }

    uint8_t *out = response + USB_CONFIG_HEADER_SIZE;
    out[0] = payload[0];
    out[1] = flags;
    put_u32(out + 2, pressed_mask(input));
    size_t raw_len = input->raw_len < DONGLE_MAX_RAW_REPORT_SIZE
                         ? input->raw_len
                         : DONGLE_MAX_RAW_REPORT_SIZE;
    out[6] = (uint8_t)raw_len;
    memcpy(out + 7, input->raw, raw_len);
    out[39] = input->lt;
    out[40] = input->rt;
    put_u16(out + 41, (uint16_t)input->lx);
    put_u16(out + 43, (uint16_t)input->ly);
    put_u16(out + 45, (uint16_t)input->rx);
    put_u16(out + 47, (uint16_t)input->ry);
    response_set_payload_length(response, 49);
    return USB_CONFIG_STATUS_OK;
}

static usb_config_status_t handle_forget_controller(const uint8_t *payload,
                                                    size_t payload_len)
{
    if (payload_len != 17) return USB_CONFIG_STATUS_INVALID_PAYLOAD;
    char address[USB_CONFIG_CONTROLLER_ADDRESS_SIZE];
    memcpy(address, payload, payload_len);
    address[payload_len] = '\0';
    return controller_manager_forget_address(address) == 0
               ? USB_CONFIG_STATUS_OK
               : USB_CONFIG_STATUS_NOT_FOUND;
}

static bool process_request(const usb_config_request_t *request, uint8_t *response)
{
    uint8_t sequence = request->len > 2 ? request->data[2] : 0;
    uint8_t command = request->len > 3 ? request->data[3] : 0;
    response_begin(response, sequence, command, USB_CONFIG_STATUS_OK);

    if (request->len < USB_CONFIG_HEADER_SIZE) {
        response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
        return false;
    }
    if (request->data[0] != USB_CONFIG_MAGIC) {
        response[4] = USB_CONFIG_STATUS_BAD_MAGIC;
        return false;
    }
    if (request->data[1] != USB_CONFIG_PROTOCOL_VERSION) {
        response[4] = USB_CONFIG_STATUS_UNSUPPORTED_VERSION;
        return false;
    }

    size_t payload_len = request->data[4];
    if (payload_len > USB_CONFIG_MAX_PAYLOAD ||
        USB_CONFIG_HEADER_SIZE + payload_len > request->len) {
        response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
        return false;
    }
    const uint8_t *payload = request->data + USB_CONFIG_HEADER_SIZE;

    if (command_needs_controller_manager(command) && !controller_manager_is_ready()) {
        response[4] = USB_CONFIG_STATUS_NOT_READY;
        return false;
    }

    switch ((usb_config_command_t)command) {
    case USB_CONFIG_CMD_PING:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
            break;
        }
        response[USB_CONFIG_HEADER_SIZE] = USB_CONFIG_PROTOCOL_VERSION;
        response_set_payload_length(response, 1);
        break;
    case USB_CONFIG_CMD_GET_DEVICE_INFO:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
            break;
        }
        handle_device_info(response);
        break;
    case USB_CONFIG_CMD_GET_STATUS:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
            break;
        }
        handle_status(response);
        break;
    case USB_CONFIG_CMD_GET_CONFIG:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
            break;
        }
        handle_get_config(response);
        break;
    case USB_CONFIG_CMD_SET_CONFIG:
        response[4] = handle_set_config(payload, payload_len);
        if (response[4] == USB_CONFIG_STATUS_OK) handle_get_config(response);
        break;
    case USB_CONFIG_CMD_GET_CONTROLLER_COUNT:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
            break;
        }
        handle_controller_count(response);
        break;
    case USB_CONFIG_CMD_GET_CONTROLLER:
        response[4] = handle_controller(response, payload, payload_len);
        break;
    case USB_CONFIG_CMD_GET_INPUT:
        response[4] = handle_input(response, payload, payload_len);
        break;
    case USB_CONFIG_CMD_START_PAIRING: {
        uint32_t timeout_ms = USB_CONFIG_PAIRING_DEFAULT_MS;
        if (payload_len == 2) {
            uint16_t seconds = get_u16(payload);
            if (seconds < 15 || seconds > 600) {
                response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
                break;
            }
            timeout_ms = (uint32_t)seconds * 1000U;
        } else if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
            break;
        }
        controller_manager_start_pairing(timeout_ms);
        ble_central_start_scan();
        break;
    }
    case USB_CONFIG_CMD_STOP_PAIRING:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
            break;
        }
        controller_manager_stop_pairing();
        break;
    case USB_CONFIG_CMD_FORGET_CONTROLLER:
        response[4] = handle_forget_controller(payload, payload_len);
        break;
    case USB_CONFIG_CMD_FORGET_ALL:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
        } else if (controller_manager_forget_all() != 0) {
            response[4] = USB_CONFIG_STATUS_INTERNAL_ERROR;
        }
        break;
    case USB_CONFIG_CMD_START_WIFI:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
        } else {
            web_server_request_start(true);
        }
        break;
    case USB_CONFIG_CMD_STOP_WIFI:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
        } else {
            web_server_request_stop();
        }
        break;
    case USB_CONFIG_CMD_REBOOT:
        if (payload_len != 0) {
            response[4] = USB_CONFIG_STATUS_INVALID_PAYLOAD;
            break;
        }
        return true;
    default:
        response[4] = USB_CONFIG_STATUS_UNKNOWN_COMMAND;
        break;
    }
    return false;
}

static void usb_config_task(void *arg)
{
    (void)arg;
    usb_config_request_t request;
    uint8_t response[USB_CONFIG_REPORT_DATA_SIZE];
    while (true) {
        if (xQueueReceive(s_request_queue, &request, portMAX_DELAY) != pdTRUE) continue;
        bool reboot = process_request(&request, response);
        publish_response(response);
        if (reboot && response[4] == USB_CONFIG_STATUS_OK) {
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();
        }
    }
}

void usb_config_protocol_init(void)
{
    if (s_request_queue) return;
    response_begin(s_response, 0, 0, USB_CONFIG_STATUS_PENDING);
    s_request_queue = xQueueCreate(USB_CONFIG_QUEUE_DEPTH, sizeof(usb_config_request_t));
    configASSERT(s_request_queue != NULL);
    BaseType_t created = xTaskCreate(usb_config_task, "usb_config", 4096, NULL, 3, NULL);
    configASSERT(created == pdPASS);
}

bool usb_config_protocol_submit(const uint8_t *report, size_t report_len)
{
    if (!s_request_queue || !report || report_len == 0) return false;
    usb_config_request_t request = {0};
    request.len = report_len < sizeof(request.data) ? report_len : sizeof(request.data);
    memcpy(request.data, report, request.len);

    uint8_t pending[USB_CONFIG_REPORT_DATA_SIZE];
    response_begin(pending,
                   request.len > 2 ? request.data[2] : 0,
                   request.len > 3 ? request.data[3] : 0,
                   USB_CONFIG_STATUS_PENDING);
    publish_response(pending);

    if (xQueueSend(s_request_queue, &request, 0) == pdTRUE) return true;
    pending[4] = USB_CONFIG_STATUS_BUSY;
    publish_response(pending);
    return false;
}

size_t usb_config_protocol_read_response(uint8_t *report, size_t report_len)
{
    if (!report || report_len == 0) return 0;
    size_t copied = report_len < sizeof(s_response) ? report_len : sizeof(s_response);
    portENTER_CRITICAL(&s_response_lock);
    memcpy(report, s_response, copied);
    portEXIT_CRITICAL(&s_response_lock);
    return copied;
}

