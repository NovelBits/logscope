/*
 * LogScope Silent Demo
 *
 * Logs two lines at boot, then sleeps forever. Used to reproduce and verify
 * the fix for the RTT silence-recovery loop (issue #17). Without firmware
 * activity to keep the RTT channel busy, the silence-detection path is
 * exercised cleanly — no need to fight chatty BLE/sensor logs.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(silent_demo, LOG_LEVEL_INF);

int main(void)
{
	LOG_INF("Silent demo booted on %s", CONFIG_BOARD);
	LOG_INF("Going silent — verifying RTT silence recovery (issue #17)");
	k_sleep(K_FOREVER);
	return 0;
}
