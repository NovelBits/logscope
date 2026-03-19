/*
 * LogScope UART Demo — nRF54L15 DK
 *
 * Logging demo over UART for testing LogScope serial transport.
 * Modules: app, sensor_drv, flash_mgr, crypto_mgr
 * All severity levels cycling at different intervals.
 *
 * Build:
 *   source samples/nrf54l15-uart-demo/setup-env.sh
 *   west build -b nrf54l15dk/nrf54l15/cpuapp samples/nrf54l15-uart-demo --build-dir build-uart -p
 *   west flash --build-dir build-uart
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include "modules.h"

LOG_MODULE_REGISTER(app, LOG_LEVEL_DBG);

int main(void)
{
	LOG_INF("LogScope UART Demo starting");
	LOG_INF("Logging over UART at 115200 baud");

	/* Initialize modules */
	sensor_drv_init();
	flash_mgr_init();
	crypto_mgr_init();

	int cycle = 0;

	while (1) {
		cycle++;

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
			LOG_INF("Heartbeat %d: uptime %lld ms",
				cycle, k_uptime_get());
		}

		k_sleep(K_SECONDS(1));
	}

	return 0;
}
