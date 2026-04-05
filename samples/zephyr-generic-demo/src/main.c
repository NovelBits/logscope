/*
 * LogScope Generic Zephyr Demo (any board with J-Link RTT)
 *
 * Platform-independent logging showcase using standard Zephyr APIs.
 * No Nordic-specific dependencies. Works on any board that has:
 *   - SEGGER RTT support (J-Link probe)
 *   - GPIO buttons defined as sw0-sw3 in devicetree (optional)
 *
 * Modules: app (main), sensor_drv, flash_mgr, crypto_mgr
 * All severity levels cycling at different intervals.
 * Buttons (if available) trigger interactive demo scenarios.
 *
 * Buttons:
 *   sw0 (Button 0): Sensor anomaly sequence
 *   sw1 (Button 1): Flash corruption and recovery sequence
 *   sw2 (Button 2): Stress burst (50 rapid-fire messages)
 *   sw3 (Button 3): Reserved (logs "no action assigned")
 *
 * Suggested watch patterns for LogScope:
 *   { "name": "Errors",          "pattern": "failed|error|fault|CRC|timeout",     "regex": true, "color": "#f44336" }
 *   { "name": "Retransmission",  "pattern": "Retransmission",                                    "color": "#ff9800" }
 *   { "name": "Heartbeat",       "pattern": "Heartbeat",                                         "color": "#4caf50" }
 *
 * Build (example for nRF52840 DK):
 *   west build -b nrf52840dk/nrf52840 samples/zephyr-generic-demo -p
 *   west flash
 *
 * Build (example for nRF54L15 DK):
 *   west build -b nrf54l15dk/nrf54l15/cpuapp samples/zephyr-generic-demo -p
 *   west flash
 *
 * Build (example for STM32 Nucleo):
 *   west build -b nucleo_f446re samples/zephyr-generic-demo -p
 *   west flash
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/drivers/gpio.h>
#include "modules.h"

LOG_MODULE_REGISTER(app, LOG_LEVEL_DBG);

/* ── Button setup (optional, uses devicetree sw0-sw3 aliases) ── */

/* Check which buttons exist in devicetree */
#if DT_NODE_EXISTS(DT_ALIAS(sw0))
#define HAS_BTN0 1
static const struct gpio_dt_spec btn0 = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);
#endif

#if DT_NODE_EXISTS(DT_ALIAS(sw1))
#define HAS_BTN1 1
static const struct gpio_dt_spec btn1 = GPIO_DT_SPEC_GET(DT_ALIAS(sw1), gpios);
#endif

#if DT_NODE_EXISTS(DT_ALIAS(sw2))
#define HAS_BTN2 1
static const struct gpio_dt_spec btn2 = GPIO_DT_SPEC_GET(DT_ALIAS(sw2), gpios);
#endif

#if DT_NODE_EXISTS(DT_ALIAS(sw3))
#define HAS_BTN3 1
static const struct gpio_dt_spec btn3 = GPIO_DT_SPEC_GET(DT_ALIAS(sw3), gpios);
#endif

static struct gpio_callback btn_cb_data;
static volatile bool btn0_pressed;
static volatile bool btn1_pressed;
static volatile bool btn2_pressed;
static volatile bool btn3_pressed;

static void button_isr(const struct device *dev, struct gpio_callback *cb, uint32_t pins)
{
	ARG_UNUSED(dev);
	ARG_UNUSED(cb);

#ifdef HAS_BTN0
	if (pins & BIT(btn0.pin)) { btn0_pressed = true; }
#endif
#ifdef HAS_BTN1
	if (pins & BIT(btn1.pin)) { btn1_pressed = true; }
#endif
#ifdef HAS_BTN2
	if (pins & BIT(btn2.pin)) { btn2_pressed = true; }
#endif
#ifdef HAS_BTN3
	if (pins & BIT(btn3.pin)) { btn3_pressed = true; }
#endif
}

static int init_buttons(void)
{
	int err;
	uint32_t pin_mask = 0;

#ifdef HAS_BTN0
	if (!gpio_is_ready_dt(&btn0)) {
		LOG_WRN("Button 0 GPIO not ready, skipping");
	} else {
		err = gpio_pin_configure_dt(&btn0, GPIO_INPUT);
		if (err == 0) {
			err = gpio_pin_interrupt_configure_dt(&btn0, GPIO_INT_EDGE_TO_ACTIVE);
		}
		if (err == 0) {
			pin_mask |= BIT(btn0.pin);
			LOG_DBG("Button 0 (sw0) configured on pin %d", btn0.pin);
		}
	}
#endif
#ifdef HAS_BTN1
	if (!gpio_is_ready_dt(&btn1)) {
		LOG_WRN("Button 1 GPIO not ready, skipping");
	} else {
		err = gpio_pin_configure_dt(&btn1, GPIO_INPUT);
		if (err == 0) {
			err = gpio_pin_interrupt_configure_dt(&btn1, GPIO_INT_EDGE_TO_ACTIVE);
		}
		if (err == 0) {
			pin_mask |= BIT(btn1.pin);
			LOG_DBG("Button 1 (sw1) configured on pin %d", btn1.pin);
		}
	}
#endif
#ifdef HAS_BTN2
	if (!gpio_is_ready_dt(&btn2)) {
		LOG_WRN("Button 2 GPIO not ready, skipping");
	} else {
		err = gpio_pin_configure_dt(&btn2, GPIO_INPUT);
		if (err == 0) {
			err = gpio_pin_interrupt_configure_dt(&btn2, GPIO_INT_EDGE_TO_ACTIVE);
		}
		if (err == 0) {
			pin_mask |= BIT(btn2.pin);
			LOG_DBG("Button 2 (sw2) configured on pin %d", btn2.pin);
		}
	}
#endif
#ifdef HAS_BTN3
	if (!gpio_is_ready_dt(&btn3)) {
		LOG_WRN("Button 3 GPIO not ready, skipping");
	} else {
		err = gpio_pin_configure_dt(&btn3, GPIO_INPUT);
		if (err == 0) {
			err = gpio_pin_interrupt_configure_dt(&btn3, GPIO_INT_EDGE_TO_ACTIVE);
		}
		if (err == 0) {
			pin_mask |= BIT(btn3.pin);
			LOG_DBG("Button 3 (sw3) configured on pin %d", btn3.pin);
		}
	}
#endif

	if (pin_mask == 0) {
		LOG_INF("No buttons found in devicetree (demo runs without button triggers)");
		return 0;
	}

	/* All buttons share one GPIO port on most boards */
#ifdef HAS_BTN0
	gpio_init_callback(&btn_cb_data, button_isr, pin_mask);
	gpio_add_callback(btn0.port, &btn_cb_data);
#endif

	int count = __builtin_popcount(pin_mask);
	LOG_INF("Buttons initialized (%d button%s ready)", count, count > 1 ? "s" : "");
	return 0;
}

/* ── Burst mode ────────────────────────────────────────────── */
static int burst_remaining;

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

/* ── Retransmission counter ────────────────────────────────── */
static int retransmission_seq;

/* ── Process button presses ─��──────────────────────────────── */
static void process_buttons(void)
{
	if (btn0_pressed) {
		btn0_pressed = false;
		sensor_drv_anomaly();
	}

	if (btn1_pressed) {
		btn1_pressed = false;
		flash_mgr_corruption();
	}

	if (btn2_pressed) {
		btn2_pressed = false;
		LOG_WRN("Stress burst triggered via button (50 messages)");
		burst_remaining = 50;
	}

	if (btn3_pressed) {
		btn3_pressed = false;
		LOG_INF("Button 3: no action assigned (reserved for future use)");
	}
}

/* ── Main ────────────────────────────────��─────────────────── */
int main(void)
{
	LOG_INF("LogScope Generic Zephyr Demo starting");
	LOG_INF("Platform: %s", CONFIG_BOARD);
	LOG_INF("Buttons: 0=sensor anomaly, 1=flash corruption, 2=stress burst");

	/* Initialize modules */
	sensor_drv_init();
	flash_mgr_init();
	crypto_mgr_init();

	/* Initialize buttons (graceful if none exist) */
	init_buttons();

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
		}

		/* Flash activity */
		flash_mgr_tick(cycle);

		/* Crypto activity */
		crypto_mgr_tick(cycle);

		/* Heartbeat every 5 seconds */
		if (cycle % 5 == 0) {
			LOG_INF("Heartbeat %d: uptime %lld ms", cycle, k_uptime_get());
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
