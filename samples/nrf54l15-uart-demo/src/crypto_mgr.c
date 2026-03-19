/*
 * Simulated crypto manager — AES-128-CCM encryption operations
 * Registers as its own Zephyr log module for proper filtering in LogScope.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include "modules.h"

LOG_MODULE_REGISTER(crypto_mgr, LOG_LEVEL_DBG);

void crypto_mgr_init(void)
{
	LOG_INF("Hardware crypto engine initialized (AES-128-CCM)");
}

void crypto_mgr_tick(int cycle)
{
	if (cycle % 4 == 0) {
		LOG_DBG("AES-128-CCM encrypt: 64B payload, nonce=0x%08x", cycle * 0x1234);
	}
	if (cycle % 30 == 0) {
		LOG_ERR("MAC verification failed (expected: 0x%08x, got: 0x%08x)",
			0xDEADBEEF, 0xBADC0FFE);
	}
	if (cycle % 15 == 0) {
		LOG_WRN("Key rotation due: current key age %d hours", 12 + cycle / 15);
	}
}
