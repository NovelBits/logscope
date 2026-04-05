/*
 * Simulated flash manager — NOR flash operations with wear leveling
 * Registers as its own Zephyr log module for proper filtering in LogScope.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include "modules.h"

LOG_MODULE_REGISTER(flash_mgr, LOG_LEVEL_DBG);

void flash_mgr_init(void)
{
	LOG_INF("Flash subsystem ready (NOR, 1MB, sector size 4KB)");
	LOG_DBG("Wear leveling table loaded: 256 sectors tracked");
}

void flash_mgr_tick(int cycle)
{
	uint32_t addr = 0x00080000 + (cycle * 256) % 0x10000;

	if (cycle % 15 == 0) {
		LOG_WRN("Flash wear level high on sector 0x%08x (writes: %d)",
			addr & 0xFFFF0000, 8500 + cycle);
	}
	if (cycle % 30 == 0) {
		LOG_ERR("Flash write failed at 0x%08x (timeout after 50ms)", addr);
	}
	if (cycle % 5 == 0) {
		LOG_DBG("Write 256B to 0x%08x (queue depth: %d)", addr, cycle % 8);
	}
}

/* Button 2: Flash corruption and recovery sequence */
void flash_mgr_corruption(void)
{
	LOG_ERR("CRC mismatch at sector 0x00080000 (expected: 0xA3F1, got: 0x0000)");
	LOG_WRN("Wear level critical on sector 0x00080000 (writes: 99847)");
	LOG_ERR("Flash write failed at 0x00080000 (ECC error)");
	LOG_INF("Sector 0x00080000 marked bad, remapping to 0x000A0000");
	LOG_INF("Flash recovery complete, 1 sector remapped");
}
