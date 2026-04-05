/*
 * Simulated sensor driver — temperature, humidity, accelerometer
 * Registers as its own Zephyr log module for proper filtering in LogScope.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include "modules.h"

LOG_MODULE_REGISTER(sensor_drv, LOG_LEVEL_DBG);

static uint32_t sensor_value;

void sensor_drv_init(void)
{
	LOG_INF("Initializing temperature + humidity + accelerometer");
	LOG_DBG("I2C bus scan: found 3 devices at 0x48, 0x40, 0x68");
	LOG_INF("Sensor calibration loaded (factory defaults)");
}

void sensor_drv_read(int cycle)
{
	sensor_value += 17 + (cycle % 7);
	int16_t temp = 2200 + (cycle % 50) - 25;
	uint16_t humidity = 4500 + (cycle % 100);
	int16_t accel_x = (cycle * 3) % 200 - 100;
	int16_t accel_y = (cycle * 7) % 200 - 100;
	int16_t accel_z = 980 + (cycle % 20) - 10;

	LOG_DBG("Temp: %d.%02dC, Humidity: %d.%02d%%, Accel: (%d, %d, %d) mg",
		temp / 100, temp % 100, humidity / 100, humidity % 100,
		accel_x, accel_y, accel_z);
}

uint32_t sensor_drv_get_value(void)
{
	return sensor_value;
}

/* Button 1: Sensor anomaly sequence */
static int anomaly_step;

void sensor_drv_anomaly(bool connected)
{
	/* Trigger multi-step anomaly sequence (processed in main loop ticks) */
	anomaly_step = 1;
	LOG_INF("Anomaly detected: temperature spike to 85.2C (threshold: 60.0C)");

	if (connected) {
		/* Burst 10 rapid notifications when BLE is active */
		for (int i = 1; i <= 10; i++) {
			LOG_DBG("Notify: temp=85.2C humidity=12%% (anomaly burst %d/10)", i);
		}
	}

	LOG_WRN("Thermal threshold exceeded, initiating cooldown");
	LOG_ERR("Sensor read timeout during thermal event (retry 1/3)");
	LOG_INF("Temperature returning to normal: 24.8C");

	if (connected) {
		LOG_INF("Anomaly burst complete, resuming normal interval");
	}
}
