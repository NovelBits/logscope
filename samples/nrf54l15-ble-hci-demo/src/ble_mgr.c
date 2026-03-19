/*
 * Bluetooth LE manager — GATT service, notifications, connection management
 * Registers as its own Zephyr log module for proper filtering in LogScope.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/sys/byteorder.h>
#include "modules.h"

LOG_MODULE_REGISTER(ble_mgr, LOG_LEVEL_DBG);

/* ── Custom GATT Service UUIDs ──────────────────────────────── */

static struct bt_uuid_128 logscope_svc_uuid = BT_UUID_INIT_128(
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef0));

static struct bt_uuid_128 info_char_uuid = BT_UUID_INIT_128(
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef1));

static struct bt_uuid_128 cmd_char_uuid = BT_UUID_INIT_128(
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef2));

static struct bt_uuid_128 sensor_char_uuid = BT_UUID_INIT_128(
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef3));

/* ── State ──────────────────────────────────────────────────── */
static struct bt_conn *current_conn;
static bool notify_enabled;
extern int burst_remaining;  /* defined in main.c */

/* ── GATT: Read characteristic (device info) ────────────────── */
static ssize_t read_info(struct bt_conn *conn, const struct bt_gatt_attr *attr,
			 void *buf, uint16_t len, uint16_t offset)
{
	const char *info = "LogScope Demo v2 | nRF54L15 DK | Novel Bits";

	LOG_DBG("GATT read: info characteristic");
	return bt_gatt_attr_read(conn, attr, buf, len, offset, info, strlen(info));
}

/* ── GATT: Write characteristic (command) ───────────────────── */
static ssize_t write_cmd(struct bt_conn *conn, const struct bt_gatt_attr *attr,
			 const void *buf, uint16_t len, uint16_t offset, uint8_t flags)
{
	if (len < 1) {
		return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
	}

	uint8_t cmd = ((const uint8_t *)buf)[0];

	switch (cmd) {
	case 0x01:
		LOG_WRN("Burst mode triggered via GATT write (50 messages)");
		burst_remaining = 50;
		break;
	case 0x02:
		LOG_INF("Reset sensor counter via GATT write");
		break;
	case 0x03:
		LOG_INF("Manual flash erase triggered via GATT");
		break;
	case 0x04:
		LOG_ERR("***** HARD FAULT *****");
		LOG_ERR("  Fault escalation (see below)");
		LOG_ERR("  r0/a1:  0x00000000  r1/a2:  0x00000004");
		LOG_ERR("  r12/ip: 0x00000000  r14/lr: 0x0000abcd");
		LOG_ERR("  Faulting instruction address: 0x00012345");
		LOG_ERR(">>> ZEPHYR FATAL ERROR 1: Unhandled interrupt");
		LOG_ERR("Halting system");
		break;
	case 0x05:
		LOG_ERR("Triggering real hard fault (invalid memory access)...");
		*((volatile uint32_t *)0xDEADBEEF) = 0;
		break;
	default:
		LOG_WRN("Unknown command byte: 0x%02x", cmd);
		break;
	}

	return len;
}

/* ── GATT: Notify characteristic (sensor data) ──────────────── */
static void sensor_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value)
{
	notify_enabled = (value == BT_GATT_CCC_NOTIFY);
	LOG_INF("Sensor notifications %s", notify_enabled ? "enabled" : "disabled");
}

/* ── GATT Service Registration ──────────────────────────────── */
BT_GATT_SERVICE_DEFINE(logscope_svc,
	BT_GATT_PRIMARY_SERVICE(&logscope_svc_uuid),
	BT_GATT_CHARACTERISTIC(&info_char_uuid.uuid,
		BT_GATT_CHRC_READ, BT_GATT_PERM_READ,
		read_info, NULL, NULL),
	BT_GATT_CHARACTERISTIC(&cmd_char_uuid.uuid,
		BT_GATT_CHRC_WRITE, BT_GATT_PERM_WRITE,
		NULL, write_cmd, NULL),
	BT_GATT_CHARACTERISTIC(&sensor_char_uuid.uuid,
		BT_GATT_CHRC_NOTIFY, BT_GATT_PERM_NONE,
		NULL, NULL, NULL),
	BT_GATT_CCC(sensor_ccc_changed, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
);

/* ── Public API ─────────────────────────────────────────────── */

void ble_mgr_init(void)
{
	LOG_INF("GATT service registered: read + write + notify characteristics");
}

void ble_mgr_on_connected(void)
{
	notify_enabled = false;
}

void ble_mgr_on_disconnected(void)
{
	notify_enabled = false;
}

struct bt_conn *ble_mgr_get_conn(void)
{
	return current_conn;
}

void ble_mgr_set_conn(struct bt_conn *conn)
{
	if (current_conn) {
		bt_conn_unref(current_conn);
	}
	current_conn = conn ? bt_conn_ref(conn) : NULL;
}

void ble_mgr_send_notification(uint32_t value)
{
	if (!current_conn || !notify_enabled) {
		return;
	}

	uint8_t data[4];
	sys_put_le32(value, data);

	int err = bt_gatt_notify(current_conn, &logscope_svc.attrs[7], data, sizeof(data));
	if (err) {
		LOG_WRN("Sensor notification failed (err %d)", err);
	} else {
		LOG_DBG("Sensor notification sent: value=%u", value);
	}
}

void ble_mgr_tick(int cycle)
{
	if (cycle % 10 == 0 && current_conn) {
		LOG_DBG("RSSI check scheduled for connection 0x0040");
	}
	if (cycle % 20 == 0) {
		LOG_INF("Advertising data updated (TX power: %d dBm)", -4 + (cycle % 3));
	}
}
