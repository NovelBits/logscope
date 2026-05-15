/*
 * LogScope BLE Showcase: Scanner + GATT Server Demo
 *
 * This firmware plays two roles simultaneously:
 *
 *   1. Observer (passive scanner). Every received Advertising Report
 *      flows up through HCI to LogScope's HCI panel, where the new BLE
 *      decoders surface:
 *        - Manufacturer Specific Data Company IDs resolved to vendor
 *          names ("Apple, Inc.", "Bose Corporation",
 *          "Samsung Electronics Co. Ltd.", "Nordic Semiconductor ASA")
 *        - AD types parsed into named fields (Flags, Local Name,
 *          Service UUIDs, Tx Power)
 *        - HCI Command Complete events with status annotated with the
 *          Bluetooth Core Spec section reference
 *
 *   2. Peripheral (GATT server). Advertises as "logscope-demo" and
 *      exposes three SIG-defined services:
 *        - Battery Service (0x180F)         notify every 10 s, 100 -> 0
 *        - Heart Rate Service (0x180D)      notify every 2 s, 60-100 BPM
 *        - Device Information Service (0x180A)
 *
 *      When a phone (e.g. nRF Connect) connects and walks the GATT
 *      database, LogScope's ATT decoder names every service,
 *      characteristic, and descriptor instead of showing raw hex.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/bluetooth/services/bas.h>
#include <zephyr/bluetooth/services/hrs.h>

LOG_MODULE_REGISTER(ble_showcase, LOG_LEVEL_INF);

/* ---------------------------------------------------------------------
 * Observer role: scan callback
 * --------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------
 * Peripheral role: advertising data + GATT server
 * --------------------------------------------------------------------- */

#define DEVICE_NAME      "logscope-demo"
#define DEVICE_NAME_LEN  (sizeof(DEVICE_NAME) - 1)

static const struct bt_data ad[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
	BT_DATA_BYTES(BT_DATA_UUID16_ALL,
		      BT_UUID_16_ENCODE(BT_UUID_BAS_VAL),
		      BT_UUID_16_ENCODE(BT_UUID_HRS_VAL),
		      BT_UUID_16_ENCODE(BT_UUID_DIS_VAL)),
};

static const struct bt_data sd[] = {
	BT_DATA(BT_DATA_NAME_COMPLETE, DEVICE_NAME, DEVICE_NAME_LEN),
};

static uint8_t battery_level = 100;
static uint8_t heart_rate_bpm = 60;

/* Forward declarations so the K_WORK_DELAYABLE_DEFINE macros can bind. */
static void battery_work_handler(struct k_work *work);
static void hr_work_handler(struct k_work *work);

static K_WORK_DELAYABLE_DEFINE(battery_work, battery_work_handler);
static K_WORK_DELAYABLE_DEFINE(hr_work, hr_work_handler);

static void battery_work_handler(struct k_work *work)
{
	if (battery_level == 0) {
		battery_level = 100;
	} else {
		battery_level--;
	}
	bt_bas_set_battery_level(battery_level);
	k_work_schedule(&battery_work, K_SECONDS(10));
}

static void hr_work_handler(struct k_work *work)
{
	/* Oscillate 60-100 BPM */
	static int8_t direction = 1;

	if (heart_rate_bpm >= 100) {
		direction = -1;
	}
	if (heart_rate_bpm <= 60) {
		direction = 1;
	}
	heart_rate_bpm += direction;
	bt_hrs_notify(heart_rate_bpm);
	k_work_schedule(&hr_work, K_SECONDS(2));
}

/* ---------------------------------------------------------------------
 * main
 * --------------------------------------------------------------------- */

int main(void)
{
	int err;

	LOG_INF("LogScope BLE Showcase Demo booted on %s", CONFIG_BOARD);
	LOG_INF("Roles: Observer (passive scan) + Peripheral (GATT server)");

	err = bt_enable(NULL);
	if (err) {
		LOG_ERR("bt_enable failed: %d", err);
		return 0;
	}

	/* --- Observer role: start active scan --- */
	err = bt_le_scan_start(BT_LE_SCAN_ACTIVE, scan_cb);
	if (err) {
		LOG_ERR("bt_le_scan_start failed: %d", err);
	} else {
		LOG_INF("Scan started. HCI Advertising Reports flowing to LogScope panel.");
	}

	/* --- Peripheral role: start connectable advertising --- */
	err = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad),
			      sd, ARRAY_SIZE(sd));
	if (err) {
		LOG_ERR("Advertising failed: %d", err);
	} else {
		LOG_INF("Advertising as '%s'", DEVICE_NAME);
	}

	/* Kick off the periodic notifiers. */
	k_work_schedule(&battery_work, K_SECONDS(10));
	k_work_schedule(&hr_work, K_SECONDS(2));

	return 0;
}
