/*
 * LogScope Bluetooth LE HCI Demo — nRF54L15 DK (Showcase)
 *
 * Rich logging demo with proper Zephyr log modules:
 * - app (main), sensor_drv, flash_mgr, crypto_mgr, ble_mgr
 * - All severity levels cycling at different intervals
 * - Custom GATT service (read/write/notify)
 * - Burst mode (write 0x01 to command characteristic)
 * - HCI traces on RTT Channel 1
 * - 4 DK buttons for interactive demo scenarios
 *
 * Buttons:
 *   Button 0: Toggle advertising (idle) / Force disconnect (connected)
 *   Button 1: Sensor anomaly sequence + notification burst (if connected)
 *   Button 2: Flash corruption and recovery sequence
 *   Button 3: Stress burst (50 rapid-fire messages)
 *
 * Suggested watch patterns for LogScope:
 *   { "name": "BLE State",       "pattern": "Connected|Disconnected|Advertising", "regex": true, "color": "#4caf50" }
 *   { "name": "Errors",          "pattern": "failed|error|fault|CRC|timeout",     "regex": true, "color": "#f44336" }
 *   { "name": "Retransmission",  "pattern": "Retransmission",                                    "color": "#ff9800" }
 *
 * Build:
 *   source samples/nrf54l15-ble-hci-demo/setup-env.sh
 *   west build -b nrf54l15dk/nrf54l15/cpuapp samples/nrf54l15-ble-hci-demo --build-dir build-hci -p
 *   west flash --build-dir build-hci
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/hci.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/uuid.h>
#include <dk_buttons_and_leds.h>
#include "modules.h"

LOG_MODULE_REGISTER(app, LOG_LEVEL_DBG);

/* Shared burst state (accessed by ble_mgr.c) */
int burst_remaining;

/* Forward declarations from ble_mgr.c */
extern struct bt_conn *ble_mgr_get_conn(void);
extern void ble_mgr_set_conn(struct bt_conn *conn);

/* ── Advertising data ───────────────────────────────────────── */
/* 128-bit UUID as byte array for advertising data */
static const uint8_t logscope_svc_uuid_ad[] = {
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef0)
};

static const struct bt_data ad[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
	BT_DATA(BT_DATA_UUID128_ALL, logscope_svc_uuid_ad, sizeof(logscope_svc_uuid_ad)),
};

static const struct bt_data sd[] = {
	BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME,
		sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};

/* ── Connection callbacks ───────────────────────────────────── */
static void connected(struct bt_conn *conn, uint8_t err)
{
	char addr[BT_ADDR_LE_STR_LEN];

	bt_addr_le_to_str(bt_conn_get_dst(conn), addr, sizeof(addr));

	if (err) {
		LOG_ERR("Connection failed (addr %s, err 0x%02x %s)",
			addr, err, bt_hci_err_to_str(err));
		return;
	}

	LOG_INF("Connected: %s", addr);
	ble_mgr_set_conn(conn);
	ble_mgr_on_connected();
}

static void disconnected(struct bt_conn *conn, uint8_t reason)
{
	char addr[BT_ADDR_LE_STR_LEN];

	bt_addr_le_to_str(bt_conn_get_dst(conn), addr, sizeof(addr));
	LOG_INF("Disconnected: %s (reason 0x%02x %s)",
		addr, reason, bt_hci_err_to_str(reason));

	ble_mgr_set_conn(NULL);
	ble_mgr_on_disconnected();

	int ret = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad),
				  sd, ARRAY_SIZE(sd));
	if (ret) {
		LOG_ERR("Re-advertising failed (err %d)", ret);
	} else {
		LOG_INF("Re-advertising started");
	}
}

static void le_param_updated(struct bt_conn *conn, uint16_t interval,
			     uint16_t latency, uint16_t timeout)
{
	LOG_INF("Connection params updated: interval %d (%.2f ms), latency %d, timeout %d",
		interval, interval * 1.25, latency, timeout);
}

BT_CONN_CB_DEFINE(conn_callbacks) = {
	.connected = connected,
	.disconnected = disconnected,
	.le_param_updated = le_param_updated,
};

/* ── Button flags (set in ISR, processed in main loop) ─────── */
static volatile bool btn0_pressed;
static volatile bool btn1_pressed;
static volatile bool btn2_pressed;
static volatile bool btn3_pressed;

static void button_handler(uint32_t button_state, uint32_t has_changed)
{
	if (has_changed & DK_BTN1_MSK && button_state & DK_BTN1_MSK) {
		btn0_pressed = true;
	}
	if (has_changed & DK_BTN2_MSK && button_state & DK_BTN2_MSK) {
		btn1_pressed = true;
	}
	if (has_changed & DK_BTN3_MSK && button_state & DK_BTN3_MSK) {
		btn2_pressed = true;
	}
	if (has_changed & DK_BTN4_MSK && button_state & DK_BTN4_MSK) {
		btn3_pressed = true;
	}
}

/* ── Retransmission counter (pseudo-random interval) ───────── */
static int retransmission_seq;

/* ── Burst mode (enhanced with realistic messages) ─────────── */
void burst_run(int *remaining)
{
	int n = 50 - *remaining;

	switch (*remaining % 10) {
	case 0:
		LOG_ERR("Retransmission timeout on channel 3 (attempt 2/3)");
		break;
	case 1:
		LOG_WRN("Sensor calibration drift detected: 0.3C");
		break;
	case 2:
		LOG_ERR("CRC mismatch during burst write at 0x%08x", 0x80000 + n * 256);
		break;
	case 3:
		LOG_WRN("Key derivation took 45ms (threshold: 20ms)");
		break;
	case 4:
		LOG_INF("Connection event missed, scheduling recovery");
		break;
	case 5:
		LOG_ERR("Flash write failed at 0x%08x (timeout after 50ms)", 0x90000 + n * 256);
		break;
	case 6:
		LOG_WRN("RSSI dropped to -89 dBm (threshold: -80 dBm)");
		break;
	case 7:
		LOG_INF("Notification queued (pending: %d)", n % 8 + 1);
		break;
	case 8:
		LOG_ERR("MAC verification failed (expected: 0x%08x, got: 0x%08x)",
			0xDEADBEEF, 0xBADC0FFE + n);
		break;
	case 9:
		LOG_DBG("AES-128-CCM encrypt: 64B payload, nonce=0x%08x", n * 0x1234);
		break;
	}

	(*remaining)--;
	if (*remaining == 0) {
		LOG_INF("Burst complete (50 messages sent)");
	}
}

/* ── Process button presses (called from main loop) ────────── */
static void process_buttons(void)
{
	bool connected = (ble_mgr_get_conn() != NULL);

	if (btn0_pressed) {
		btn0_pressed = false;
		if (connected) {
			ble_mgr_force_disconnect();
		} else {
			ble_mgr_toggle_advertising();
		}
	}

	if (btn1_pressed) {
		btn1_pressed = false;
		sensor_drv_anomaly(connected);
	}

	if (btn2_pressed) {
		btn2_pressed = false;
		flash_mgr_corruption();
	}

	if (btn3_pressed) {
		btn3_pressed = false;
		LOG_WRN("Stress burst triggered via Button 3 (50 messages)");
		burst_remaining = 50;
	}
}

/* ── Main ───────────────────────────────────────────────────── */
int main(void)
{
	int err;

	LOG_INF("LogScope Bluetooth LE HCI Demo starting (showcase)");
	LOG_INF("HCI traces streaming to RTT Channel 1");
	LOG_INF("Buttons: 0=BLE control, 1=sensor anomaly, 2=flash corruption, 3=stress burst");

	/* Initialize modules */
	sensor_drv_init();
	flash_mgr_init();
	crypto_mgr_init();

	/* Initialize DK buttons */
	err = dk_buttons_init(button_handler);
	if (err) {
		LOG_ERR("Button init failed (err %d)", err);
	} else {
		LOG_INF("DK buttons initialized (4 buttons ready)");
	}

	err = bt_enable(NULL);
	if (err) {
		LOG_ERR("Bluetooth init failed (err %d)", err);
		return 0;
	}

	LOG_INF("Bluetooth initialized");

	err = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad),
			      sd, ARRAY_SIZE(sd));
	if (err) {
		LOG_ERR("Advertising failed to start (err %d)", err);
		return 0;
	}

	LOG_INF("Advertising as \"%s\"", CONFIG_BT_DEVICE_NAME);
	ble_mgr_init();

	int cycle = 0;

	while (1) {
		cycle++;

		/* Process button presses (flags set in ISR) */
		process_buttons();

		/* Burst mode: rapid-fire logging */
		if (burst_remaining > 0) {
			burst_run(&burst_remaining);
			k_sleep(K_MSEC(20));
			continue;
		}

		/* Sensor readings every 2 seconds */
		if (cycle % 2 == 0) {
			sensor_drv_read(cycle);
			ble_mgr_send_notification(sensor_drv_get_value());
		}

		/* Flash activity */
		flash_mgr_tick(cycle);

		/* Crypto activity */
		crypto_mgr_tick(cycle);

		/* Bluetooth LE manager activity */
		ble_mgr_tick(cycle);

		/* Heartbeat every 5 seconds */
		if (cycle % 5 == 0) {
			if (ble_mgr_get_conn()) {
				LOG_INF("Heartbeat %d: connected, uptime %lld ms",
					cycle, k_uptime_get());
			} else {
				LOG_INF("Heartbeat %d: advertising, uptime %lld ms",
					cycle, k_uptime_get());
			}
		}

		/* Retransmission warning (pseudo-random: every 8-12 seconds) */
		if ((cycle * 7 + 3) % 11 == 0) {
			retransmission_seq++;
			LOG_WRN("Retransmission on handle 0x0040 (seq: %d, attempt: 1)",
				retransmission_seq);
		}

		/* Battery check every 45 seconds */
		if (cycle % 45 == 0) {
			int voltage_mv = 3100 + (cycle % 200) - 100;
			int pct = (voltage_mv - 2700) * 100 / 900;
			if (pct < 100) pct = (pct < 0) ? 0 : pct;
			if (pct < 20) {
				LOG_WRN("Battery: %d.%dV (%d%% remaining)",
					voltage_mv / 1000, (voltage_mv % 1000) / 100, pct);
			} else {
				LOG_INF("Battery: %d.%dV (%d%% remaining)",
					voltage_mv / 1000, (voltage_mv % 1000) / 100, pct);
			}
		}

		k_sleep(K_SECONDS(1));
	}

	return 0;
}
