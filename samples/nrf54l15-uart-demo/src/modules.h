/*
 * LogScope UART Demo — shared declarations for simulated modules
 */

#ifndef LOGSCOPE_DEMO_MODULES_H
#define LOGSCOPE_DEMO_MODULES_H

#include <stdint.h>
#include <stdbool.h>

/* Sensor driver */
void sensor_drv_init(void);
void sensor_drv_read(int cycle);
uint32_t sensor_drv_get_value(void);

/* Flash manager */
void flash_mgr_init(void);
void flash_mgr_tick(int cycle);

/* Crypto manager */
void crypto_mgr_init(void);
void crypto_mgr_tick(int cycle);

#endif
