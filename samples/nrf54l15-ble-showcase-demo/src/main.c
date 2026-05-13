/*
 * LogScope BLE Showcase: Scanner Demo
 *
 * Starts active Bluetooth LE scanning. Every received Advertising
 * Report flows up through HCI to LogScope's HCI panel. There, the new
 * BLE decoders surface:
 *   - Manufacturer Specific Data Company IDs resolved to vendor names
 *     ("Apple, Inc.", "Bose Corporation", "Samsung Electronics Co. Ltd.",
 *     "Nordic Semiconductor ASA", etc.)
 *   - AD types parsed into named fields (Flags, Local Name, Service
 *     UUIDs, Tx Power)
 *   - HCI Command Complete events with status annotated with the
 *     Bluetooth Core Spec section reference
 *
 * No callback work is done in firmware: the HCI events themselves are
 * what we care about, and they're already captured on RTT channel 1
 * by Zephyr's btmonitor backend.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/bluetooth/bluetooth.h>

LOG_MODULE_REGISTER(ble_scanner, LOG_LEVEL_INF);

static void scan_cb(const bt_addr_le_t *addr, int8_t rssi,
		    uint8_t adv_type, struct net_buf_simple *buf)
{
	/* Intentionally minimal: the HCI events already carry the full
	 * advertising data and LogScope decodes them. We just count how
	 * many we've seen so the user has a visual heartbeat in the
	 * Zephyr log channel.
	 */
	static uint32_t adv_count;
	adv_count++;
	if (adv_count % 50 == 0) {
		LOG_INF("Saw %u advertising reports so far", adv_count);
	}
}

int main(void)
{
	int err;

	LOG_INF("LogScope BLE Scanner Demo booted on %s", CONFIG_BOARD);
	LOG_INF("Bluetooth LE active scan, watching the air around you.");

	err = bt_enable(NULL);
	if (err) {
		LOG_ERR("bt_enable failed: %d", err);
		return 0;
	}

	err = bt_le_scan_start(BT_LE_SCAN_ACTIVE, scan_cb);
	if (err) {
		LOG_ERR("bt_le_scan_start failed: %d", err);
		return 0;
	}

	LOG_INF("Scan started. HCI Advertising Reports flowing to LogScope panel.");
	return 0;
}
